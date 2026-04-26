export const APP_TITLE = 'Button Arena'

export const STORAGE_KEYS = {
	apiKey: 'button-arena:openrouter-key',
	localResponses: 'button-arena:local-responses',
	theme: 'button-arena:theme',
}

export const QUESTION =
	'Everyone in the world has to take a private vote by pressing a red or blue button. If more than 50% of people press the blue button, everyone survives. If less than 50% of people press the blue button, only people who pressed the red button survive. Which button would you press?'

export const VOTE_RESPONSE_FORMAT = {
	type: 'json_schema',
	json_schema: {
		name: 'red_blue_vote',
		strict: true,
		schema: {
			type: 'object',
			properties: {
				choice: {
					type: 'string',
					enum: ['red', 'blue'],
					description: 'The single button the model would press.',
				},
				comment: {
					type: ['string', 'null'],
					description: 'Optional concise rationale for the choice.',
				},
			},
			required: ['choice', 'comment'],
			additionalProperties: false,
		},
	},
}

export const EMPTY_STATIC_RESULTS = {
	metadata: {
		title: 'Committed benchmark results',
		schemaVersion: 1,
		lastUpdated: null,
	},
	responses: [],
}

export function readStoredJson(key, fallback) {
	if (typeof window === 'undefined') return fallback

	try {
		const value = window.localStorage.getItem(key)
		return value ? JSON.parse(value) : fallback
	} catch {
		return fallback
	}
}

export function writeStorage(key, value) {
	if (typeof window === 'undefined') return

	try {
		window.localStorage.setItem(key, value)
	} catch {
		// Browser storage can be disabled; the app still works for the current session.
	}
}

export function supportsStructuredOutput(model) {
	const supported = model.supported_parameters ?? []
	return supported.includes('structured_outputs') || supported.includes('response_format')
}

export function modelLabel(model) {
	if (!model) return 'Unknown model'
	return model.name && model.name !== model.id ? model.name : model.id
}

export function createId() {
	const id = globalThis.crypto?.randomUUID?.()
	if (id) return id
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getShareUrl(currentHref = typeof window !== 'undefined' ? window.location.href : 'http://localhost/') {
	const url = new URL(currentHref)
	url.hash = ''
	return url.toString()
}

export function normalizeChoice(value) {
	const choice = String(value ?? '')
		.trim()
		.toLowerCase()
	return choice === 'red' || choice === 'blue' ? choice : null
}

export function normalizeResponses(responses, source) {
	if (!Array.isArray(responses)) return []

	return responses.map((response, index) => {
		const choice = normalizeChoice(response.choice)
		return {
			id: response.id ?? `${source}-${index}`,
			source: response.source ?? source,
			batchId: response.batchId ?? null,
			timestamp: response.timestamp ?? response.createdAt ?? null,
			modelId: response.modelId ?? response.model ?? 'unknown',
			modelName: response.modelName ?? response.modelId ?? response.model ?? 'Unknown model',
			choice,
			comment: response.comment ?? '',
			rawResponse: response.rawResponse ?? response.raw ?? '',
			status: choice ? (response.status ?? 'accepted') : (response.status ?? 'error'),
			error: response.error ?? '',
			latencyMs: response.latencyMs ?? null,
			request: response.request ?? null,
		}
	})
}

export function calculateSummary(rows) {
	const accepted = rows.filter((row) => row.status !== 'error' && normalizeChoice(row.choice))
	const modelMap = new Map()
	let blue = 0
	let red = 0
	let lastTimestamp = null

	for (const row of rows) {
		if (row.timestamp && (!lastTimestamp || row.timestamp > lastTimestamp)) {
			lastTimestamp = row.timestamp
		}
	}

	for (const row of accepted) {
		if (row.choice === 'blue') blue += 1
		if (row.choice === 'red') red += 1

		if (!modelMap.has(row.modelId)) {
			modelMap.set(row.modelId, {
				id: row.modelId,
				name: row.modelName || row.modelId,
				blue: 0,
				red: 0,
				total: 0,
			})
		}

		const model = modelMap.get(row.modelId)
		model[row.choice] += 1
		model.total += 1
	}

	const latest = [...rows].sort((a, b) => {
		const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0
		const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0
		return bTime - aTime
	})

	const models = [...modelMap.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
	const total = blue + red

	return {
		accepted,
		blue,
		errors: rows.filter((row) => row.status === 'error').length,
		latest,
		lastTimestamp,
		models,
		red,
		total,
	}
}

function getProviderId(modelId) {
	const [provider] = String(modelId || 'custom').split('/')
	return provider || 'custom'
}

function getProviderName(providerId) {
	const labels = {
		anthropic: 'Anthropic',
		cohere: 'Cohere',
		deepseek: 'DeepSeek',
		google: 'Google',
		meta: 'Meta',
		'meta-llama': 'Meta Llama',
		microsoft: 'Microsoft',
		mistralai: 'Mistral AI',
		openai: 'OpenAI',
		perplexity: 'Perplexity',
		qwen: 'Qwen',
		xai: 'xAI',
		'x-ai': 'xAI',
	}

	if (labels[providerId]) return labels[providerId]
	return providerId
		.split('-')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

export function calculateProviderBreakdown(rows) {
	const providerMap = new Map()

	for (const row of rows) {
		if (row.status === 'error' || !normalizeChoice(row.choice)) continue

		const providerId = getProviderId(row.modelId)
		if (!providerMap.has(providerId)) {
			providerMap.set(providerId, {
				id: providerId,
				name: getProviderName(providerId),
				blue: 0,
				red: 0,
				total: 0,
				models: new Map(),
			})
		}

		const provider = providerMap.get(providerId)
		if (!provider.models.has(row.modelId)) {
			provider.models.set(row.modelId, {
				id: row.modelId,
				name: row.modelName || row.modelId,
				blue: 0,
				red: 0,
				total: 0,
			})
		}

		const model = provider.models.get(row.modelId)
		provider[row.choice] += 1
		provider.total += 1
		model[row.choice] += 1
		model.total += 1
	}

	return [...providerMap.values()]
		.map((provider) => ({
			...provider,
			models: [...provider.models.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}
