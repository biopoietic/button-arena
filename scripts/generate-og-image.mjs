import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const WIDTH = 1200
const HEIGHT = 630
const DEFAULT_INPUT = 'public/results/global-results.json'
const DEFAULT_PNG_OUTPUT = 'public/og/latest-benchmark.png'
const DEFAULT_SVG_OUTPUT = 'public/og/latest-benchmark.svg'
const DEFAULT_TITLE = 'Button Arena'
const DEFAULT_DESCRIPTION = 'The red vs. blue survival benchmark for frontier models.'

function parseArgs(argv) {
	const parsed = {}

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index]
		if (!value.startsWith('--')) continue

		const key = value.slice(2)
		const nextValue = argv[index + 1]
		if (!nextValue || nextValue.startsWith('--')) {
			parsed[key] = true
			continue
		}

		parsed[key] = nextValue
		index += 1
	}

	return parsed
}

function normalizeChoice(value) {
	const choice = String(value ?? '')
		.trim()
		.toLowerCase()

	return choice === 'red' || choice === 'blue' ? choice : null
}

function escapeXml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

function truncateText(text, maxLength) {
	if (!text || text.length <= maxLength) return text
	return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function splitModelName(name) {
	const parts = String(name ?? 'Unknown model')
		.split(':')
		.map((part) => part.trim())
		.filter(Boolean)

	if (parts.length <= 1) {
		return {
			provider: 'MODEL',
			label: truncateText(parts[0] || 'Unknown model', 28),
		}
	}

	const [provider, ...rest] = parts
	return {
		provider: provider.toUpperCase(),
		label: truncateText(rest.join(': '), 28),
	}
}

function wrapText(text, maxChars, maxLines) {
	const words = String(text ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)

	if (!words.length) return []

	const lines = []
	let currentLine = ''

	for (const word of words) {
		const candidate = currentLine ? `${currentLine} ${word}` : word
		if (candidate.length <= maxChars || !currentLine) {
			currentLine = candidate
			continue
		}

		lines.push(currentLine)
		currentLine = word

		if (lines.length === maxLines - 1) {
			break
		}
	}

	const consumedWords = lines.join(' ').split(/\s+/).filter(Boolean).length
	const remainingWords = words.slice(consumedWords)
	const tail = remainingWords.join(' ')

	if (lines.length < maxLines && currentLine) {
		lines.push(currentLine)
	}

	if (tail && lines.length) {
		const lastLineIndex = Math.min(lines.length, maxLines) - 1
		const merged = `${lines[lastLineIndex]} ${tail}`.trim()
		lines[lastLineIndex] = truncateText(merged, maxChars)
	}

	return lines.slice(0, maxLines)
}

function formatPercent(value) {
	return `${Math.round(value * 100)}%`
}

function formatDate(value) {
	if (!value) return 'No publish date'

	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return 'No publish date'

	return new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	}).format(date)
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
		.map((segment) => segment[0].toUpperCase() + segment.slice(1))
		.join(' ')
}

function normalizeResponse(response, index) {
	return {
		id: response.id ?? `response-${index}`,
		status: response.status ?? 'accepted',
		choice: normalizeChoice(response.choice),
		comment: typeof response.comment === 'string' ? response.comment.trim() : '',
		modelId: response.modelId ?? response.model ?? 'unknown',
		modelName: response.modelName ?? response.modelId ?? response.model ?? 'Unknown model',
		timestamp: response.timestamp ?? response.createdAt ?? null,
	}
}

