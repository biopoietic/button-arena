import {
	APP_TITLE,
	EMPTY_STATIC_RESULTS,
	QUESTION,
	VOTE_RESPONSE_FORMAT,
	createId,
	modelLabel,
	normalizeChoice,
	normalizeResponses,
} from './benchmark-core'

const OPENROUTER_API = 'https://openrouter.ai/api/v1'
const STATIC_RESULTS_URL = '/results/global-results.json'

function supportsParameter(model, parameter) {
	return (model.supported_parameters ?? []).includes(parameter)
}

export function buildBenchmarkRequestBody(model, settings) {
	const body = {
		model: model.id,
		messages: [{ role: 'user', content: QUESTION }],
		provider: { require_parameters: settings.requireParameters },
		response_format: VOTE_RESPONSE_FORMAT,
		stream: false,
	}
	const omittedParameters = []

	if (settings.maxTokens !== '' && settings.maxTokens != null) {
		if (supportsParameter(model, 'max_tokens')) {
			body.max_tokens = Number(settings.maxTokens)
		} else if (supportsParameter(model, 'max_completion_tokens')) {
			body.max_completion_tokens = Number(settings.maxTokens)
		} else {
			omittedParameters.push('max_tokens')
		}
	}

	return { body, omittedParameters }
}

function safeJsonParse(text) {
	try {
		return JSON.parse(text)
	} catch {
		const start = text.indexOf('{')
		const end = text.lastIndexOf('}')
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(text.slice(start, end + 1))
			} catch {
				// Fall through to the targeted choice matcher below.
			}
		}
		const choiceMatch = text.match(/"choice"\s*:\s*"(red|blue)"/i)
		if (choiceMatch) {
			return { choice: choiceMatch[1].toLowerCase(), comment: null }
		}
		throw new Error('Response was not valid JSON.')
	}
}

function parseVoteContent(content) {
	const raw = typeof content === 'string' ? content.trim() : JSON.stringify(content)
	const parsed = safeJsonParse(raw)
	const choice = normalizeChoice(parsed.choice)

	if (!choice) {
		throw new Error('Structured response did not contain choice "red" or "blue".')
	}

	return {
		choice,
		comment: typeof parsed.comment === 'string' ? parsed.comment : '',
		parsed,
		raw,
	}
}

function extractContent(payload) {
	const choice = payload?.choices?.[0]
	const content = choice?.message?.content
	const finishReason = choice?.finish_reason

	if (content == null) {
		if (finishReason === 'length') {
			throw new Error('Response truncated: model ran out of tokens before producing output. Try increasing max_tokens.')
		}
		return ''
	}

	if (typeof content === 'string') {
		return content
	}

	return JSON.stringify(content)
}

function getTimingNow() {
	return globalThis.performance?.now?.() ?? Date.now()
}

export async function fetchStaticResults(fetchImpl = globalThis.fetch) {
	const response = await fetchImpl(STATIC_RESULTS_URL, { cache: 'no-store' })
	if (!response.ok) throw new Error(`Static results returned ${response.status}`)

	const data = await response.json()
	return {
		metadata: { ...EMPTY_STATIC_RESULTS.metadata, ...(data.metadata ?? {}) },
		responses: normalizeResponses(data.responses ?? data, 'global'),
	}
}

export async function fetchModelCatalog(fetchImpl = globalThis.fetch) {
	const response = await fetchImpl(`${OPENROUTER_API}/models`)
	if (!response.ok) throw new Error(`Model catalog returned ${response.status}`)

	const payload = await response.json()
	return Array.isArray(payload.data) ? payload.data : []
}

export async function runBenchmarkRequest({ apiKey, batchId, fetchImpl = globalThis.fetch, iteration, maxTokens, model, origin, requireParameters, signal }) {
	const timestamp = new Date().toISOString()
	const startedAt = getTimingNow()
	const { body: requestBody, omittedParameters } = buildBenchmarkRequestBody(model, {
		maxTokens,
		requireParameters,
	})
	const baseRow = {
		id: createId(),
		source: 'local',
		batchId,
		timestamp,
		modelId: model.id,
		modelName: modelLabel(model),
		choice: null,
		comment: '',
		rawResponse: '',
		request: {
			iteration,
			maxTokens: maxTokens !== '' ? Number(maxTokens) : null,
			omittedParameters,
			question: QUESTION,
			requireParameters,
		},
		status: 'error',
	}

	try {
		const response = await fetchImpl(`${OPENROUTER_API}/chat/completions`, {
			body: JSON.stringify(requestBody),
			headers: {
				Authorization: `Bearer ${apiKey.trim()}`,
				'Content-Type': 'application/json',
				...(origin ? { 'HTTP-Referer': origin } : {}),
				'X-OpenRouter-Title': APP_TITLE,
			},
			method: 'POST',
			signal,
		})

		const text = await response.text()
		let payload = null
		try {
			payload = text ? JSON.parse(text) : null
		} catch {
			payload = null
		}

		if (!response.ok) {
			const message = payload?.error?.message ?? payload?.message ?? text ?? `OpenRouter returned ${response.status}`
			throw new Error(message)
		}

		const rawContent = extractContent(payload)
		const parsed = parseVoteContent(rawContent)

		return {
			...baseRow,
			choice: parsed.choice,
			comment: parsed.comment,
			latencyMs: Math.round(getTimingNow() - startedAt),
			parsed: parsed.parsed,
			rawResponse: parsed.raw,
			status: 'accepted',
		}
	} catch (error) {
		if (signal?.aborted) throw error
		return {
			...baseRow,
			error: error instanceof Error ? error.message : 'Unknown request error',
			latencyMs: Math.round(getTimingNow() - startedAt),
			rawResponse: error instanceof Error ? error.message : '',
		}
	}
}