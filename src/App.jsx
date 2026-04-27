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
	Monitor,
	Moon,
	Play,
	RefreshCw,
	Search,
	Settings,
	Share2,
	Shield,
	Square,
	Sun,
	Swords,
	Trash2,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
	EMPTY_STATIC_RESULTS,
	QUESTION,
	STORAGE_KEYS,
	VOTE_RESPONSE_FORMAT,
	calculateProviderBreakdown,
	calculateSummary,
	createId,
	modelLabel,
	normalizeChoice,
	normalizeResponses,
	readStoredJson,
	supportsStructuredOutput,
	writeStorage,
} from './lib/benchmark-core'
import { fetchModelCatalog, fetchStaticResults, runBenchmarkRequest } from './lib/benchmark-client'
import Logo from './assets/logo.svg?react'
import { ShareDialog } from './components/ShareDialog'

const CHART_COLORS = {
	blue: 'var(--color-blue)',
	red: 'var(--color-red)',
	grid: 'var(--color-line)',
	text: 'var(--color-ink-muted)',
	textStrong: 'var(--color-ink)',
}

const NAV_ITEMS = [
	{ id: 'overview', label: 'Overview', icon: 'home' },
	{ id: 'results', label: 'Results', icon: 'activity' },
	{ id: 'arena', label: 'Arena', icon: 'swords' },
	{ id: 'runs', label: 'Runs', icon: 'list' },
	{ id: 'models', label: 'Models', icon: 'box' },
	{ id: 'my-runs', label: 'My Runs', icon: 'play' },
	{ id: 'configuration', label: 'Configuration', icon: 'settings' },
]

const RUNS_PAGE_SIZE = 12

const ARENA_WINDOW = 150
const ARENA_DELAY_MIN = 1500
const ARENA_DELAY_MAX = 7500
const ARENA_TYPING_MIN = 700
const ARENA_TYPING_MAX = 3200
const ARENA_TYPING_PER_CHAR = 14

function shuffleArray(array) {
	const arr = [...array]
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[arr[i], arr[j]] = [arr[j], arr[i]]
	}
	return arr
}

const THEME_OPTIONS = [
	{ id: 'system', label: 'Use system theme', icon: 'monitor' },
	{ id: 'light', label: 'Use light theme', icon: 'sun' },
	{ id: 'dark', label: 'Use dark theme', icon: 'moon' },
]

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
	monitor: Monitor,
	moon: Moon,
	play: Play,
	refresh: RefreshCw,
	search: Search,
	settings: Settings,
	share: Share2,
	shield: Shield,
	stop: Square,
	sun: Sun,
	swords: Swords,
	trash: Trash2,
}

function Icon({ name, size = 18 }) {
	const LucideIcon = ICON_MAP[name]
	if (!LucideIcon) return null
	return <LucideIcon aria-hidden='true' size={size} />
}

function isThemePreference(value) {
	return value === 'system' || value === 'light' || value === 'dark'
}