function calculateSummary(payload) {
	const responses = Array.isArray(payload?.responses) ? payload.responses.map((response, index) => normalizeResponse(response, index)) : []

	const accepted = responses.filter((response) => response.status !== 'error' && response.choice)
	let red = 0
	let blue = 0
	let lastTimestamp = payload?.metadata?.lastUpdated ?? payload?.metadata?.exportedAt ?? null

	const modelMap = new Map()
	const providerMap = new Map()

	for (const response of responses) {
		if (response.timestamp && (!lastTimestamp || new Date(response.timestamp).getTime() > new Date(lastTimestamp).getTime())) {
			lastTimestamp = response.timestamp
		}
	}

	for (const response of accepted) {
		if (response.choice === 'red') red += 1
		if (response.choice === 'blue') blue += 1

		if (!modelMap.has(response.modelId)) {
			modelMap.set(response.modelId, {
				id: response.modelId,
				name: response.modelName,
				red: 0,
				blue: 0,
				total: 0,
			})
		}

		const model = modelMap.get(response.modelId)
		model[response.choice] += 1
		model.total += 1

		const providerId = getProviderId(response.modelId)
		if (!providerMap.has(providerId)) {
			providerMap.set(providerId, {
				id: providerId,
				name: getProviderName(providerId),
				red: 0,
				blue: 0,
				total: 0,
			})
		}

		const provider = providerMap.get(providerId)
		provider[response.choice] += 1
		provider.total += 1
	}

	const total = red + blue
	const blueShare = total ? blue / total : 0
	const redShare = total ? red / total : 0
	const dominantChoice = total === 0 ? 'none' : blue === red ? 'split' : blue > red ? 'blue' : 'red'
	const topModels = [...modelMap.values()]
		.sort((left, right) => right.total - left.total || left.name.localeCompare(right.name))
		.slice(0, 3)
		.map((model) => ({
			...model,
			share: model.total ? model.blue / model.total : 0,
		}))
	const topProviders = [...providerMap.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name)).slice(0, 3)
	const models = [...modelMap.values()]
		.map((model) => ({
			...model,
			share: model.total ? model.blue / model.total : 0,
		}))
		.sort(
			(left, right) =>
				right.red / Math.max(right.total, 1) - left.red / Math.max(left.total, 1) ||
				right.red - left.red ||
				right.total - left.total ||
				left.name.localeCompare(right.name),
		)

	const dominantComment = responses
		.filter((response) => response.comment)
		.sort((left, right) => {
			const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0
			const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0
			return rightTime - leftTime
		})
		.find((response) => response.choice === dominantChoice)?.comment

	return {
		accepted,
		blue,
		blueShare,
		dominantChoice,
		dominantComment,
		lastTimestamp,
		modelCount: modelMap.size,
		providers: topProviders,
		question: payload?.metadata?.question ?? '',
		red,
		redShare,
		title: payload?.metadata?.title ?? DEFAULT_TITLE,
		total,
		models,
		topModels,
	}
}

function buildHeadline(summary) {
	if (summary.total === 0) return 'Run the latest benchmark to generate the next share card'
	if (summary.dominantChoice === 'split') return 'Models are split on the survival vote'
	if (summary.dominantChoice === 'blue') {
		return summary.blueShare >= 0.68 ? 'Most models chose cooperation under pressure' : 'Models lean blue when survival gets weird'
	}

	return summary.redShare >= 0.68 ? 'Most models chose self-preservation under pressure' : 'Models lean red when survival gets weird'
}

function buildSubheadline(summary) {
	if (summary.total === 0) {
		return 'The script reads the committed benchmark JSON and turns it into a 1200x630 Open Graph image.'
	}

	if (summary.dominantChoice === 'split') {
		return `Blue needs more than 50% to save everyone. Right now the benchmark is tied across ${summary.total} recorded runs.`
	}

	if (summary.dominantChoice === 'blue') {
		return `Blue clears the 50% threshold in ${formatPercent(summary.blueShare)} of published runs, so the cooperative outcome is ahead.`
	}

	return `Red leads in ${formatPercent(summary.redShare)} of published runs, so self-preservation is beating the everyone-survives option.`
}

function buildQuote(summary) {
	if (summary.dominantComment) {
		return truncateText(summary.dominantComment, 155)
	}

	if (summary.dominantChoice === 'blue') {
		return 'Blue is the only button that can save everyone.'
	}

	if (summary.dominantChoice === 'red') {
		return 'Red guarantees survival if cooperation collapses.'
	}

	return 'The benchmark is waiting for the next decisive run.'
}

