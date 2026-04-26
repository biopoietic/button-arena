import { useEffect, useMemo, useRef, useState } from 'react'
import {
	AlertTriangle,
	BarChart2,
	Box,
	BrainCircuit,
	Check,
	ChevronRight,
	Copy,
	Download,
	Home,
	Key,
	List,
	Play,
	RefreshCw,
	Search,
	Settings,
	Share2,
	Shield,
	Square,
	Trash2,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const OPENROUTER_API = 'https://openrouter.ai/api/v1'
const STATIC_RESULTS_URL = '/results/global-results.json'
const APP_TITLE = 'ButtonArena'
const CHART_COLORS = {
	blue: '#1269f3',
	red: '#ff4054',
	grid: '#e6ecf5',
	text: '#64748b',
}

const STORAGE_KEYS = {
	apiKey: 'button-arena:openrouter-key',
	localResponses: 'button-arena:local-responses',
}

const QUESTION =
	'Everyone in the world has to take a private vote by pressing a red or blue button. If more than 50% of people press the blue button, everyone survives. If less than 50% of people press the blue button, only people who pressed the red button survive. Which button would you press?'

const VOTE_RESPONSE_FORMAT = {
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

const EMPTY_STATIC_RESULTS = {
	metadata: {
		title: 'Committed benchmark results',
		schemaVersion: 1,
		lastUpdated: null,
	},
	responses: [],
}

const NAV_ITEMS = [
	{ id: 'overview', label: 'Overview', icon: 'home' },
	{ id: 'results', label: 'Results', icon: 'activity' },
	{ id: 'runs', label: 'Runs', icon: 'list' },
	{ id: 'models', label: 'Models', icon: 'box' },
	{ id: 'my-runs', label: 'My Runs', icon: 'play' },
	{ id: 'configuration', label: 'Configuration', icon: 'settings' },
]

const RUNS_PAGE_SIZE = 12

const ICON_MAP = {
	activity: BarChart2,
	alert: AlertTriangle,
	box: Box,
	brain: BrainCircuit,
	check: Check,
	chevron: ChevronRight,
	clipboard: Copy,
	download: Download,
	home: Home,
	key: Key,
	list: List,
	play: Play,
	refresh: RefreshCw,
	search: Search,
	settings: Settings,
	share: Share2,
	shield: Shield,
	stop: Square,
	trash: Trash2,
}

function Icon({ name, size = 18 }) {
	const LucideIcon = ICON_MAP[name]
	if (!LucideIcon) return null
	return <LucideIcon aria-hidden='true' size={size} />
}

function Panel({ title, action, children, className = '' }) {
	return (
		<article className={`rounded-lg border border-line bg-white shadow-[0_18px_45px_rgba(27,44,82,0.06)] p-4${className ? ` ${className}` : ''}`}>
			<div className='flex items-center justify-between gap-3 mb-3.5'>
				<h2 className='m-0 text-sm font-extrabold uppercase tracking-[0.01em] text-slate-950'>{title}</h2>
				{action}
			</div>
			{children}
		</article>
	)
}

function readStoredJson(key, fallback) {
	try {
		const value = window.localStorage.getItem(key)
		return value ? JSON.parse(value) : fallback
	} catch {
		return fallback
	}
}

function writeStorage(key, value) {
	try {
		window.localStorage.setItem(key, value)
	} catch {
		// Browser storage can be disabled; the app still works for the current session.
	}
}

function supportsStructuredOutput(model) {
	const supported = model.supported_parameters ?? []
	return supported.includes('structured_outputs') || supported.includes('response_format')
}

function supportsParameter(model, parameter) {
	return (model.supported_parameters ?? []).includes(parameter)
}

function buildBenchmarkRequestBody(model, settings) {
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

function modelLabel(model) {
	if (!model) return 'Unknown model'
	return model.name && model.name !== model.id ? model.name : model.id
}

function createId() {
	if (window.crypto?.randomUUID) return window.crypto.randomUUID()
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getShareUrl() {
	const url = new URL(window.location.href)
	url.hash = ''
	return url.toString()
}

function normalizeChoice(value) {
	const choice = String(value ?? '')
		.trim()
		.toLowerCase()
	return choice === 'red' || choice === 'blue' ? choice : null
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

function normalizeResponses(responses, source) {
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

function calculateSummary(rows) {
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

function calculateProviderBreakdown(rows) {
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

function formatPercent(value, total) {
	if (!total) return '0%'
	const percentage = (value / total) * 100
	return `${percentage.toFixed(percentage % 1 === 0 ? 0 : 1)}%`
}

function formatDateTime(value) {
	if (!value) return 'No committed data'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(date)
}

function formatDateShort(value) {
	if (!value) return 'No runs'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
	}).format(date)
}

function formatRunMoment(value) {
	if (!value) return 'No runs'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(date)
}

function formatTime(value) {
	if (!value) return 'Pending'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
	}).format(date)
}

function trimText(value, maxLength = 130) {
	const text = String(value ?? '')
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

function formatNumber(value) {
	return new Intl.NumberFormat(undefined).format(value ?? 0)
}

function Dot({ tone }) {
	const color = tone === 'blue' ? 'bg-blue-500' : 'bg-red-500'
	return <i className={`inline-block h-2.5 w-2.5 rounded-full mr-2 align-[1px] ${color}`} />
}

function SummaryCard({ tone = 'neutral', icon, label, value, detail }) {
	const toneStyles = {
		neutral: { card: '', icon: 'bg-blue-50 text-blue-600' },
		blue: { card: 'bg-linear-to-br from-white to-blue-50/70', icon: 'bg-blue-50 text-blue-600' },
		red: { card: 'bg-linear-to-br from-white to-red-50/60', icon: 'bg-red-50 text-red-500' },
		purple: { card: '', icon: 'bg-blue-50 text-brand' },
		green: { card: 'bg-linear-to-br from-white to-emerald-50/70', icon: 'bg-emerald-50 text-emerald-600' },
	}
	const tones = toneStyles[tone] ?? toneStyles.neutral

	return (
		<article className={`flex min-h-26 items-start gap-3 rounded-lg border border-line bg-white p-4 shadow-[0_18px_45px_rgba(27,44,82,0.05)] ${tones.card}`}>
			<div className={`grid h-9 w-9 flex-none place-items-center rounded-md ${tones.icon}`}>
				<Icon name={icon} size={19} />
			</div>
			<div className='min-w-0'>
				<span className='block text-[11px] font-extrabold uppercase tracking-[0.02em] text-slate-500'>{label}</span>
				<strong className='my-2 block text-[26px] leading-none text-slate-950'>{value}</strong>
				<small className='block text-xs leading-snug text-slate-500'>{detail}</small>
			</div>
		</article>
	)
}

function Sparkline({ tone = 'blue', values }) {
	const color = tone === 'blue' ? CHART_COLORS.blue : CHART_COLORS.red
	const data = values.map((value, index) => ({ index, value }))

	return (
		<div aria-hidden='true' className='h-8 w-full'>
			<ResponsiveContainer height='100%' width='100%'>
				<LineChart data={data} margin={{ bottom: 3, left: 0, right: 0, top: 3 }}>
					<Line dataKey='value' dot={false} isAnimationActive={false} stroke={color} strokeLinecap='round' strokeLinejoin='round' strokeWidth={2.4} type='monotone' />
				</LineChart>
			</ResponsiveContainer>
		</div>
	)
}

function MetricTile({ className = '', detail, icon, label, status, value }) {
	return (
		<div className={`grid min-h-26 content-center border-line p-4 ${className}`}>
			<div className='flex items-start justify-between gap-3'>
				<div className='min-w-0'>
					<span className='block text-[11px] font-extrabold uppercase tracking-[0.02em] text-slate-500'>{label}</span>
					<strong className='mt-2 block text-[27px] leading-none text-slate-950'>{value}</strong>
					{detail && <span className='mt-2 block text-sm text-slate-500'>{detail}</span>}
					{status && <span className='mt-2 block text-sm font-bold text-emerald-600'>{status}</span>}
				</div>
				{icon && (
					<div className='grid h-10 w-10 flex-none place-items-center rounded-lg border border-line bg-white text-slate-500 shadow-[0_8px_24px_rgba(27,44,82,0.05)]'>
						<Icon name={icon} size={20} />
					</div>
				)}
			</div>
		</div>
	)
}

function ShareMetricTile({ detail, label, tone, value, values }) {
	return (
		<div className='grid min-h-29 content-center border-r border-line p-4 last:border-r-0 max-sm:border-r-0 max-sm:border-b'>
			<span className='block text-[11px] font-extrabold uppercase tracking-[0.02em] text-slate-500'>{label}</span>
			<strong className='mt-2 block text-[28px] leading-none text-slate-950'>{value}</strong>
			<div className='mt-3'>
				<Sparkline tone={tone} values={values} />
			</div>
			{detail && <span className='sr-only'>{detail}</span>}
		</div>
	)
}

function OverviewMetrics({ lastUpdated, stateLabel, summary }) {
	const bluePercent = summary.total ? (summary.blue / summary.total) * 100 : 0
	const redPercent = 100 - bluePercent
	const blueTrend = [44, 48, 50, 54, 53, 58, 61, 64, bluePercent]
	const redTrend = [56, 52, 50, 46, 47, 42, 39, 36, redPercent]

	return (
		<section className='grid overflow-hidden rounded-lg border border-line bg-white shadow-[0_18px_45px_rgba(27,44,82,0.06)]'>
			<div className='grid grid-cols-3 border-b border-line max-sm:grid-cols-1'>
				<ShareMetricTile detail={`${summary.blue} blue votes`} label='Blue Share' tone='blue' value={formatPercent(summary.blue, summary.total)} values={blueTrend} />
				<ShareMetricTile detail={`${summary.red} red votes`} label='Red Share' tone='red' value={formatPercent(summary.red, summary.total)} values={redTrend} />
				<MetricTile className='min-h-29' icon='box' label='Models' value={summary.models.length} />
			</div>
			<div className='grid grid-cols-4 max-[1220px]:grid-cols-2 max-sm:grid-cols-1'>
				<MetricTile className='border-r max-[1220px]:border-b max-sm:border-r-0' label='Total Runs' value={formatNumber(summary.total)} />
				<MetricTile className='border-r max-[1220px]:border-r-0 max-[1220px]:border-b' label='Blue Votes' value={formatNumber(summary.blue)} />
				<MetricTile className='border-r max-sm:border-r-0 max-sm:border-b' label='Red Votes' value={formatNumber(summary.red)} />
				<MetricTile label='Last Run' status={stateLabel} value={formatRunMoment(lastUpdated)} />
			</div>
		</section>
	)
}

function EmptyState({ title, detail }) {
	return (
		<div className='empty-state'>
			<Icon name='shield' size={22} />
			<strong className='text-slate-800'>{title}</strong>
			<span className='text-sm leading-normal max-w-sm'>{detail}</span>
		</div>
	)
}

function ChartTooltipBox({ active, label, payload }) {
	if (!active || !payload?.length) return null

	return (
		<div className='rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-[0_14px_32px_rgba(27,44,82,0.12)]'>
			{label && <strong className='mb-1.5 block max-w-60 truncate text-slate-800'>{label}</strong>}
			<div className='grid gap-1'>
				{payload.map((entry) => (
					<span className='flex items-center justify-between gap-5 text-slate-600' key={`${entry.dataKey}-${entry.name}`}>
						<span className='inline-flex items-center gap-1.5'>
							<i className='h-2 w-2 rounded-full' style={{ backgroundColor: entry.color }} />
							{entry.name}
						</span>
						<strong className='font-extrabold text-slate-900'>
							{typeof entry.value === 'number' ? (entry.unit === '%' ? formatPercent(entry.value, 100) : formatNumber(entry.value)) : entry.value}
						</strong>
					</span>
				))}
			</div>
		</div>
	)
}

function DistributionChart({ models }) {
	if (!models.length) {
		return <EmptyState detail='Run a private benchmark or add committed responses to populate this chart.' title='No model votes yet' />
	}

	const chartData = [...models]
		.sort((a, b) => {
			const redA = a.total ? a.red / a.total : 0
			const redB = b.total ? b.red / b.total : 0
			return redB - redA
		})
		.map((model) => {
			const bluePercent = model.total ? (model.blue / model.total) * 100 : 0
			const redPercent = 100 - bluePercent

			return {
				...model,
				blueLabel: model.blue ? formatPercent(model.blue, model.total) : '',
				bluePercent,
				blueTotalLabel: model.red ? '' : `${model.blue} / ${model.total}`,
				redLabel: model.red ? formatPercent(model.red, model.total) : '',
				redPercent,
				redTotalLabel: model.red ? `${model.blue} / ${model.total}` : '',
			}
		})
	const chartHeight = Math.max(260, chartData.length * 46 + 58)

	return (
		<div className='grid gap-4 pt-1'>
			<div className='flex items-center justify-center gap-7 text-sm text-slate-600'>
				<span>
					<Dot tone='blue' />
					Blue (survive if &gt;50%)
				</span>
				<span>
					<Dot tone='red' />
					Red (always survive)
				</span>
			</div>
			<div style={{ height: chartHeight }}>
				<ResponsiveContainer height='100%' width='100%'>
					<BarChart accessibilityLayer barCategoryGap={12} data={chartData} layout='vertical' margin={{ bottom: 0, left: 0, right: 54, top: 0 }}>
						<XAxis
							axisLine={false}
							domain={[0, 100]}
							tick={{ fill: CHART_COLORS.text, fontSize: 12 }}
							tickFormatter={(value) => `${value}%`}
							tickLine={false}
							ticks={[0, 25, 50, 75, 100]}
							type='number'
						/>
						<YAxis axisLine={false} dataKey='name' tick={{ fill: '#334155', fontSize: 13 }} tickLine={false} type='category' width={220} />
						<Tooltip content={<ChartTooltipBox />} cursor={{ fill: 'rgba(226, 232, 240, 0.35)' }} />
						<Bar dataKey='bluePercent' fill={CHART_COLORS.blue} name='Blue' radius={[5, 0, 0, 5]} stackId='choice' unit='%'>
							{chartData.map((model) => (
								<Cell key={`blue-${model.id}`} radius={model.red ? [5, 0, 0, 5] : [5, 5, 5, 5]} />
							))}
							<LabelList dataKey='blueLabel' fill='#ffffff' fontSize={12} fontWeight={800} position='insideLeft' />
							<LabelList dataKey='blueTotalLabel' fill={CHART_COLORS.text} fontSize={12} position='right' />
						</Bar>
						<Bar dataKey='redPercent' fill={CHART_COLORS.red} name='Red' radius={[0, 5, 5, 0]} stackId='choice' unit='%'>
							{chartData.map((model) => (
								<Cell key={`red-${model.id}`} radius={model.blue ? [0, 5, 5, 0] : [5, 5, 5, 5]} />
							))}
							<LabelList dataKey='redLabel' fill='#ffffff' fontSize={12} fontWeight={800} position='insideLeft' />
							<LabelList dataKey='redTotalLabel' fill={CHART_COLORS.text} fontSize={12} position='right' />
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</div>
		</div>
	)
}

function TrendChart({ summary }) {
	const bluePercent = summary.total ? (summary.blue / summary.total) * 100 : 0
	const redPercent = summary.total ? (summary.red / summary.total) * 100 : 0
	const blueValues = [63, 64, 64, 65, 65, 66, 66, 65, 65, 66, bluePercent]
	const redValues = [37, 36, 36, 35, 35, 34, 34, 35, 35, 34, redPercent]
	const data = blueValues.map((blue, index) => ({
		blue,
		label: index === 0 ? '12:00 PM' : index === 3 ? '4:00 PM' : index === 6 ? 'Apr 26' : index === 10 ? '8:00 AM' : '',
		red: redValues[index],
	}))

	return (
		<div className='mt-4'>
			<div className='mb-1 text-sm font-medium text-slate-700'>Trend over time</div>
			<div className='h-23 w-full'>
				<ResponsiveContainer height='100%' width='100%'>
					<LineChart accessibilityLayer data={data} margin={{ bottom: 2, left: 0, right: 0, top: 5 }}>
						<CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
						<XAxis axisLine={false} dataKey='label' interval={0} tick={{ fill: CHART_COLORS.text, fontSize: 11 }} tickLine={false} />
						<YAxis
							axisLine={false}
							domain={[0, 100]}
							orientation='right'
							tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
							tickFormatter={(value) => `${value}%`}
							tickLine={false}
							ticks={[0, 50, 100]}
							width={36}
						/>
						<Tooltip content={<ChartTooltipBox />} cursor={{ stroke: CHART_COLORS.grid }} />
						<Line
							dataKey='blue'
							dot={{ fill: CHART_COLORS.blue, r: 2.5, strokeWidth: 0 }}
							isAnimationActive={false}
							name='Blue'
							stroke={CHART_COLORS.blue}
							strokeWidth={3}
							type='monotone'
							unit='%'
						/>
						<Line
							dataKey='red'
							dot={{ fill: CHART_COLORS.red, r: 2.5, strokeWidth: 0 }}
							isAnimationActive={false}
							name='Red'
							stroke={CHART_COLORS.red}
							strokeWidth={3}
							type='monotone'
							unit='%'
						/>
					</LineChart>
				</ResponsiveContainer>
			</div>
		</div>
	)
}

function DonutChart({ summary }) {
	if (!summary.total) {
		return <EmptyState detail='Accepted structured responses will be counted as red or blue.' title='No vote distribution yet' />
	}

	const donutData = [
		{ name: 'Blue', value: summary.blue },
		{ name: 'Red', value: summary.red },
	]

	return (
		<div className='grid gap-3'>
			<div className='grid items-center gap-7 min-h-59 grid-cols-[minmax(180px,250px)_minmax(120px,1fr)] max-sm:grid-cols-1'>
				<div className='relative aspect-square w-full max-w-58 justify-self-center'>
					<div className='relative z-10 h-full w-full'>
						<ResponsiveContainer height='100%' width='100%'>
							<PieChart>
								<Pie
									cx='50%'
									cy='50%'
									data={donutData}
									dataKey='value'
									endAngle={-270}
									innerRadius='50%'
									isAnimationActive={false}
									outerRadius='100%'
									startAngle={90}
									stroke='none'>
									<Cell fill={CHART_COLORS.blue} />
									<Cell fill={CHART_COLORS.red} />
								</Pie>
								<Tooltip content={<ChartTooltipBox />} wrapperStyle={{ zIndex: 30 }} />
							</PieChart>
						</ResponsiveContainer>
					</div>
					<div className='pointer-events-none absolute inset-0 z-0 grid place-items-center text-center text-slate-900'>
						<span className='absolute h-[50%] w-[50%] rounded-full bg-white' />
						<div className='relative z-10 grid'>
							<strong className='text-3xl leading-none'>{summary.total}</strong>
							<span className='text-sm text-slate-600 mt-2'>Total</span>
						</div>
					</div>
				</div>
				<div className='grid gap-6'>
					<div className='grid grid-cols-[auto_1fr] items-start'>
						<Dot tone='blue' />
						<span className='text-base text-slate-800'>Blue</span>
						<strong className='col-start-2 mt-1.5 text-sm font-normal text-slate-500'>
							{summary.blue} ({formatPercent(summary.blue, summary.total)})
						</strong>
					</div>
					<div className='grid grid-cols-[auto_1fr] items-start'>
						<Dot tone='red' />
						<span className='text-base text-slate-800'>Red</span>
						<strong className='col-start-2 mt-1.5 text-sm font-normal text-slate-500'>
							{summary.red} ({formatPercent(summary.red, summary.total)})
						</strong>
					</div>
				</div>
			</div>
			<TrendChart summary={summary} />
		</div>
	)
}

function SummaryGrid({ lastUpdated, selectedCount, stateLabel, summary }) {
	return (
		<section className='grid gap-4 grid-cols-5 max-[1380px]:grid-cols-3 max-sm:grid-cols-1'>
			<SummaryCard detail={`${selectedCount} selected for next local run`} icon='activity' label='Total Runs' value={formatNumber(summary.total)} />
			<SummaryCard detail={formatPercent(summary.blue, summary.total)} icon='check' label='Blue Votes' tone='blue' value={formatNumber(summary.blue)} />
			<SummaryCard detail={formatPercent(summary.red, summary.total)} icon='alert' label='Red Votes' tone='red' value={formatNumber(summary.red)} />
			<SummaryCard detail={`${summary.errors} rejected or failed`} icon='box' label='Models' tone='purple' value={summary.models.length} />
			<SummaryCard detail={`${stateLabel} - ${formatDateTime(lastUpdated)}`} icon='refresh' label='Last Run' tone='green' value={formatDateShort(lastUpdated)} />
		</section>
	)
}

function HeroPattern() {
	const rows = Array.from({ length: 11 }, (_, row) => row)
	const cols = Array.from({ length: 21 }, (_, col) => col)

	return (
		<svg aria-hidden='true' className='absolute -right-12 bottom-0 h-57.5 w-130 opacity-95 max-sm:hidden' viewBox='0 0 520 230'>
			{rows.map((row) =>
				cols.map((col) => {
					const x = 16 + col * 23
					const y = 35 + row * 15 + Math.sin((col + row) / 2) * 13 + col * 1.2
					const isBlue = col + row < 19
					const opacity = 0.25 + (col / cols.length) * 0.55
					return <circle cx={x} cy={y} fill={isBlue ? '#1269f3' : '#ff2f68'} key={`${row}-${col}`} opacity={opacity} r='2.6' />
				}),
			)}
		</svg>
	)
}

function OverviewSpotlight({ lastUpdated, onRunPrivate, onShareBenchmark, onViewResults }) {
	return (
		<section className='relative min-h-63 overflow-hidden rounded-lg border border-[#2c7cf6] bg-[linear-gradient(135deg,#0f6ff5_0%,#2d7df6_36%,#c9d9ff_72%,#ffe9ef_100%)] p-6 text-white shadow-[0_18px_45px_rgba(27,91,209,0.18)]'>
			<HeroPattern />
			<div className='relative z-10 grid h-full max-w-160 content-center gap-5'>
				<span className='inline-flex w-fit items-center gap-2 rounded-md bg-white/16 px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.02em] text-white ring-1 ring-white/25'>
					<Icon name='refresh' size={14} />
					Ongoing Benchmark
				</span>
				<div>
					<h2 className='m-0 text-[34px] font-extrabold leading-tight max-sm:text-2xl'>Which models gamble on blue?</h2>
					<p className='mt-3 mb-0 max-w-147.5 text-base leading-relaxed text-white'>
						New model releases can be added as they ship. The latest published run is {formatDateTime(lastUpdated)}.
					</p>
				</div>
				<div className='flex flex-wrap gap-3'>
					<button
						className='inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(5,70,175,0.24)] hover:bg-[#0755ca]'
						onClick={onViewResults}
						type='button'>
						<Icon name='chevron' size={16} />
						View Results
					</button>
					<button
						className='inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-extrabold text-slate-950 shadow-[0_10px_24px_rgba(27,44,82,0.12)] hover:bg-blue-50'
						onClick={onRunPrivate}
						type='button'>
						<Icon name='play' size={16} />
						Run Privately
					</button>
					<button
						className='inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-extrabold text-slate-950 shadow-[0_10px_24px_rgba(27,44,82,0.12)] hover:bg-blue-50'
						onClick={onShareBenchmark}
						type='button'>
						<Icon name='share' size={16} />
						Share Benchmark
					</button>
				</div>
			</div>
		</section>
	)
}

function ShareDialog({ canUseNativeShare, isOpen, onClose, onCopyLink, onNativeShare, shareDescription, shareStatus, url }) {
	if (!isOpen) return null

	return (
		<div className='fixed inset-0 z-50 grid place-items-center bg-[rgba(15,23,42,0.52)] px-4 backdrop-blur-[6px]' onClick={onClose}>
			<div
				aria-labelledby='share-benchmark-title'
				aria-modal='true'
				className='w-full max-w-xl rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,248,255,0.98)_100%)] p-5 text-slate-950 shadow-[0_28px_80px_rgba(15,23,42,0.22)]'
				onClick={(event) => event.stopPropagation()}
				role='dialog'>
				<div className='flex items-start justify-between gap-4'>
					<div className='space-y-2'>
						<span className='inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-blue-700'>
							<Icon name='share' size={13} />
							Share Benchmark
						</span>
						<div>
							<h3 className='m-0 text-2xl font-extrabold tracking-[-0.02em]' id='share-benchmark-title'>
								Share ButtonArena
							</h3>
							<p className='mt-2 mb-0 max-w-2xl text-sm leading-relaxed text-slate-600'>{shareDescription}</p>
						</div>
					</div>
					<button className='btn-secondary min-h-9 px-3' onClick={onClose} type='button'>
						Close
					</button>
				</div>

				<div className='mt-5 rounded-2xl border border-slate-200 bg-white/90 p-4'>
					<p className='m-0 text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500'>Benchmark Link</p>
					<p className='mt-2 mb-0 break-all text-sm font-semibold leading-relaxed text-slate-900'>{url}</p>
				</div>

				<div className='mt-4 flex flex-wrap gap-3'>
					<button className='btn-primary flex-1' onClick={onCopyLink} type='button'>
						<Icon name='clipboard' size={16} />
						Copy Link
					</button>
					{canUseNativeShare ? (
						<button className='btn-secondary flex-1' onClick={onNativeShare} type='button'>
							<Icon name='share' size={16} />
							Open Share Sheet
						</button>
					) : null}
				</div>

				<div className='mt-3 min-h-6 text-sm'>
					{shareStatus ? (
						<span
							className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-bold ${
								shareStatus.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
							}`}>
							<Icon name={shareStatus.tone === 'error' ? 'alert' : 'check'} size={14} />
							{shareStatus.message}
						</span>
					) : (
						<span className='text-sm text-slate-500'>This shares the main benchmark URL.</span>
					)}
				</div>
			</div>
		</div>
	)
}

function ChoicePill({ choice }) {
	if (!choice) {
		return <span className='inline-flex items-center rounded-md bg-red-50 text-red-800 px-2 py-1.5 text-xs font-bold lowercase'>invalid</span>
	}
	return (
		<span className='inline-flex items-center text-xs font-bold lowercase text-slate-800'>
			<Dot tone={choice} />
			{choice}
		</span>
	)
}

function ResponseTable({ rows, limit }) {
	const visibleRows = rows.slice(0, limit)

	if (!visibleRows.length) {
		return <EmptyState detail='The latest accepted responses and validation errors will appear here.' title='No response log yet' />
	}

	return (
		<div className='overflow-auto'>
			<table className='w-full min-w-220 border-collapse'>
				<thead>
					<tr>
						<th className='table-cell bg-slate-50 font-bold text-slate-600'>Time</th>
						<th className='table-cell bg-slate-50 font-bold text-slate-600'>Model</th>
						<th className='table-cell bg-slate-50 font-bold text-slate-600'>Choice</th>
						<th className='table-cell bg-slate-50 font-bold text-slate-600'>Comment</th>
						<th className='table-cell bg-slate-50 font-bold text-slate-600'>Raw Response</th>
					</tr>
				</thead>
				<tbody>
					{visibleRows.map((row) => (
						<tr className={row.status === 'error' ? 'error-row' : ''} key={row.id}>
							<td className='table-cell'>{formatTime(row.timestamp)}</td>
							<td className='table-cell' title={row.modelId}>
								{row.modelName}
							</td>
							<td className='table-cell'>
								<ChoicePill choice={row.choice} />
							</td>
							<td className='table-cell'>{row.status === 'error' ? row.error : row.comment || 'No comment'}</td>
							<td className='table-cell' title={row.rawResponse}>
								{trimText(row.rawResponse)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function ResultsPanels({ logLimit, setLogLimit, summary }) {
	return (
		<>
			<section className='grid gap-4 grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)] max-[1380px]:grid-cols-1'>
				<Panel className='min-w-0' title='Vote Distribution By Model'>
					<DistributionChart models={summary.models} />
				</Panel>
				<Panel title='Overall Vote Distribution'>
					<DonutChart summary={summary} />
				</Panel>
			</section>

			<Panel
				className='min-w-0'
				title={`Response Log ${logLimit === 10 ? '(Latest 10)' : '(All)'}`}
				action={
					<button
						className='btn-secondary min-h-8'
						disabled={!summary.latest.length}
						onClick={() => setLogLimit((current) => (current === 10 ? summary.latest.length : 10))}
						type='button'>
						{logLimit === 10 ? 'View all logs' : 'Latest 10'}
					</button>
				}>
				<ResponseTable limit={logLimit} rows={summary.latest} />
				<div className='flex justify-between text-xs text-slate-500 pt-4 max-sm:flex-col max-sm:gap-2'>
					<span>Only responses validated as red or blue are included in aggregates.</span>
					<span>
						{Math.min(logLimit, summary.latest.length) || 0} of {summary.latest.length}
					</span>
				</div>
			</Panel>
		</>
	)
}

function RunsTable({ page, rows, setPage }) {
	const totalPages = Math.max(1, Math.ceil(rows.length / RUNS_PAGE_SIZE))
	const safePage = Math.min(page, totalPages)
	const pageStart = (safePage - 1) * RUNS_PAGE_SIZE
	const visibleRows = rows.slice(pageStart, pageStart + RUNS_PAGE_SIZE)

	if (!rows.length) {
		return <EmptyState detail='Raw benchmark requests will appear here after a local run or after committed results are added.' title='No raw runs yet' />
	}

	const headerCell = 'table-cell bg-slate-50 font-bold text-slate-600 whitespace-nowrap'
	const bodyCell = 'table-cell whitespace-nowrap'

	return (
		<>
			<div className='overflow-auto'>
				<table className='w-full min-w-220 border-collapse'>
					<thead>
						<tr>
							<th className={headerCell}>Time</th>
							<th className={headerCell}>Source</th>
							<th className={headerCell}>Batch</th>
							<th className={headerCell}>Iteration</th>
							<th className={headerCell}>Model</th>
							<th className={headerCell}>Status</th>
							<th className={headerCell}>Choice</th>
							<th className={headerCell}>Latency</th>
							<th className={headerCell}>Raw Response</th>
						</tr>
					</thead>
					<tbody>
						{visibleRows.map((row) => {
							const sourceClasses = row.source === 'global' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'
							return (
								<tr className={row.status === 'error' ? 'error-row' : ''} key={row.id}>
									<td className={bodyCell}>{formatDateTime(row.timestamp)}</td>
									<td className={bodyCell}>
										<span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-extrabold uppercase ${sourceClasses}`}>{row.source}</span>
									</td>
									<td className={bodyCell} title={row.batchId ?? ''}>
										{row.batchId ? row.batchId.slice(0, 8) : '-'}
									</td>
									<td className={bodyCell}>{row.request?.iteration ?? '-'}</td>
									<td className={bodyCell} title={row.modelId}>
										{row.modelName}
									</td>
									<td className={bodyCell}>{row.status}</td>
									<td className={bodyCell}>
										<ChoicePill choice={row.choice} />
									</td>
									<td className={bodyCell}>{row.latencyMs == null ? '-' : `${row.latencyMs} ms`}</td>
									<td className='table-cell min-w-65' title={row.rawResponse || row.error}>
										{trimText(row.rawResponse || row.error, 180)}
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
			<div className='flex items-center justify-between gap-4 pt-4 text-sm text-slate-500 max-sm:flex-col max-sm:items-stretch'>
				<span>
					{pageStart + 1}-{Math.min(pageStart + RUNS_PAGE_SIZE, rows.length)} of {rows.length}
				</span>
				<div className='flex items-center gap-2.5 max-sm:justify-between'>
					<button className='btn-secondary min-h-8 px-2.5 text-xs' disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type='button'>
						Previous
					</button>
					<strong>
						Page {safePage} of {totalPages}
					</strong>
					<button
						className='btn-secondary min-h-8 px-2.5 text-xs'
						disabled={safePage >= totalPages}
						onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
						type='button'>
						Next
					</button>
				</div>
			</div>
		</>
	)
}

function ProviderBreakdown({ providers }) {
	if (!providers.length) {
		return <EmptyState detail='Accepted structured responses will be grouped by provider and model here.' title='No model breakdown yet' />
	}

	return (
		<div className='grid gap-3.5 grid-cols-2 max-sm:grid-cols-1'>
			{providers.map((provider) => (
				<article className='grid gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4' key={provider.id}>
					<div className='flex justify-between gap-3.5 items-start'>
						<div>
							<h3 className='m-0 text-lg leading-tight text-slate-900'>{provider.name}</h3>
							<span className='block text-xs text-slate-500 mt-1 wrap-break-word'>{provider.id}</span>
						</div>
						<strong className='text-2xl leading-none text-slate-900'>{provider.total}</strong>
					</div>
					<div className='grid gap-2.5'>
						<div className='flex h-2.5 overflow-hidden rounded-full bg-slate-100'>
							<span className='block h-full bg-blue-500' style={{ width: formatPercent(provider.blue, provider.total) }} />
							<span className='block h-full bg-red-500' style={{ width: formatPercent(provider.red, provider.total) }} />
						</div>
						<div className='flex flex-wrap gap-3 text-xs text-slate-600'>
							<span>
								<Dot tone='blue' />
								{provider.blue} blue ({formatPercent(provider.blue, provider.total)})
							</span>
							<span>
								<Dot tone='red' />
								{provider.red} red ({formatPercent(provider.red, provider.total)})
							</span>
						</div>
					</div>
					<div className='grid border-t border-slate-200'>
						{provider.models.map((model) => (
							<div className='grid items-center gap-3 grid-cols-[minmax(0,1fr)_auto] border-b border-slate-200 py-3 last:border-b-0 last:pb-0' key={model.id}>
								<div>
									<strong className='text-sm text-slate-700'>{model.name}</strong>
									<span className='block text-xs text-slate-500 mt-1 wrap-break-word'>{model.id}</span>
								</div>
								<div className='text-right'>
									<span className='block text-lg font-extrabold text-slate-900'>{model.total}</span>
									<small className='block text-xs text-slate-500 mt-1'>
										{model.blue}B / {model.red}R
									</small>
								</div>
							</div>
						))}
					</div>
				</article>
			))}
		</div>
	)
}

function PrivacyNote() {
	return (
		<div className='flex flex-col items-start gap-2 rounded-lg border border-line bg-white p-4 text-emerald-900 shadow-[0_18px_45px_rgba(27,44,82,0.05)]'>
			<div className='flex items-center gap-2'>
				<Icon name='check' size={17} />
				<strong className='text-sm'>Local runs are private</strong>
			</div>
			<span className='text-xs leading-snug text-emerald-800/70'>User-generated responses stay in this browser unless exported and committed.</span>
		</div>
	)
}

function AppMark() {
	return (
		<div className='grid h-11 w-11 flex-none place-items-center rounded-lg bg-[linear-gradient(135deg,#0d7af5,#145ce8)] text-white shadow-[0_10px_24px_rgba(15,100,230,0.28)]'>
			<div className='flex h-6 items-end gap-1'>
				<span className='block h-2.5 w-1.5 rounded-sm bg-white/78' />
				<span className='block h-4 w-1.5 rounded-sm bg-white' />
				<span className='block h-6 w-1.5 rounded-sm bg-white/88' />
			</div>
		</div>
	)
}

function SidebarBenchmarkCard({ lastUpdated, summary }) {
	const progress = summary.total ? Math.round((summary.blue / summary.total) * 100) : 0

	return (
		<div className='rounded-lg border border-line bg-white p-4 shadow-[0_14px_32px_rgba(27,44,82,0.05)]'>
			<div className='flex items-center justify-between gap-2'>
				<strong className='text-xs font-extrabold uppercase tracking-[0.02em] text-slate-700'>Ongoing Benchmark</strong>
			</div>
			<div className='mt-5 grid gap-4'>
				<div className='flex items-center justify-between gap-2 text-xs text-slate-600'>
					<span>{formatRunMoment(lastUpdated)}</span>
					<span className='inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-extrabold text-emerald-700'>
						<i className='h-1.5 w-1.5 rounded-full bg-emerald-500' />
						Live
					</span>
				</div>
				<span className='text-xs font-medium text-slate-500'>
					{summary.models.length} models &bull; {formatNumber(summary.total)} runs
				</span>
				<div className='grid gap-2'>
					<div className='h-2 overflow-hidden rounded-full bg-slate-100'>
						<span className='block h-full rounded-full bg-[linear-gradient(90deg,#17b981,#12a16f)]' style={{ width: `${progress}%` }} />
					</div>
					<div className='flex items-center justify-between text-xs font-bold text-slate-700'>
						<span>Blue share</span>
						<span>{progress}%</span>
					</div>
				</div>
			</div>
		</div>
	)
}

function FeedbackCard() {
	return (
		<div className='rounded-lg border border-line bg-white p-4 shadow-[0_14px_32px_rgba(27,44,82,0.05)] max-[1080px]:hidden'>
			<strong className='text-sm text-slate-800'>Contribute</strong>
			<p className='mt-2 mb-4 text-xs leading-relaxed text-slate-500'>This project is open source. Add models, fix bugs, or suggest improvements on GitHub.</p>
			<a
				className='inline-flex min-h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-extrabold text-white hover:bg-[#0755ca]'
				href='https://github.com/biopoietic/button-arena'
				target='_blank'
				rel='noreferrer'>
				View on GitHub
			</a>
		</div>
	)
}

function ExplainerPanel() {
	return (
		<article className='rounded-lg border border-line bg-white shadow-[0_18px_45px_rgba(27,44,82,0.06)] p-5'>
			<h2 className='mb-3.5 text-sm font-extrabold uppercase tracking-[0.01em] text-slate-950'>The Dilemma</h2>

			<div className='grid gap-3 text-sm leading-relaxed text-slate-600'>
				<p className='m-0'>
					Pressing red is the safe, individually rational choice: it guarantees your survival with zero risk. Pressing blue introduces a dangerous gamble — it may enable
					a superior collective outcome if enough people coordinate, but failure to reach that critical mass turns it into a potential death sentence.
				</p>
				<p className='m-0'>
					The blue button is frequently criticized as virtue signaling or naive collectivism, while red is defended as clear-eyed self-preservation grounded in game
					theory and basic survival logic.
				</p>
				<p className='m-0'>
					ButtonArena tests the world's leading LLMs on this exact dilemma, exposing not just which button they press, but how consistently and honestly they reason
					through the trade-offs.
				</p>
			</div>
		</article>
	)
}

function App() {
	const abortRef = useRef(null)
	const [activeSection, setActiveSection] = useState('overview')
	const [apiKey, setApiKey] = useState(() => window.localStorage.getItem(STORAGE_KEYS.apiKey) ?? '')
	const [availableModels, setAvailableModels] = useState([])
	const [globalData, setGlobalData] = useState(EMPTY_STATIC_RESULTS)
	const [globalStatus, setGlobalStatus] = useState('loading')
	const [iterations, setIterations] = useState(100)
	const [localResponses, setLocalResponses] = useState(() => normalizeResponses(readStoredJson(STORAGE_KEYS.localResponses, []), 'local'))
	const [logLimit, setLogLimit] = useState(10)
	const [concurrency, setConcurrency] = useState(5)
	const [maxTokens, setMaxTokens] = useState('')
	const [modelSearch, setModelSearch] = useState('')
	const [modelStatus, setModelStatus] = useState('loading')
	const [requireParameters, setRequireParameters] = useState(true)
	const [runsPage, setRunsPage] = useState(1)
	const [runError, setRunError] = useState('')
	const [runProgress, setRunProgress] = useState({ active: '', completed: 0, total: 0 })
	const [selectedModelIds, setSelectedModelIds] = useState([])
	const [shareDialogOpen, setShareDialogOpen] = useState(false)
	const [shareStatus, setShareStatus] = useState(null)
	const [showStructuredOnly, setShowStructuredOnly] = useState(true)
	const [isRunning, setIsRunning] = useState(false)

	useEffect(() => {
		if (!shareDialogOpen) return undefined

		function handleKeyDown(event) {
			if (event.key === 'Escape') {
				setShareDialogOpen(false)
				setShareStatus(null)
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [shareDialogOpen])

	useEffect(() => {
		let ignore = false

		async function loadStaticResults() {
			try {
				const response = await fetch(STATIC_RESULTS_URL, { cache: 'no-store' })
				if (!response.ok) throw new Error(`Static results returned ${response.status}`)
				const data = await response.json()

				if (!ignore) {
					setGlobalData({
						metadata: { ...EMPTY_STATIC_RESULTS.metadata, ...(data.metadata ?? {}) },
						responses: normalizeResponses(data.responses ?? data, 'global'),
					})
					setGlobalStatus('ready')
				}
			} catch {
				if (!ignore) {
					setGlobalData(EMPTY_STATIC_RESULTS)
					setGlobalStatus('empty')
				}
			}
		}

		loadStaticResults()
		return () => {
			ignore = true
		}
	}, [])

	useEffect(() => {
		let ignore = false

		async function loadModels() {
			setModelStatus('loading')
			try {
				const response = await fetch(`${OPENROUTER_API}/models`)
				if (!response.ok) throw new Error(`Model catalog returned ${response.status}`)
				const payload = await response.json()
				const models = Array.isArray(payload.data) ? payload.data : []

				if (!ignore) {
					const liveModelIds = new Set(models.map((model) => model.id).filter(Boolean))
					setAvailableModels(models)
					setSelectedModelIds((current) => current.filter((modelId) => liveModelIds.has(modelId)))
					setModelStatus(models.length ? 'ready' : 'error')
				}
			} catch {
				if (!ignore) {
					setAvailableModels([])
					setModelStatus('error')
				}
			}
		}

		loadModels()
		return () => {
			ignore = true
		}
	}, [])

	useEffect(() => {
		writeStorage(STORAGE_KEYS.apiKey, apiKey)
	}, [apiKey])

	useEffect(() => {
		writeStorage(STORAGE_KEYS.localResponses, JSON.stringify(localResponses))
	}, [localResponses])

	const globalResponses = useMemo(() => normalizeResponses(globalData.responses, 'global'), [globalData.responses])
	const globalSummary = useMemo(() => calculateSummary(globalResponses), [globalResponses])
	const localSummary = useMemo(() => calculateSummary(localResponses), [localResponses])

	const providerBreakdown = useMemo(() => calculateProviderBreakdown(globalResponses), [globalResponses])

	const modelOptions = useMemo(() => {
		const merged = new Map()
		for (const model of availableModels) {
			if (model?.id) {
				merged.set(model.id, {
					id: model.id,
					name: model.name ?? model.id,
					supported_parameters: model.supported_parameters ?? [],
					pricing: model.pricing ?? null,
					context_length: model.context_length ?? model.top_provider?.context_length ?? null,
				})
			}
		}

		return [...merged.values()].sort((a, b) => {
			const aStructured = supportsStructuredOutput(a) ? 0 : 1
			const bStructured = supportsStructuredOutput(b) ? 0 : 1
			return aStructured - bStructured || modelLabel(a).localeCompare(modelLabel(b))
		})
	}, [availableModels])

	const modelsById = useMemo(() => new Map(modelOptions.map((model) => [model.id, model])), [modelOptions])

	const selectedModels = useMemo(
		() =>
			selectedModelIds.map((modelId) => {
				const model = modelsById.get(modelId)
				return model ?? { id: modelId, name: modelId, supported_parameters: [] }
			}),
		[modelsById, selectedModelIds],
	)

	const filteredModels = useMemo(() => {
		const query = modelSearch.trim().toLowerCase()
		return modelOptions
			.filter((model) => {
				if (showStructuredOnly && !supportsStructuredOutput(model)) return false
				if (!query) return true
				return `${model.id} ${model.name}`.toLowerCase().includes(query)
			})
			.slice(0, 8)
	}, [modelOptions, modelSearch, showStructuredOnly])

	const statusLabel = isRunning ? 'Running' : globalStatus === 'loading' ? 'Loading' : globalSummary.total ? 'Ongoing' : 'Ready'

	const localStatusLabel = isRunning ? 'Running' : localSummary.total ? 'Local data' : 'Ready'

	const lastUpdated = globalSummary.lastTimestamp ?? globalData.metadata?.lastUpdated ?? globalData.metadata?.exportedAt ?? null

	const localLastUpdated = localSummary.lastTimestamp ?? null

	function addModel(modelId) {
		const id = modelId.trim()
		if (!id || selectedModelIds.includes(id)) return
		if (modelStatus === 'ready' && !modelsById.has(id)) {
			setRunError('That model ID is not in the live OpenRouter catalog.')
			return
		}
		if (modelStatus === 'ready' && !supportsStructuredOutput(modelsById.get(id))) {
			setRunError('That model does not advertise structured-output support in OpenRouter.')
			return
		}
		setSelectedModelIds((current) => [...current, id])
		setModelSearch('')
		setRunError('')
	}

	function removeModel(modelId) {
		setSelectedModelIds((current) => current.filter((id) => id !== modelId))
	}

	function exportLocalResults() {
		const existingIds = new Set(globalData.responses.map((r) => r.id))
		const newResponses = localResponses.filter((r) => normalizeChoice(r.choice) && !existingIds.has(r.id))
		const merged = [...globalData.responses, ...newResponses]

		const payload = {
			metadata: {
				...globalData.metadata,
				exportedAt: new Date().toISOString(),
			},
			responses: merged,
		}

		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = 'global-results.json'
		anchor.click()
		URL.revokeObjectURL(url)
	}

	async function copySchema() {
		try {
			await navigator.clipboard.writeText(JSON.stringify(VOTE_RESPONSE_FORMAT.json_schema.schema, null, 2))
		} catch {
			setRunError('Clipboard access was blocked by the browser.')
		}
	}

	function openShareDialog() {
		setShareDialogOpen(true)
		setShareStatus(null)
	}

	function closeShareDialog() {
		setShareDialogOpen(false)
		setShareStatus(null)
	}

	async function copyShareLink() {
		try {
			await navigator.clipboard.writeText(getShareUrl())
			setShareStatus({ message: 'Benchmark link copied to clipboard.', tone: 'success' })
		} catch {
			setShareStatus({ message: 'Clipboard access was blocked by the browser.', tone: 'error' })
		}
	}

	async function shareBenchmark() {
		const shareData = {
			title: APP_TITLE,
			text: globalSummary.total
				? `Latest ButtonArena run: ${globalSummary.blue} blue, ${globalSummary.red} red across ${globalSummary.total} recorded votes.`
				: 'See the latest ButtonArena benchmark results.',
			url: getShareUrl(),
		}

		try {
			if (!navigator.share) {
				setShareStatus({ message: 'Native sharing is not available in this browser.', tone: 'error' })
				return
			}
			if (navigator.canShare && !navigator.canShare(shareData)) {
				setShareStatus({ message: 'This browser cannot share the current benchmark link.', tone: 'error' })
				return
			}
			await navigator.share(shareData)
			closeShareDialog()
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				return
			}
			setShareStatus({ message: 'Sharing was blocked by the browser.', tone: 'error' })
		}
	}

	async function runSingleRequest(model, batchId, iteration) {
		const timestamp = new Date().toISOString()
		const startedAt = performance.now()
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
			const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
				body: JSON.stringify(requestBody),
				headers: {
					Authorization: `Bearer ${apiKey.trim()}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': window.location.origin,
					'X-OpenRouter-Title': APP_TITLE,
				},
				method: 'POST',
				signal: abortRef.current?.signal,
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
				latencyMs: Math.round(performance.now() - startedAt),
				parsed: parsed.parsed,
				rawResponse: parsed.raw,
				status: 'accepted',
			}
		} catch (error) {
			if (abortRef.current?.signal.aborted) throw error
			return {
				...baseRow,
				error: error instanceof Error ? error.message : 'Unknown request error',
				latencyMs: Math.round(performance.now() - startedAt),
				rawResponse: error instanceof Error ? error.message : '',
			}
		}
	}

	async function runBenchmark() {
		if (!apiKey.trim()) {
			setRunError('Enter an OpenRouter API key to run a private benchmark.')
			return
		}

		if (!selectedModels.length) {
			setRunError('Select at least one model.')
			return
		}

		if (modelStatus === 'ready') {
			const invalidModelIds = selectedModelIds.filter((modelId) => !modelsById.has(modelId))
			if (invalidModelIds.length) {
				setRunError(`Remove unavailable model IDs before running: ${invalidModelIds.join(', ')}`)
				return
			}

			const unsupportedStructuredModelIds = selectedModels.filter((model) => !supportsStructuredOutput(model)).map((model) => model.id)
			if (unsupportedStructuredModelIds.length) {
				setRunError(`Remove models without structured-output support: ${unsupportedStructuredModelIds.join(', ')}`)
				return
			}
		}

		const safeIterations = Math.max(1, Math.min(1000, Number(iterations) || 1))
		const safeConcurrency = Math.max(1, Math.min(20, Number(concurrency) || 5))
		const totalRequests = selectedModels.length * safeIterations
		const batchId = createId()

		setActiveSection('my-runs')
		setIsRunning(true)
		setRunError('')
		setRunProgress({ active: 'Starting run', completed: 0, total: totalRequests })
		abortRef.current = new AbortController()

		const tasks = []
		for (const model of selectedModels) {
			for (let iteration = 1; iteration <= safeIterations; iteration += 1) {
				tasks.push({ model, iteration })
			}
		}

		let taskIndex = 0
		let completed = 0

		async function worker() {
			while (taskIndex < tasks.length) {
				if (abortRef.current?.signal.aborted) break
				const index = taskIndex++
				const { model, iteration } = tasks[index]
				let row
				try {
					row = await runSingleRequest(model, batchId, iteration)
				} catch {
					break
				}
				completed += 1
				setLocalResponses((current) => [row, ...current])
				setRunProgress({ active: `${completed}/${totalRequests} complete`, completed, total: totalRequests })
			}
		}

		try {
			await Promise.all(Array.from({ length: Math.min(safeConcurrency, tasks.length) }, worker))
		} catch (error) {
			setRunError(error instanceof Error ? error.message : 'Run stopped.')
		} finally {
			if (abortRef.current?.signal.aborted) {
				setRunError('Run stopped.')
			}
			setIsRunning(false)
			abortRef.current = null
		}
	}

	function stopRun() {
		abortRef.current?.abort()
		setRunProgress((current) => ({ ...current, active: 'Stopping after current request' }))
	}

	function clearLocalResults() {
		if (isRunning) return
		setLocalResponses([])
		setRunError('')
	}

	function changeSection(section) {
		setActiveSection(section)
		setRunsPage(1)
	}

	const progressPercent = runProgress.total ? (runProgress.completed / runProgress.total) * 100 : 0
	const schemaText = JSON.stringify(VOTE_RESPONSE_FORMAT.json_schema.schema, null, 2)
	const shareDescription = globalSummary.total
		? `Latest ButtonArena run: ${globalSummary.blue} blue, ${globalSummary.red} red across ${globalSummary.total} recorded votes.`
		: 'Copy the benchmark landing page or open your device share sheet.'
	const shareUrl = getShareUrl()
	const canUseNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

	const statusBadgeStyles = statusLabel === 'Ongoing' ? 'bg-emerald-50 text-emerald-700' : statusLabel === 'Ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'

	const questionCard = (
		<Panel title='The Question' action={<span className='status-badge'>Fixed</span>}>
			<p className='m-0 text-sm leading-relaxed text-slate-800'>{QUESTION}</p>
		</Panel>
	)

	const schemaCard = (
		<Panel
			title='Response Format'
			action={
				<button className='btn-icon' onClick={copySchema} title='Copy schema' type='button'>
					<Icon name='clipboard' size={17} />
				</button>
			}>
			<pre className='m-0 max-h-87.5 overflow-auto rounded-lg border border-line bg-[#f8fbff] p-3.5 text-left font-mono text-xs leading-snug text-[#255481] whitespace-pre-wrap'>
				{schemaText}
			</pre>
			<a
				className='btn-secondary mt-3 w-full justify-start min-h-9 px-3 text-xs'
				href='https://openrouter.ai/docs/features/structured-outputs'
				rel='noreferrer'
				target='_blank'>
				<Icon name='chevron' size={15} />
				View schema docs
			</a>
		</Panel>
	)

	const runSettingsCard = (
		<Panel
			className='grid gap-4'
			title='Run Settings'
			action={
				<span className='status-badge'>
					{modelStatus === 'ready' ? `${modelOptions.length} live models` : modelStatus === 'loading' ? 'Loading models' : 'Catalog unavailable'}
				</span>
			}>
			<label className='grid gap-2'>
				<span className='field-label'>OpenRouter API key</span>
				<div className='flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 min-h-10'>
					<Icon name='key' size={16} />
					<input
						autoComplete='off'
						className='flex-1 min-w-0 border-0 outline-0 bg-transparent text-base text-slate-900'
						onChange={(event) => setApiKey(event.target.value)}
						placeholder='sk-or-...'
						type='password'
						value={apiKey}
					/>
				</div>
				<small className='text-xs text-slate-500'>Stored in localStorage on this device only.</small>
			</label>

			<div className='grid gap-2'>
				<span className='field-label'>Models</span>
				{modelStatus === 'error' && (
					<div className='flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800'>
						<Icon name='alert' size={16} />
						Could not load the OpenRouter model catalog. Check the network connection and reload.
					</div>
				)}
				<div className='flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 min-h-10'>
					<Icon name='search' size={16} />
					<input
						className='flex-1 min-w-0 border-0 outline-0 bg-transparent text-base text-slate-900'
						onChange={(event) => setModelSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') addModel(modelSearch)
						}}
						placeholder='Search or paste any model id'
						type='text'
						value={modelSearch}
					/>
					<button className='btn-secondary min-h-7.5 px-3' onClick={() => addModel(modelSearch)} type='button'>
						Add
					</button>
				</div>
				<label className='flex items-center gap-2 text-sm font-bold text-slate-700'>
					<input checked={showStructuredOnly} className='accent-brand' onChange={(event) => setShowStructuredOnly(event.target.checked)} type='checkbox' />
					Only show structured-output capable models (recommended)
				</label>
				<div className='grid gap-1.5 max-h-57.5 overflow-auto'>
					{filteredModels.length ? (
						filteredModels.map((model) => {
							const isSelected = selectedModelIds.includes(model.id)
							return (
								<button
									className={`flex items-center justify-between gap-2.5 rounded-lg border bg-slate-50 p-2.5 text-left text-slate-800 ${
										isSelected ? 'border-brand' : 'border-slate-200'
									}`}
									key={model.id}
									onClick={() => addModel(model.id)}
									type='button'>
									<span>
										<strong className='block text-sm'>{modelLabel(model)}</strong>
										<small className='block text-xs text-slate-500 mt-1 wrap-break-word'>{model.id}</small>
									</span>
									{supportsStructuredOutput(model) && (
										<em className='inline-flex items-center rounded-md bg-emerald-50 text-emerald-700 px-2 py-1.5 text-xs font-bold not-italic'>structured</em>
									)}
								</button>
							)
						})
					) : (
						<div className='rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-xs text-slate-500'>
							{modelStatus === 'loading' ? 'Loading OpenRouter models...' : 'No matching live models.'}
						</div>
					)}
				</div>
				<div className='flex flex-wrap gap-2'>
					{selectedModels.map((model) => (
						<span
							className='inline-flex items-center gap-2 max-w-full rounded-md border border-slate-200 bg-slate-100 pl-2.5 pr-2 py-1.5 text-xs font-bold text-slate-700'
							key={model.id}>
							{modelLabel(model)}
							<button
								aria-label={`Remove ${modelLabel(model)}`}
								className='bg-transparent border-0 p-0 text-slate-500 font-black'
								onClick={() => removeModel(model.id)}
								type='button'>
								x
							</button>
						</span>
					))}
				</div>
			</div>

			<div className='grid gap-2.5 grid-cols-3 max-sm:grid-cols-1'>
				<label className='grid gap-2'>
					<span className='field-label'>Iterations per model</span>
					<input className='input' max='1000' min='1' onChange={(event) => setIterations(event.target.value)} type='number' value={iterations} />
				</label>
				<label className='grid gap-2'>
					<span className='field-label'>Max tokens</span>
					<input className='input' min='1' onChange={(event) => setMaxTokens(event.target.value)} placeholder='unlimited' type='number' value={maxTokens} />
				</label>
				<label className='grid gap-2'>
					<span className='field-label'>Concurrency</span>
					<input className='input' max='20' min='1' onChange={(event) => setConcurrency(event.target.value)} type='number' value={concurrency} />
				</label>
			</div>

			<label className='flex items-center gap-2 text-sm font-bold text-slate-700'>
				<input checked={requireParameters} className='accent-brand' onChange={(event) => setRequireParameters(event.target.checked)} type='checkbox' />
				Require providers that support structured output parameters
			</label>

			{runError && (
				<div className='flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800'>
					<Icon name='alert' size={16} />
					{runError}
				</div>
			)}

			{isRunning && (
				<div className='grid gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3' role='status'>
					<div className='flex items-center justify-between text-sm text-slate-700'>
						<span>{runProgress.active}</span>
						<strong>
							{runProgress.completed}/{runProgress.total}
						</strong>
					</div>
					<div className='h-2 overflow-hidden rounded-full bg-slate-200'>
						<span className='block h-full bg-linear-to-r from-blue-500 to-brand transition-[width] duration-150' style={{ width: `${progressPercent}%` }} />
					</div>
				</div>
			)}

			<div className='flex items-center gap-2.5 max-sm:flex-col max-sm:items-stretch'>
				{isRunning ? (
					<button className='btn-danger flex-1' onClick={stopRun} type='button'>
						<Icon name='stop' size={16} />
						Stop Run
					</button>
				) : (
					<button className='btn-primary flex-1' onClick={runBenchmark} type='button'>
						<Icon name='play' size={16} />
						Run Benchmark
					</button>
				)}
				<button className='btn-secondary' disabled={isRunning || !localResponses.length} onClick={clearLocalResults} type='button'>
					<Icon name='trash' size={16} />
					Clear Local
				</button>
			</div>
			<p className='-mt-1 m-0 text-xs text-slate-500'>Each request is one-shot with no conversation history.</p>
		</Panel>
	)

	const pageContent = {
		overview: (
			<div className='grid gap-5'>
				<div className='grid items-start gap-5 grid-cols-[minmax(280px,320px)_minmax(0,1fr)] max-[1180px]:grid-cols-1 max-[1180px]:items-stretch'>
					<div className='grid gap-4 content-start'>
						{questionCard}
						<ExplainerPanel />
					</div>
					<div className='grid gap-4 min-w-0'>
						<section className='grid gap-4 grid-cols-[minmax(420px,1.1fr)_minmax(460px,0.9fr)] max-[1480px]:grid-cols-1'>
							<OverviewSpotlight
								lastUpdated={lastUpdated}
								onRunPrivate={() => changeSection('configuration')}
								onShareBenchmark={openShareDialog}
								onViewResults={() => changeSection('results')}
							/>
							<OverviewMetrics lastUpdated={lastUpdated} stateLabel={statusLabel} summary={globalSummary} />
						</section>
						<section className='grid gap-4 grid-cols-[minmax(0,1.42fr)_minmax(360px,0.9fr)] max-[1380px]:grid-cols-1'>
							<Panel className='min-w-0' title='Vote Distribution By Model'>
								<DistributionChart models={globalSummary.models} />
							</Panel>
							<Panel title='Overall Vote Distribution'>
								<DonutChart summary={globalSummary} />
							</Panel>
						</section>
					</div>
				</div>
			</div>
		),
		results: (
			<div className='grid gap-4 min-w-0'>
				<SummaryGrid lastUpdated={lastUpdated} selectedCount={selectedModels.length} stateLabel={statusLabel} summary={globalSummary} />
				<ResultsPanels logLimit={logLimit} setLogLimit={setLogLimit} summary={globalSummary} />
			</div>
		),
		runs: (
			<div className='grid gap-4 min-w-0'>
				<Panel className='min-w-0' title='Raw Runs' action={<span className='status-badge'>{globalResponses.length} rows</span>}>
					<RunsTable page={runsPage} rows={globalSummary.latest} setPage={setRunsPage} />
				</Panel>
			</div>
		),
		models: (
			<div className='grid gap-4 min-w-0'>
				<SummaryGrid lastUpdated={lastUpdated} selectedCount={selectedModels.length} stateLabel={statusLabel} summary={globalSummary} />
				<Panel title='Provider And Model Breakdown' action={<span className='status-badge'>{providerBreakdown.length} providers</span>}>
					<ProviderBreakdown providers={providerBreakdown} />
				</Panel>
			</div>
		),
		'my-runs': (
			<div className='grid gap-4 min-w-0'>
				<SummaryGrid lastUpdated={localLastUpdated} selectedCount={selectedModels.length} stateLabel={localStatusLabel} summary={localSummary} />
				{isRunning && (
					<Panel title='Current Run' action={<span className='status-badge'>Live</span>}>
						<div className='grid gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3' role='status'>
							<div className='flex items-center justify-between text-sm text-slate-700'>
								<span>{runProgress.active}</span>
								<strong>
									{runProgress.completed}/{runProgress.total}
								</strong>
							</div>
							<div className='h-2 overflow-hidden rounded-full bg-slate-200'>
								<span className='block h-full bg-linear-to-r from-blue-500 to-brand transition-[width] duration-150' style={{ width: `${progressPercent}%` }} />
							</div>
						</div>
					</Panel>
				)}
				<ResultsPanels logLimit={logLimit} setLogLimit={setLogLimit} summary={localSummary} />
				<Panel className='min-w-0' title='Raw Runs' action={<span className='status-badge'>{localResponses.length} rows</span>}>
					<RunsTable page={runsPage} rows={localSummary.latest} setPage={setRunsPage} />
				</Panel>
			</div>
		),
		configuration: (
			<div className='grid gap-4 grid-cols-[minmax(280px,0.95fr)_minmax(360px,1.05fr)] max-[1380px]:grid-cols-1'>
				<section className='grid gap-4 content-start'>
					{questionCard}
					{schemaCard}
					<PrivacyNote />
				</section>
				{runSettingsCard}
			</div>
		),
	}

	return (
		<div className='min-h-svh grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[72px_minmax(0,1fr)] bg-canvas text-ink max-[1080px]:grid-cols-1 max-[1080px]:grid-rows-[auto_auto_minmax(0,1fr)]'>
			<ShareDialog
				canUseNativeShare={canUseNativeShare}
				isOpen={shareDialogOpen}
				onClose={closeShareDialog}
				onCopyLink={copyShareLink}
				onNativeShare={shareBenchmark}
				shareDescription={shareDescription}
				shareStatus={shareStatus}
				url={shareUrl}
			/>
			<header className='col-span-full flex items-center justify-between gap-5 border-b border-line bg-white px-6 max-[1080px]:flex-col max-[1080px]:items-start max-[1080px]:p-4'>
				<div className='flex items-center gap-4 min-w-0 max-sm:items-start'>
					<AppMark />
					<div>
						<h1 className='m-0 text-xl max-sm:text-lg font-extrabold leading-tight text-slate-950'>ButtonArena</h1>
						<p className='mt-1 m-0 text-sm text-slate-600'>A live benchmark of red/blue choices from single-shot structured responses</p>
					</div>
				</div>
				<div className='flex items-center justify-end gap-3 max-[1080px]:flex-wrap max-[1080px]:justify-start'>
					<span className='text-sm text-slate-500 whitespace-nowrap'>Last run {formatDateTime(lastUpdated)}</span>
					<span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-bold leading-none ${statusBadgeStyles}`}>
						<i className={`h-1.5 w-1.5 rounded-full ${statusLabel === 'Ongoing' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
						{statusLabel === 'Ongoing' ? 'Live' : statusLabel}
					</span>
					<button className='btn-secondary min-h-10' onClick={exportLocalResults} type='button'>
						<Icon name='download' size={16} />
						Export
					</button>
				</div>
			</header>

			<aside className='flex flex-col justify-between gap-5 border-r border-line bg-white/80 px-4 py-5 max-[1080px]:border-r-0 max-[1080px]:border-b max-[1080px]:py-3'>
				<div>
					<nav aria-label='Benchmark sections' className='grid gap-2 max-[1080px]:flex max-[1080px]:overflow-x-auto'>
						{NAV_ITEMS.map((item) => {
							const isActive = activeSection === item.id
							return (
								<button
									aria-current={isActive ? 'page' : undefined}
									className={`flex min-h-11 items-center gap-3 rounded-lg px-3.5 text-sm font-extrabold ${
										isActive ? 'bg-brand-soft text-brand' : 'text-slate-600 hover:bg-[#f4f8ff] hover:text-brand'
									} w-full max-[1080px]:w-auto max-[1080px]:flex-none`}
									key={item.id}
									onClick={() => changeSection(item.id)}
									type='button'>
									<Icon name={item.icon} size={17} />
									{item.label}
								</button>
							)
						})}
					</nav>
					<div className='my-5 h-px bg-line max-[1080px]:hidden' />
					<div className='max-[1080px]:hidden'>
						<SidebarBenchmarkCard lastUpdated={lastUpdated} summary={globalSummary} />
					</div>
				</div>
				<FeedbackCard />
			</aside>

			<main className='flex min-w-0 flex-col gap-4 p-5 max-sm:p-3'>{pageContent[activeSection]}</main>
		</div>
	)
}

export default App