function getSystemTheme() {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveThemePreference(preference) {
	return preference === 'light' || preference === 'dark' ? preference : getSystemTheme()
}

function getInitialThemePreference() {
	if (typeof document !== 'undefined' && isThemePreference(document.documentElement.dataset.themePreference)) {
		return document.documentElement.dataset.themePreference
	}

	if (typeof window === 'undefined') return 'system'

	try {
		const storedPreference = window.localStorage.getItem(STORAGE_KEYS.theme)
		return isThemePreference(storedPreference) ? storedPreference : 'system'
	} catch {
		return 'system'
	}
}

function ThemeSwitcher({ onChange, value }) {
	return (
		<div
			aria-label='Color theme'
			className='inline-grid grid-cols-3 items-center min-h-10 rounded-lg border border-line bg-surface-muted p-0.75 shadow-control max-md:hidden'
			role='group'>
			{THEME_OPTIONS.map((option) => {
				const isActive = value === option.id
				return (
					<button
						aria-pressed={isActive}
						className={`grid min-w-8.5 min-h-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent ${
							isActive ? 'bg-surface text-ink shadow-control' : 'text-ink-muted hover:text-ink'
						}`}
						key={option.id}
						onClick={() => onChange(option.id)}
						title={option.label}
						type='button'>
						<Icon name={option.icon} size={16} />
						<span className='sr-only'>{option.label}</span>
					</button>
				)
			})}
		</div>
	)
}

function Panel({ title, action, children, className = '' }) {
	return (
		<article className={`relative rounded-lg border border-line bg-surface shadow-soft p-4${className ? ` ${className}` : ''}`}>
			<div className='flex items-center justify-between gap-3 mb-3.5'>
				<h2 className='m-0 text-sm font-extrabold uppercase tracking-[0.01em] text-ink'>{title}</h2>
				{action}
			</div>
			{children}
		</article>
	)
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
	const color = tone === 'blue' ? 'bg-blue' : 'bg-red'
	return <i className={`inline-block h-2.5 w-2.5 rounded-full mr-2 align-[1px] ${color}`} />
}

function SummaryCard({ tone = 'neutral', icon, label, value, detail }) {
	const toneStyles = {
		neutral: { card: 'bg-surface', icon: 'bg-blue-soft text-blue-deep' },
		blue: { card: 'bg-linear-to-br from-surface to-blue-soft', icon: 'bg-blue-soft text-blue-deep' },
		red: { card: 'bg-linear-to-br from-surface to-red-soft', icon: 'bg-red-soft text-red-deep' },
		purple: { card: 'bg-surface', icon: 'bg-blue-soft text-blue' },
		green: { card: 'bg-linear-to-br from-surface to-success-soft', icon: 'bg-success-soft text-success' },
	}
	const tones = toneStyles[tone] ?? toneStyles.neutral

	return (
		<article className={`flex min-h-26 items-start gap-3 rounded-lg border border-line p-4 shadow-soft ${tones.card}`}>
			<div className={`grid h-9 w-9 flex-none place-items-center rounded-md ${tones.icon}`}>
				<Icon name={icon} size={19} />
			</div>
			<div className='min-w-0'>
				<span className='block text-[11px] font-extrabold uppercase tracking-[0.02em] text-ink-muted'>{label}</span>
				<strong className='my-2 block text-[26px] leading-none text-ink'>{value}</strong>
				<small className='block text-xs leading-snug text-ink-muted'>{detail}</small>
			</div>
		</article>
	)
}

function Sparkline({ tone = 'blue', values }) {
	const color = tone === 'blue' ? CHART_COLORS.blue : CHART_COLORS.red
	const data = values.map((value, index) => ({ index, value }))

	return (
		<div aria-hidden='true' className='h-8 min-w-0 w-full'>
			<ResponsiveContainer height='100%' initialDimension={{ height: 32, width: 180 }} minWidth={0} width='100%'>
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
					<span className='block text-[11px] font-extrabold uppercase tracking-[0.02em] text-ink-muted'>{label}</span>
					<strong className='mt-2 block text-[27px] leading-none text-ink'>{value}</strong>
					{detail && <span className='mt-2 block text-sm text-ink-muted'>{detail}</span>}
					{status && <span className='mt-2 block text-sm font-bold text-success'>{status}</span>}
				</div>
				{icon && (
					<div className='grid h-10 w-10 flex-none place-items-center rounded-lg border border-line bg-surface text-ink-muted shadow-control'>
						<Icon name={icon} size={20} />
					</div>
				)}
			</div>
		</div>
	)
}

function ShareMetricTile({ detail, label, tone, value, values }) {
	return (
		<div className='grid min-h-29 min-w-0 content-center border-r border-line p-4 last:border-r-0 max-sm:border-r-0 max-sm:border-b'>
			<span className='block text-[11px] font-extrabold uppercase tracking-[0.02em] text-ink-muted'>{label}</span>
			<strong className='mt-2 block text-[28px] leading-none text-ink'>{value}</strong>
			<div className='mt-3 min-w-0'>
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
		<section className='grid overflow-hidden rounded-lg border border-line bg-surface shadow-soft'>
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
			<strong className='text-ink'>{title}</strong>
			<span className='text-sm leading-normal max-w-sm'>{detail}</span>
		</div>
	)
}

function ChartTooltipBox({ active, label, payload }) {
	if (!active || !payload?.length) return null

	return (
		<div className='rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-soft'>
			{label && <strong className='mb-1.5 block max-w-60 truncate text-ink'>{label}</strong>}
			<div className='grid gap-1'>
				{payload.map((entry) => (
					<span className='flex items-center justify-between gap-5 text-ink-muted' key={`${entry.dataKey}-${entry.name}`}>
						<span className='inline-flex items-center gap-1.5'>
							<i className='h-2 w-2 rounded-full' style={{ backgroundColor: entry.color }} />
							{entry.name}
						</span>
						<strong className='font-extrabold text-ink'>
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
			<div className='flex items-center justify-center gap-7 text-sm text-ink-muted'>
				<span>
					<Dot tone='blue' />
					Blue (survive if &gt;50%)
				</span>
				<span>
					<Dot tone='red' />
					Red (always survive)
				</span>
			</div>
			<div className='min-w-0' style={{ height: chartHeight }}>
				<ResponsiveContainer height='100%' initialDimension={{ height: chartHeight, width: 640 }} minWidth={0} width='100%'>
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
						<YAxis axisLine={false} dataKey='name' tick={{ fill: CHART_COLORS.textStrong, fontSize: 13 }} tickLine={false} type='category' width={220} />
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
			<div className='mb-1 text-sm font-medium text-ink'>Trend over time</div>
			<div className='h-23 min-w-0 w-full'>
				<ResponsiveContainer height='100%' initialDimension={{ height: 92, width: 480 }} minWidth={0} width='100%'>
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
					<div className='relative z-10 h-full min-w-0 w-full'>
						<ResponsiveContainer height='100%' initialDimension={{ height: 232, width: 232 }} minWidth={0} width='100%'>
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
					<div className='pointer-events-none absolute inset-0 z-0 grid place-items-center text-center text-ink'>
						<span className='absolute h-[50%] w-[50%] rounded-full bg-surface' />
						<div className='relative z-10 grid'>
							<strong className='text-3xl leading-none'>{summary.total}</strong>
							<span className='text-sm text-ink-muted mt-2'>Total</span>
						</div>
					</div>
				</div>
				<div className='grid gap-6'>
					<div className='grid grid-cols-[auto_1fr] items-start'>
						<Dot tone='blue' />
						<span className='text-base text-ink'>Blue</span>
						<strong className='col-start-2 mt-1.5 text-sm font-normal text-ink-muted'>
							{summary.blue} ({formatPercent(summary.blue, summary.total)})
						</strong>
					</div>
					<div className='grid grid-cols-[auto_1fr] items-start'>
						<Dot tone='red' />
						<span className='text-base text-ink'>Red</span>
						<strong className='col-start-2 mt-1.5 text-sm font-normal text-ink-muted'>
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
		<section className='relative overflow-hidden min-h-63 rounded-lg ring-1 ring-line bg-linear-to-r from-blue to-blue/5 p-6 text-white shadow-[0_18px_45px_rgba(27,91,209,0.18)]'>
			<HeroPattern />
			<div className='relative z-10 grid h-full max-w-160 content-center gap-5'>
				<span className='status-badge w-fit bg-surface/16 text-white ring-1 ring-white/25'>
					<Icon name='refresh' size={14} />
					Ongoing Benchmark
				</span>
				<div>
					<h2 className='mb-3 text-[34px] font-extrabold leading-tight max-sm:text-2xl'>Which Button Does AI Press?</h2>
					<p className='mb-2'>See how models reason about altruism vs. self-interest.</p>
					<p>Latest published run: {formatDateTime(lastUpdated)}.</p>
				</div>
				<div className='flex flex-wrap gap-3'>
					<button className='button' onClick={onViewResults} type='button'>
						<Icon name='chevron' size={16} />
						View Results
					</button>
					<button className='button secondary' onClick={onRunPrivate} type='button'>
						<Icon name='play' size={16} />
						Run Privately
					</button>
					<button className='button secondary' onClick={onShareBenchmark} type='button'>
						<Icon name='share' size={16} />
						Share Benchmark
					</button>
				</div>
			</div>
		</section>
	)
}

function ChoicePill({ choice }) {
	if (!choice) {
		return <span className='inline-flex items-center rounded-md bg-red-soft text-red-deep px-2 py-1.5 text-xs font-bold lowercase'>invalid</span>
	}
	return (
		<span className='inline-flex items-center text-xs font-bold lowercase text-ink'>
			<Dot tone={choice} />
			{choice}
		</span>
	)
}

function ArenaVoteBar({ summary }) {
	const bluePercent = summary.total ? (summary.blue / summary.total) * 100 : 50
	return (
		<div className='grid gap-2 rounded-lg border border-line bg-surface-muted p-3.5'>
			<h2 className='mb-2 text-sm font-extrabold uppercase tracking-[0.01em] text-ink'>Live Replay</h2>
			<div className='h-3 overflow-hidden rounded-full bg-surface'>
				<div className='flex h-full'>
					<span className='block h-full bg-blue transition-[width] duration-500' style={{ width: `${bluePercent}%` }} />
					<span className='block h-full bg-red transition-[width] duration-500' style={{ width: `${100 - bluePercent}%` }} />
				</div>
			</div>
			<div className='flex items-center justify-between text-xs font-bold'>
				<span className='text-blue-deep'>
					<Dot tone='blue' />
					{formatPercent(summary.blue, summary.total)} Blue ({formatNumber(summary.blue)})
				</span>
				<span className='text-red-deep'>
					<Dot tone='red' />
					{formatPercent(summary.red, summary.total)} Red ({formatNumber(summary.red)})
				</span>
			</div>
		</div>
	)
}

function ArenaCard({ modelName, choice, children }) {
	return (
		<div className='rounded-lg border border-line bg-surface p-4'>
			<div className={`mb-3 text-xs font-semibold capitalize ${choice === 'red' ? 'text-red' : 'text-blue'}`}>{modelName}</div>
			{children}
		</div>
	)
}

function ArenaBubble({ modelName, choice, comment }) {
	return (
		<ArenaCard modelName={modelName} choice={choice}>
			<p className='text-sm leading-relaxed text-ink'>{comment}</p>
		</ArenaCard>
	)
}

function ArenaTypingIndicator({ modelName }) {
	return (
		<ArenaCard modelName={modelName}>
			<div className='pt-2 flex items-center gap-1'>
				{[0, 160, 320].map((delay) => (
					<span key={delay} className='h-1 w-1 animate-bounce rounded-full bg-ink-muted' style={{ animationDelay: `${delay}ms`, animationDuration: '900ms' }} />
				))}
			</div>
		</ArenaCard>
	)
}

function ArenaChat({ responses, height = 'calc(100svh - 270px)', minHeight = '440px' }) {
	const cycleIndexRef = useRef(0)
	const sortedRef = useRef([])
	const uidRef = useRef(0)
	const [messages, setMessages] = useState([])
	const [typingItems, setTypingItems] = useState([])

	const accepted = useMemo(() => responses.filter((r) => r.choice && r.comment && r.status === 'accepted'), [responses])

	useEffect(() => {
		if (!accepted.length || sortedRef.current.length) return
		const shuffled = shuffleArray(accepted)
		sortedRef.current = shuffled
		cycleIndexRef.current = 0
		setMessages(shuffled.slice(-ARENA_WINDOW).map((r) => ({ ...r, _uid: uidRef.current++ })))
	}, [accepted])

	useEffect(() => {
		let active = true
		const timers = new Set()

		function later(fn, ms) {
			const id = setTimeout(() => {
				timers.delete(id)
				fn()
			}, ms)
			timers.add(id)
		}

		function scheduleNext() {
			const delay = ARENA_DELAY_MIN + Math.random() * (ARENA_DELAY_MAX - ARENA_DELAY_MIN)
			later(() => {
				if (!active) return
				const sorted = sortedRef.current
				if (!sorted.length) {
					scheduleNext()
					return
				}

				// Capture item and advance index immediately so parallel schedules don't collide
				const item = sorted[cycleIndexRef.current % sorted.length]
				cycleIndexRef.current += 1

				const typingMs = Math.min(ARENA_TYPING_MIN + (item.comment?.length ?? 0) * ARENA_TYPING_PER_CHAR, ARENA_TYPING_MAX)
				const tid = uidRef.current++

				setTypingItems((prev) => [{ _tid: tid, choice: item.choice ?? 'blue', modelId: item.modelId, modelName: item.modelName }, ...prev])

				// Schedule the next cycle now so it can overlap with this typing indicator
				scheduleNext()

				later(() => {
					if (!active) return
					setTypingItems((prev) => prev.filter((t) => t._tid !== tid))
					setMessages((prev) => {
						const msg = { ...item, _uid: uidRef.current++ }
						const next = [msg, ...prev]
						return next.length > ARENA_WINDOW ? next.slice(0, ARENA_WINDOW) : next
					})
				}, typingMs)
			}, delay)
		}

		scheduleNext()

		return () => {
			active = false
			for (const id of timers) clearTimeout(id)
		}
	}, [])

	if (!accepted.length) {
		return <EmptyState detail='Accepted global responses will populate the live arena once loaded.' title='No arena votes yet' />
	}

	return (
		<div
			className='grid auto-rows-max gap-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [scrollbar-gutter:stable] content-start'
			style={{ height, minHeight }}>
			{typingItems.map((t) => (
				<ArenaTypingIndicator key={t._tid} modelName={t.modelName} />
			))}
			{messages.map((msg) => (
				<ArenaBubble key={msg._uid} modelName={msg.modelName} choice={msg.choice} comment={msg.comment} />
			))}
		</div>
	)
}

function ArenaChatMini({ responses }) {
	return (
		<div className='flex flex-col overflow-hidden rounded-b-lg max-2xl:max-h-120 2xl:sticky 2xl:top-23 2xl:h-[calc(100svh-112px)]'>
			<ArenaChat height='100%' minHeight='0' responses={responses} />
		</div>
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
						<th className='table-cell bg-surface-muted font-bold text-ink-muted'>Time</th>
						<th className='table-cell bg-surface-muted font-bold text-ink-muted'>Model</th>
						<th className='table-cell bg-surface-muted font-bold text-ink-muted'>Choice</th>
						<th className='table-cell bg-surface-muted font-bold text-ink-muted'>Comment</th>
						<th className='table-cell bg-surface-muted font-bold text-ink-muted'>Raw Response</th>
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
						className='button secondary min-h-8'
						disabled={!summary.latest.length}
						onClick={() => setLogLimit((current) => (current === 10 ? summary.latest.length : 10))}
						type='button'>
						{logLimit === 10 ? 'View all logs' : 'Latest 10'}
					</button>
				}>
				<ResponseTable limit={logLimit} rows={summary.latest} />
				<div className='flex justify-between text-xs text-ink-muted pt-4 max-sm:flex-col max-sm:gap-2'>
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

	const headerCell = 'table-cell bg-surface-muted font-bold text-ink-muted whitespace-nowrap'
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
							const sourceClasses = row.source === 'global' ? 'bg-blue-soft text-blue-deep' : 'bg-success-soft text-success'
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
			<div className='flex items-center justify-between gap-4 pt-4 text-sm text-ink-muted max-sm:flex-col max-sm:items-stretch'>
				<span>
					{pageStart + 1}-{Math.min(pageStart + RUNS_PAGE_SIZE, rows.length)} of {rows.length}
				</span>
				<div className='flex items-center gap-2.5 max-sm:justify-between'>
					<button
						className='button secondary min-h-8 px-2.5 text-xs'
						disabled={safePage <= 1}
						onClick={() => setPage((current) => Math.max(1, current - 1))}
						type='button'>
						Previous
					</button>
					<strong>
						Page {safePage} of {totalPages}
					</strong>
					<button
						className='button secondary min-h-8 px-2.5 text-xs'
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
				<article className='grid gap-4 rounded-lg border border-line bg-surface-muted/60 p-4' key={provider.id}>
					<div className='flex justify-between gap-3.5 items-start'>
						<div>
							<h3 className='m-0 text-lg leading-tight text-ink'>{provider.name}</h3>
							<span className='block text-xs text-ink-muted mt-1 wrap-break-word'>{provider.id}</span>
						</div>
						<strong className='text-2xl leading-none text-ink'>{provider.total}</strong>
					</div>
					<div className='grid gap-2.5'>
						<div className='flex h-2.5 overflow-hidden rounded-full bg-surface-muted'>
							<span className='block h-full bg-blue-soft' style={{ width: formatPercent(provider.blue, provider.total) }} />
							<span className='block h-full bg-red-soft' style={{ width: formatPercent(provider.red, provider.total) }} />
						</div>
						<div className='flex flex-wrap gap-3 text-xs text-ink-muted'>
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
					<div className='grid border-t border-line'>
						{provider.models.map((model) => (
							<div className='grid items-center gap-3 grid-cols-[minmax(0,1fr)_auto] border-b border-line py-3 last:border-b-0 last:pb-0' key={model.id}>
								<div>
									<strong className='text-sm text-ink'>{model.name}</strong>
									<span className='block text-xs text-ink-muted mt-1 wrap-break-word'>{model.id}</span>
								</div>
								<div className='text-right'>
									<span className='block text-lg font-extrabold text-ink'>{model.total}</span>
									<small className='block text-xs text-ink-muted mt-1'>
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
		<div className='flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-4 text-success shadow-soft'>
			<div className='flex items-center gap-2'>
				<Icon name='check' size={17} />
				<strong className='text-sm'>Local runs are private</strong>
			</div>
			<span className='text-xs leading-snug text-success'>User-generated responses stay in this browser unless exported and committed.</span>
		</div>
	)
}

function SidebarBenchmarkCard({ lastUpdated, summary }) {
	const progress = summary.total ? Math.round((summary.blue / summary.total) * 100) : 0

	return (
		<div className='rounded-lg border border-line bg-surface p-4 shadow-soft'>
			<div className='flex items-center justify-between gap-2'>
				<strong className='text-xs font-extrabold uppercase tracking-[0.02em] text-ink'>Ongoing Benchmark</strong>
			</div>
			<div className='mt-5 grid gap-4'>
				<div className='flex items-center justify-between gap-2 text-xs text-ink-muted'>
					<span>{formatRunMoment(lastUpdated)}</span>
					<span className='status-badge bg-success-soft text-success'>
						<i className='h-1.5 w-1.5 rounded-full bg-success-soft' />
						Live
					</span>
				</div>
				<span className='text-xs font-medium text-ink-muted'>
					{summary.models.length} models &bull; {formatNumber(summary.total)} runs
				</span>
				<div className='grid gap-2'>
					<div className='h-2 overflow-hidden rounded-full bg-surface-muted'>
						<span className='block h-full rounded-full bg-[linear-gradient(90deg,#17b981,#12a16f)]' style={{ width: `${progress}%` }} />
					</div>
					<div className='flex items-center justify-between text-xs font-bold text-ink'>
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
		<div className='rounded-lg border border-line bg-surface p-4 shadow-soft max-2xl:hidden'>
			<strong className='text-sm text-ink'>Contribute</strong>
			<p className='mt-2 mb-4 text-xs leading-relaxed text-ink-muted'>This project is open source. Add models, fix bugs, or suggest improvements on GitHub.</p>
			<a className='button' href='https://github.com/biopoietic/button-arena' target='_blank' rel='noreferrer'>
				View on GitHub
			</a>
		</div>
	)
}

function RunProgress({ progress }) {
	return (
		<div className='grid gap-2.5 rounded-lg border border-line bg-surface-muted p-3' role='status'>
			<div className='flex items-center justify-between text-sm text-ink'>
				<span>{progress.active}</span>
				<strong>
					{progress.completed}/{progress.total}
				</strong>
			</div>
			<div className='h-2 overflow-hidden rounded-full bg-surface'>
				<span
					className='block h-full bg-linear-to-r from-blue-500 to-blue transition-[width] duration-150'
					style={{ width: formatPercent(progress.completed, progress.total) }}
				/>
			</div>
		</div>
	)
}

function ExplainerPanel() {
	return (
		<article className='rounded-lg border border-line bg-surface shadow-soft p-5'>
			<h2 className='mb-3.5 text-sm font-extrabold uppercase tracking-[0.01em] text-ink'>The Dilemma</h2>

			<div className='grid gap-3 text-sm leading-relaxed text-ink-muted'>
				<p className='m-0'>
					Pressing red is the safe, individually rational choice: it guarantees your survival with zero risk. Pressing blue introduces a dangerous gamble — it may enable
					a superior collective outcome if enough people coordinate, but failure to reach that critical mass turns it into a potential death sentence.
				</p>
				<p className='m-0'>
					The blue button is frequently criticized as virtue signaling or naive collectivism, while red is defended as clear-eyed self-preservation grounded in game
					theory and basic survival logic.
				</p>
				<p className='m-0'>
					Button Arena tests the world's leading LLMs on this exact dilemma, exposing not just which button they press, but how consistently and honestly they reason
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
	const [showStructuredOnly, setShowStructuredOnly] = useState(true)
	const [themePreference, setThemePreference] = useState(getInitialThemePreference)
	const [isRunning, setIsRunning] = useState(false)

	useEffect(() => {
		if (typeof document === 'undefined') return undefined

		function applyTheme() {
			const resolvedTheme = resolveThemePreference(themePreference)
			document.documentElement.dataset.theme = resolvedTheme
			document.documentElement.dataset.themePreference = themePreference
			document.documentElement.style.colorScheme = resolvedTheme
		}

		applyTheme()
		writeStorage(STORAGE_KEYS.theme, themePreference)

		if (themePreference !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return undefined
		}

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
		mediaQuery.addEventListener('change', applyTheme)
		return () => {
			mediaQuery.removeEventListener('change', applyTheme)
		}
	}, [themePreference])

	useEffect(() => {
		let ignore = false

		async function loadStaticResults() {
			try {
				if (!ignore) {
					setGlobalData(await fetchStaticResults())
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
				const models = await fetchModelCatalog()

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
					row = await runBenchmarkRequest({
						apiKey,
						batchId,
						iteration,
						maxTokens,
						model,
						origin: window.location.origin,
						requireParameters,
						signal: abortRef.current?.signal,
					})
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

	const schemaText = JSON.stringify(VOTE_RESPONSE_FORMAT.json_schema.schema, null, 2)

	const statusBadgeStyles = statusLabel === 'Ongoing' || statusLabel === 'Ready' ? 'bg-success-soft text-success' : 'bg-blue-soft text-blue-deep'

	const questionCard = (
		<Panel title='The Question'>
			<p className='text-sm leading-relaxed text-ink-muted'>{QUESTION}</p>
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
			<pre className='m-0 rounded-lg border border-line bg-surface-muted p-3.5 text-left font-mono text-xs leading-snug text-blue-deep whitespace-pre-wrap'>{schemaText}</pre>
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
				<div className='flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 min-h-10'>
					<Icon name='key' size={16} />
					<input
						autoComplete='off'
						className='flex-1 min-w-0 border-0 outline-0 bg-transparent text-base text-ink'
						onChange={(event) => setApiKey(event.target.value)}
						placeholder='sk-or-...'
						type='password'
						value={apiKey}
					/>
				</div>
				<small className='text-xs text-ink-muted'>Stored in localStorage on this device only.</small>
			</label>

			<div className='grid gap-2'>
				<span className='field-label'>Models</span>
				{modelStatus === 'error' && (
					<div className='flex items-center gap-2.5 rounded-lg border border-line bg-red-soft px-3 py-2.5 text-sm text-red-deep'>
						<Icon name='alert' size={16} />
						Could not load the OpenRouter model catalog. Check the network connection and reload.
					</div>
				)}
				<div className='flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 min-h-10'>
					<Icon name='search' size={16} />
					<input
						className='flex-1 min-w-0 border-0 outline-0 bg-transparent text-base text-ink'
						onChange={(event) => setModelSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') addModel(modelSearch)
						}}
						placeholder='Search or paste any model id'
						type='text'
						value={modelSearch}
					/>
					<button className='button secondary min-h-7.5 px-3' onClick={() => addModel(modelSearch)} type='button'>
						Add
					</button>
				</div>
				<label className='flex items-center gap-2 text-sm font-bold text-ink'>
					<input checked={showStructuredOnly} className='accent-blue' onChange={(event) => setShowStructuredOnly(event.target.checked)} type='checkbox' />
					Only show structured-output capable models (recommended)
				</label>
				<div className='grid gap-1.5 max-h-57.5 overflow-auto'>
					{filteredModels.length ? (
						filteredModels.map((model) => {
							const isSelected = selectedModelIds.includes(model.id)
							return (
								<button
									className={`flex items-center justify-between gap-2.5 rounded-lg border bg-surface-muted p-2.5 text-left text-ink ${
										isSelected ? 'border-blue' : 'border-line'
									}`}
									key={model.id}
									onClick={() => addModel(model.id)}
									type='button'>
									<span>
										<strong className='block text-sm'>{modelLabel(model)}</strong>
										<small className='block text-xs text-ink-muted mt-1 wrap-break-word'>{model.id}</small>
									</span>
									{supportsStructuredOutput(model) && (
										<em className='inline-flex items-center rounded-md bg-success-soft text-success px-2 py-1.5 text-xs font-bold not-italic'>structured</em>
									)}
								</button>
							)
						})
					) : (
						<div className='rounded-lg border border-dashed border-line bg-surface-muted p-3 text-center text-xs text-ink-muted'>
							{modelStatus === 'loading' ? 'Loading OpenRouter models...' : 'No matching live models.'}
						</div>
					)}
				</div>
				<div className='flex flex-wrap gap-2'>
					{selectedModels.map((model) => (
						<span
							className='inline-flex items-center gap-2 max-w-full rounded-md border border-line bg-surface-muted pl-2.5 pr-2 py-1.5 text-xs font-bold text-ink'
							key={model.id}>
							{modelLabel(model)}
							<button
								aria-label={`Remove ${modelLabel(model)}`}
								className='bg-transparent border-0 p-0 text-ink-muted font-black'
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

			<label className='flex items-center gap-2 text-sm font-bold text-ink'>
				<input checked={requireParameters} className='accent-blue' onChange={(event) => setRequireParameters(event.target.checked)} type='checkbox' />
				Require providers that support structured output parameters
			</label>

			{runError && (
				<div className='flex items-center gap-2.5 rounded-lg border border-line bg-red-soft px-3 py-2.5 text-sm text-red-deep'>
					<Icon name='alert' size={16} />
					{runError}
				</div>
			)}

			{isRunning && <RunProgress progress={runProgress} />}

			<div className='flex items-center gap-2.5 max-sm:flex-col max-sm:items-stretch'>
				{isRunning ? (
					<button className='button danger flex-1' onClick={stopRun} type='button'>
						<Icon name='stop' size={16} />
						Stop Run
					</button>
				) : (
					<button className='button flex-1' onClick={runBenchmark} type='button'>
						<Icon name='play' size={16} />
						Run Benchmark
					</button>
				)}
				<button className='button secondary' disabled={isRunning || !localResponses.length} onClick={clearLocalResults} type='button'>
					<Icon name='trash' size={16} />
					Clear Local
				</button>
			</div>
			<p className='-mt-1 m-0 text-xs text-ink-muted'>Each request is one-shot with no conversation history.</p>
		</Panel>
	)

	const pageContent = {
		overview: (
			<div className='grid gap-4 grid-cols-[minmax(0,1fr)_340px] max-2xl:grid-cols-1'>
				<div className='grid gap-4 min-w-0 self-start'>
					<section className='grid gap-4 grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)] max-lg:grid-cols-1'>
						<OverviewSpotlight
							lastUpdated={lastUpdated}
							onRunPrivate={() => changeSection('configuration')}
							onShareBenchmark={() => setShareDialogOpen(true)}
							onViewResults={() => changeSection('results')}
						/>
						<OverviewMetrics lastUpdated={lastUpdated} stateLabel={statusLabel} summary={globalSummary} />
					</section>
					<section className='grid gap-4 grid-cols-[minmax(0,1.42fr)_minmax(360px,0.9fr)] max-lg:grid-cols-1'>
						<Panel className='min-w-0' title='Vote Distribution By Model'>
							<DistributionChart models={globalSummary.models} />
						</Panel>
						<Panel title='Overall Vote Distribution'>
							<DonutChart summary={globalSummary} />
						</Panel>
					</section>
					<section className='grid gap-4 grid-cols-[minmax(220px,1fr)_minmax(280px,2fr)] max-[900px]:grid-cols-1'>
						{questionCard}
						<ExplainerPanel />
					</section>
				</div>
				<ArenaChatMini onViewArena={() => changeSection('arena')} responses={globalResponses} />
			</div>
		),
		results: (
			<div className='grid gap-4 min-w-0'>
				<SummaryGrid lastUpdated={lastUpdated} selectedCount={selectedModels.length} stateLabel={statusLabel} summary={globalSummary} />
				<ResultsPanels logLimit={logLimit} setLogLimit={setLogLimit} summary={globalSummary} />
			</div>
		),
		arena: (
			<div className='grid gap-4'>
				<ArenaVoteBar summary={globalSummary} />
				<div className='overflow-hidden rounded-b-lg'>
					<ArenaChat responses={globalResponses} />
				</div>
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
						<RunProgress progress={runProgress} />
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
		<div className='min-h-svh grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[72px_minmax(0,1fr)] bg-canvas text-ink max-2xl:grid-cols-1 max-2xl:grid-rows-[auto_auto_minmax(0,1fr)]'>
			<ShareDialog isOpen={shareDialogOpen} onClose={() => setShareDialogOpen(false)} />
			<header className='col-span-full flex items-center justify-between gap-5 border-b border-line bg-surface/90 backdrop-blur-md px-6 max-2xl:flex-col max-2xl:items-start max-2xl:p-4 2xl:sticky 2xl:top-0 2xl:z-50'>
				<div className='flex items-center gap-4 min-w-0 max-sm:items-start'>
					<Logo aria-hidden='true' className='h-12 w-19 flex-none overflow-visible' />
					<div>
						<h1 className='m-0 text-xl max-sm:text-lg font-extrabold leading-tight text-ink'>Button Arena</h1>
						<p className='mt-1 m-0 text-sm text-ink-muted'>The ultimate moral gamble: sacrifice for the many, or survive alone?</p>
					</div>
				</div>
				<div className='flex items-center justify-end gap-3 max-2xl:flex-wrap max-2xl:justify-start'>
					<span className='text-sm text-ink-muted whitespace-nowrap'>Last run {formatDateTime(lastUpdated)}</span>
					<span className={`status-badge ${statusBadgeStyles}`}>
						<i className={`h-1.5 w-1.5 rounded-full ${statusLabel === 'Ongoing' || statusLabel === 'Ready' ? 'bg-success-soft' : 'bg-blue-soft'}`} />
						{statusLabel === 'Ongoing' ? 'Live' : statusLabel}
					</span>
					<button className='button secondary' onClick={exportLocalResults} type='button'>
						<Icon name='download' size={16} />
						Export
					</button>
				</div>
			</header>

			<aside className='flex flex-col justify-between gap-5 border-r border-line bg-surface/90 px-4 py-5 max-2xl:border-r-0 max-2xl:border-b max-2xl:py-3 2xl:sticky 2xl:top-18 2xl:h-[calc(100svh-72px)] 2xl:overflow-y-auto'>
				<div>
					<nav aria-label='Benchmark sections' className='grid gap-2 max-2xl:flex max-2xl:overflow-x-auto'>
						{NAV_ITEMS.map((item) => {
							const isActive = activeSection === item.id
							return (
								<button
									aria-current={isActive ? 'page' : undefined}
									className={`flex min-h-11 items-center gap-3 rounded-lg px-3.5 text-sm font-bold uppercase ${
										isActive ? 'bg-blue-soft text-blue' : 'text-ink-muted hover:bg-surface-muted hover:text-blue'
									} w-full max-2xl:w-auto max-2xl:flex-none`}
									key={item.id}
									onClick={() => changeSection(item.id)}
									type='button'>
									<Icon name={item.icon} size={17} />
									{item.label}
								</button>
							)
						})}
					</nav>
					<div className='my-5 h-px bg-line max-2xl:hidden' />
					<div className='max-2xl:hidden'>
						<SidebarBenchmarkCard lastUpdated={lastUpdated} summary={globalSummary} />
					</div>
				</div>
				<div className='grid gap-3'>
					<FeedbackCard />
					<ThemeSwitcher onChange={setThemePreference} value={themePreference} />
				</div>
			</aside>

			<main className='flex min-w-0 flex-col gap-4 p-4 max-sm:p-3'>{pageContent[activeSection]}</main>
		</div>
	)
}

export default App