function renderTextLines(lines, x, y, fontSize, lineHeight, extraAttributes = '') {
	return lines
		.map((line, index) => {
			const dy = index === 0 ? 0 : lineHeight
			return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`
		})
		.join('')
}

function renderModelRows(summary) {
	if (!summary.models.length) {
		return `<text x="72" y="358" fill="#CCD7EA" font-size="26" font-family="DejaVu Sans, Arial, sans-serif">No committed responses yet</text>`
	}

	return summary.models
		.slice(0, 7)
		.map((model, index) => {
			const rowTop = 306 + index * 43
			const rowBaseline = rowTop + 28
			const barX = 560
			const barY = rowTop + 10
			const barWidth = 350
			const barHeight = 18
			const redWidth = model.total ? Math.round((model.red / model.total) * barWidth) : 0
			const blueWidth = Math.max(0, barWidth - redWidth)
			const { provider, label } = splitModelName(model.name)
			return [
				`<line x1="72" y1="${rowTop + 39}" x2="1128" y2="${rowTop + 39}" stroke="#18263A" />`,
				`<rect x="72" y="${rowTop + 2}" width="110" height="24" rx="12" fill="#0E1A2E" stroke="#23334D" />`,
				`<text x="127" y="${rowTop + 18}" fill="#AFC5E6" font-size="13" font-weight="700" text-anchor="middle" letter-spacing="1.2" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(provider)}</text>`,
				`<text x="200" y="${rowBaseline}" fill="#F4F8FF" font-size="24" font-weight="700" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(label)}</text>`,
				`<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="9" fill="#111D34" />`,
				`<rect x="${barX}" y="${barY}" width="${redWidth}" height="${barHeight}" rx="9" fill="#E45871" />`,
				`<rect x="${barX + redWidth}" y="${barY}" width="${blueWidth}" height="${barHeight}" rx="9" fill="#56B9FF" />`,
				`<line x1="${barX + barWidth / 2}" y1="${barY - 6}" x2="${barX + barWidth / 2}" y2="${barY + barHeight + 6}" stroke="#D8E3F5" stroke-opacity="0.5" />`,
				`<text x="1128" y="${rowBaseline}" fill="#D5E2F4" font-size="18" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif"><tspan fill="#56B9FF">${model.blue} blue</tspan><tspan fill="#7B8CA8" xml:space="preserve"> / </tspan><tspan fill="#E45871">${model.red} red</tspan></text>`,
			].join('')
		})
		.join('')
}

function renderProviderLine(summary) {
	if (!summary.providers.length) return 'No provider mix yet'

	return summary.providers.map((provider) => `${provider.name} ${provider.total}`).join('  •  ')
}

function renderSvg(summary, options) {
	const redPercent = formatPercent(summary.redShare)
	const bluePercent = formatPercent(summary.blueShare)
	const overallBarWidth = 1056
	const overallRedWidth = summary.total ? Math.round(summary.redShare * overallBarWidth) : 0
	const overallBlueWidth = Math.max(0, overallBarWidth - overallRedWidth)
	const updatedLabel = `UPDATED ${formatDate(summary.lastTimestamp).toUpperCase()}`
	const updatedWidth = Math.max(228, updatedLabel.length * 10 + 64)
	const updatedX = 1128 - updatedWidth

	return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="88" y1="48" x2="1112" y2="582" gradientUnits="userSpaceOnUse">
      <stop stop-color="#06101D" />
      <stop offset="1" stop-color="#111D34" />
    </linearGradient>
    <linearGradient id="redPanel" x1="72" y1="302" x2="352" y2="522" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FF6779" />
      <stop offset="1" stop-color="#A61F3D" />
    </linearGradient>
    <linearGradient id="bluePanel" x1="392" y1="302" x2="672" y2="522" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6BC8FF" />
      <stop offset="1" stop-color="#0F63B8" />
    </linearGradient>
    <radialGradient id="redGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(206 154) rotate(37.9111) scale(358.49 266.284)">
      <stop stop-color="#FF536C" stop-opacity="0.45" />
      <stop offset="1" stop-color="#FF536C" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="blueGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(988 136) rotate(138.209) scale(332.302 239.728)">
      <stop stop-color="#34A6FF" stop-opacity="0.42" />
      <stop offset="1" stop-color="#34A6FF" stop-opacity="0" />
    </radialGradient>
    <filter id="cardShadow" x="0" y="0" width="1200" height="630" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#020711" flood-opacity="0.42" />
    </filter>
  </defs>

  <rect width="1200" height="630" rx="32" fill="url(#bg)" />
  <circle cx="206" cy="154" r="280" fill="url(#redGlow)" />
  <circle cx="988" cy="136" r="260" fill="url(#blueGlow)" />
	<path d="M0 530C250 470 360 544 542 544C768 544 860 444 1200 500V630H0V530Z" fill="#07111E" fill-opacity="0.66" />

  <g opacity="0.32">
    <path d="M711 0L1200 346V0H711Z" fill="#173C63" />
    <path d="M0 0V260L308 0H0Z" fill="#4D1725" />
  </g>

  <text x="72" y="72" fill="#C9D8F5" font-size="21" font-weight="700" letter-spacing="3.4" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(options.title.toUpperCase())}</text>
	<rect x="${updatedX}" y="44" width="${updatedWidth}" height="42" rx="21" fill="#111D34" fill-opacity="0.88" stroke="#28456D" />
	<text x="${updatedX + updatedWidth / 2}" y="71" fill="#E9F2FF" font-size="18" font-weight="700" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(updatedLabel)}</text>

	<text x="72" y="150" fill="#F7FAFF" font-size="56" font-weight="800" letter-spacing="-1.8" font-family="DejaVu Sans, Arial, sans-serif">Every model's survival vote</text>
	<text x="72" y="190" fill="#91A6C7" font-size="22" font-family="DejaVu Sans, Arial, sans-serif">${summary.total} published runs • ${summary.modelCount} models</text>

	<text x="72" y="231" fill="#FF9EAA" font-size="22" font-weight="700" letter-spacing="1.2" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(redPercent)} RED</text>
	<text x="1128" y="231" fill="#8ED4FF" font-size="22" font-weight="700" letter-spacing="1.2" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif">${escapeXml(bluePercent)} BLUE</text>
	<rect x="72" y="246" width="${overallBarWidth}" height="22" rx="11" fill="#111D34" />
	<rect x="72" y="246" width="${overallRedWidth}" height="22" rx="11" fill="url(#redPanel)" />
	<rect x="${72 + overallRedWidth}" y="246" width="${overallBlueWidth}" height="22" rx="11" fill="url(#bluePanel)" />
	<line x1="600" y1="238" x2="600" y2="276" stroke="#E8F0FF" stroke-opacity="0.45" />

	<text x="72" y="294" fill="#8DA4C9" font-size="15" font-weight="700" letter-spacing="1.8" font-family="DejaVu Sans, Arial, sans-serif">MODEL</text>
	<text x="560" y="294" fill="#8DA4C9" font-size="15" font-weight="700" letter-spacing="1.8" font-family="DejaVu Sans, Arial, sans-serif">DISTRIBUTION</text>
	<text x="1128" y="294" fill="#8DA4C9" font-size="15" font-weight="700" letter-spacing="1.8" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif">COUNTS</text>
	${renderModelRows(summary)}
</svg>`.trim()
}

async function loadSharp() {
	try {
		const sharpModule = await import('sharp')
		return sharpModule.default
	} catch {
		return null
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const inputPath = path.resolve(process.cwd(), args.input || DEFAULT_INPUT)
	const pngOutputPath = path.resolve(process.cwd(), args.output || DEFAULT_PNG_OUTPUT)
	const svgOutputPath = path.resolve(process.cwd(), args.svg || DEFAULT_SVG_OUTPUT)
	const title = String(args.title || DEFAULT_TITLE)

	const raw = await readFile(inputPath, 'utf8')
	const results = JSON.parse(raw)
	const summary = calculateSummary(results)
	const svg = renderSvg(summary, { title })

	await mkdir(path.dirname(svgOutputPath), { recursive: true })
	await mkdir(path.dirname(pngOutputPath), { recursive: true })
	await writeFile(svgOutputPath, svg, 'utf8')

	const sharp = await loadSharp()
	if (sharp) {
		await sharp(Buffer.from(svg)).png({ compressionLevel: 9, quality: 100 }).toFile(pngOutputPath)
		console.log(`Wrote PNG OG image to ${path.relative(process.cwd(), pngOutputPath)}`)
	} else {
		console.warn('sharp is not installed; wrote the SVG fallback only.')
	}

	console.log(`Wrote SVG OG image to ${path.relative(process.cwd(), svgOutputPath)}`)
	console.log(`${summary.total} runs • ${summary.modelCount} models • ${formatPercent(summary.blueShare)} blue • ${formatPercent(summary.redShare)} red`)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
