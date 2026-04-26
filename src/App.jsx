import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const OPENROUTER_API = 'https://openrouter.ai/api/v1'
const STATIC_RESULTS_URL = '/results/global-results.json'
const APP_TITLE = 'LLM Vote Benchmark'

const STORAGE_KEYS = {
  apiKey: 'red-blue-benchmark:openrouter-key',
  localResponses: 'red-blue-benchmark:local-responses',
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

function Icon({ name, size = 18 }) {
  const paths = {
    activity: (
      <>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M3 19h18" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 4.6 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" />
      </>
    ),
    box: (
      <>
        <path d="m21 8-9-5-9 5 9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
      </>
    ),
    check: (
      <>
        <path d="M20 6 9 17l-5-5" />
      </>
    ),
    chevron: (
      <>
        <path d="m9 18 6-6-6-6" />
      </>
    ),
    clipboard: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </>
    ),
    key: (
      <>
        <circle cx="7.5" cy="14.5" r="3.5" />
        <path d="m10 12 9-9" />
        <path d="m15 4 3 3" />
        <path d="m13 6 3 3" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </>
    ),
    play: (
      <>
        <path d="m8 5 11 7-11 7V5Z" />
      </>
    ),
    refresh: (
      <>
        <path d="M21 12a9 9 0 0 0-15.4-6.4L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 15.4 6.4L21 16" />
        <path d="M16 16h5v5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    settings: (
      <>
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V22a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L3.2 8a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 .9-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 18.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      </>
    ),
    stop: (
      <>
        <rect x="7" y="7" width="10" height="10" rx="1" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v5" />
        <path d="M14 11v5" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
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

  if (supportsParameter(model, 'max_tokens')) {
    body.max_tokens = Number(settings.maxTokens)
  } else if (supportsParameter(model, 'max_completion_tokens')) {
    body.max_completion_tokens = Number(settings.maxTokens)
  } else {
    omittedParameters.push('max_tokens')
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

function normalizeChoice(value) {
  const choice = String(value ?? '').trim().toLowerCase()
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
      } catch {}
    }
    // Fallback: extract choice from a truncated response (e.g. finish_reason: "length")
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
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (content == null) return ''
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
      status: choice ? response.status ?? 'accepted' : response.status ?? 'error',
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

function SummaryCard({ tone = 'neutral', icon, label, value, detail }) {
  return (
    <article className={`summary-card ${tone}`}>
      <div className="summary-icon">
        <Icon name={icon} size={22} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <Icon name="shield" size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function DistributionChart({ models }) {
  if (!models.length) {
    return (
      <EmptyState
        detail="Run a private benchmark or add committed responses to populate this chart."
        title="No model votes yet"
      />
    )
  }

  return (
    <div className="model-bars">
      <div className="chart-legend compact">
        <span>
          <i className="dot blue"></i>Blue (survive if &gt;50%)
        </span>
        <span>
          <i className="dot red"></i>Red (survive if &le;50%)
        </span>
      </div>
      {models.map((model) => {
        const bluePercent = model.total ? (model.blue / model.total) * 100 : 0
        const redPercent = 100 - bluePercent

        return (
          <div className="bar-row" key={model.id}>
            <div className="bar-label" title={model.id}>
              {model.name}
            </div>
            <div className="stacked-bar" aria-label={`${model.name}: ${model.blue} blue, ${model.red} red`}>
              <div className="bar-segment blue" style={{ width: `${bluePercent}%` }}>
                {model.blue ? formatPercent(model.blue, model.total) : ''}
              </div>
              <div className="bar-segment red" style={{ width: `${redPercent}%` }}>
                {model.red ? formatPercent(model.red, model.total) : ''}
              </div>
            </div>
            <div className="bar-count">
              {model.blue} / {model.red}
              <span>({model.total})</span>
            </div>
          </div>
        )
      })}
      <div className="axis">
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
    </div>
  )
}

function DonutChart({ summary }) {
  const bluePercent = summary.total ? (summary.blue / summary.total) * 100 : 0

  if (!summary.total) {
    return (
      <EmptyState
        detail="Accepted structured responses will be counted as red or blue."
        title="No vote distribution yet"
      />
    )
  }

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ '--blue-share': `${bluePercent}%` }}>
        <div>
          <strong>{summary.total}</strong>
          <span>Total</span>
        </div>
      </div>
      <div className="donut-legend">
        <div>
          <i className="dot blue"></i>
          <span>Blue</span>
          <strong>
            {summary.blue} ({formatPercent(summary.blue, summary.total)})
          </strong>
        </div>
        <div>
          <i className="dot red"></i>
          <span>Red</span>
          <strong>
            {summary.red} ({formatPercent(summary.red, summary.total)})
          </strong>
        </div>
      </div>
    </div>
  )
}

function ResponseTable({ rows, limit }) {
  const visibleRows = rows.slice(0, limit)

  if (!visibleRows.length) {
    return (
      <EmptyState
        detail="The latest accepted responses and validation errors will appear here."
        title="No response log yet"
      />
    )
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Model</th>
            <th>Choice</th>
            <th>Comment</th>
            <th>Raw Response</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr className={row.status === 'error' ? 'error-row' : ''} key={row.id}>
              <td>{formatTime(row.timestamp)}</td>
              <td title={row.modelId}>{row.modelName}</td>
              <td>
                {row.choice ? (
                  <span className={`choice-pill ${row.choice}`}>
                    <i className={`dot ${row.choice}`}></i>
                    {row.choice}
                  </span>
                ) : (
                  <span className="choice-pill invalid">invalid</span>
                )}
              </td>
              <td>{row.status === 'error' ? row.error : row.comment || 'No comment'}</td>
              <td title={row.rawResponse}>{trimText(row.rawResponse)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SummaryGrid({ lastUpdated, selectedCount, statusLabel, summary }) {
  return (
    <section className="summary-grid">
      <SummaryCard detail={`${selectedCount} selected for next local run`} icon="activity" label="Total Runs" value={summary.total} />
      <SummaryCard
        detail={formatPercent(summary.blue, summary.total)}
        icon="check"
        label="Blue Votes"
        tone="blue"
        value={summary.blue}
      />
      <SummaryCard
        detail={formatPercent(summary.red, summary.total)}
        icon="alert"
        label="Red Votes"
        tone="red"
        value={summary.red}
      />
      <SummaryCard
        detail={`${summary.errors} rejected or failed`}
        icon="box"
        label="Models"
        tone="purple"
        value={summary.models.length}
      />
      <SummaryCard detail={formatDateTime(lastUpdated)} icon="check" label="Status" tone="green" value={statusLabel} />
    </section>
  )
}

function ResultsPanels({ logLimit, setLogLimit, summary }) {
  return (
    <>
      <section className="chart-grid">
        <article className="panel wide-panel">
          <div className="panel-heading">
            <h2>Vote Distribution By Model</h2>
          </div>
          <DistributionChart models={summary.models} />
        </article>
        <article className="panel">
          <div className="panel-heading">
            <h2>Overall Vote Distribution</h2>
          </div>
          <DonutChart summary={summary} />
        </article>
      </section>

      <article className="panel log-panel">
        <div className="panel-heading">
          <h2>Response Log {logLimit === 10 ? '(Latest 10)' : '(All)'}</h2>
          <button
            className="secondary-button small"
            disabled={!summary.latest.length}
            onClick={() => setLogLimit((current) => (current === 10 ? summary.latest.length : 10))}
            type="button"
          >
            {logLimit === 10 ? 'View all logs' : 'Latest 10'}
          </button>
        </div>
        <ResponseTable limit={logLimit} rows={summary.latest} />
        <div className="log-footer">
          <span>Only responses validated as red or blue are included in aggregates.</span>
          <span>
            {Math.min(logLimit, summary.latest.length) || 0} of {summary.latest.length}
          </span>
        </div>
      </article>
    </>
  )
}

function RunsTable({ page, rows, setPage }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / RUNS_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * RUNS_PAGE_SIZE
  const visibleRows = rows.slice(pageStart, pageStart + RUNS_PAGE_SIZE)

  if (!rows.length) {
    return (
      <EmptyState
        detail="Raw benchmark requests will appear here after a local run or after committed results are added."
        title="No raw runs yet"
      />
    )
  }

  return (
    <>
      <div className="table-scroll">
        <table className="runs-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Batch</th>
              <th>Iteration</th>
              <th>Model</th>
              <th>Status</th>
              <th>Choice</th>
              <th>Latency</th>
              <th>Raw Response</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr className={row.status === 'error' ? 'error-row' : ''} key={row.id}>
                <td>{formatDateTime(row.timestamp)}</td>
                <td>
                  <span className={`source-pill ${row.source}`}>{row.source}</span>
                </td>
                <td title={row.batchId ?? ''}>{row.batchId ? row.batchId.slice(0, 8) : '-'}</td>
                <td>{row.request?.iteration ?? '-'}</td>
                <td title={row.modelId}>{row.modelName}</td>
                <td>{row.status}</td>
                <td>
                  {row.choice ? (
                    <span className={`choice-pill ${row.choice}`}>
                      <i className={`dot ${row.choice}`}></i>
                      {row.choice}
                    </span>
                  ) : (
                    <span className="choice-pill invalid">invalid</span>
                  )}
                </td>
                <td>{row.latencyMs == null ? '-' : `${row.latencyMs} ms`}</td>
                <td title={row.rawResponse || row.error}>{trimText(row.rawResponse || row.error, 180)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>
          {pageStart + 1}-{Math.min(pageStart + RUNS_PAGE_SIZE, rows.length)} of {rows.length}
        </span>
        <div>
          <button disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
            Previous
          </button>
          <strong>
            Page {safePage} of {totalPages}
          </strong>
          <button
            disabled={safePage >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </>
  )
}

function ProviderBreakdown({ providers }) {
  if (!providers.length) {
    return (
      <EmptyState
        detail="Accepted structured responses will be grouped by provider and model here."
        title="No model breakdown yet"
      />
    )
  }

  return (
    <div className="provider-grid">
      {providers.map((provider) => (
        <article className="provider-card" key={provider.id}>
          <div className="provider-header">
            <div>
              <h3>{provider.name}</h3>
              <span>{provider.id}</span>
            </div>
            <strong>{provider.total}</strong>
          </div>
          <div className="provider-meter">
            <div className="mini-stacked-bar">
              <span className="blue" style={{ width: formatPercent(provider.blue, provider.total) }}></span>
              <span className="red" style={{ width: formatPercent(provider.red, provider.total) }}></span>
            </div>
            <div className="provider-stats">
              <span>
                <i className="dot blue"></i>
                {provider.blue} blue ({formatPercent(provider.blue, provider.total)})
              </span>
              <span>
                <i className="dot red"></i>
                {provider.red} red ({formatPercent(provider.red, provider.total)})
              </span>
            </div>
          </div>
          <div className="model-breakdown-list">
            {provider.models.map((model) => (
              <div className="model-breakdown-row" key={model.id}>
                <div>
                  <strong>{model.name}</strong>
                  <span>{model.id}</span>
                </div>
                <div className="model-counts">
                  <span>{model.total}</span>
                  <small>
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

function App() {
  const abortRef = useRef(null)
  const [activeSection, setActiveSection] = useState('overview')
  const [apiKey, setApiKey] = useState(() => window.localStorage.getItem(STORAGE_KEYS.apiKey) ?? '')
  const [availableModels, setAvailableModels] = useState([])
  const [globalData, setGlobalData] = useState(EMPTY_STATIC_RESULTS)
  const [globalStatus, setGlobalStatus] = useState('loading')
  const [iterations, setIterations] = useState(100)
  const [localResponses, setLocalResponses] = useState(() =>
    normalizeResponses(readStoredJson(STORAGE_KEYS.localResponses, []), 'local'),
  )
  const [logLimit, setLogLimit] = useState(10)
  const [concurrency, setConcurrency] = useState(5)
  const [maxTokens, setMaxTokens] = useState(256)
  const [modelSearch, setModelSearch] = useState('')
  const [modelStatus, setModelStatus] = useState('loading')
  const [requireParameters, setRequireParameters] = useState(true)
  const [runsPage, setRunsPage] = useState(1)
  const [runError, setRunError] = useState('')
  const [runProgress, setRunProgress] = useState({ active: '', completed: 0, total: 0 })
  const [selectedModelIds, setSelectedModelIds] = useState([])
  const [showStructuredOnly, setShowStructuredOnly] = useState(true)
  const [isRunning, setIsRunning] = useState(false)

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

  const globalResponses = useMemo(
    () => normalizeResponses(globalData.responses, 'global'),
    [globalData.responses],
  )
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

  const statusLabel = isRunning
    ? 'Running'
    : globalSummary.total
      ? 'Completed'
      : globalStatus === 'loading'
        ? 'Loading'
        : 'Ready'

  const localStatusLabel = isRunning ? 'Running' : localSummary.total ? 'Completed' : 'Ready'

  const lastUpdated =
    globalSummary.lastTimestamp ?? globalData.metadata?.lastUpdated ?? globalData.metadata?.exportedAt ?? null

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
    const payload = {
      metadata: {
        title: 'Red/Blue LLM Vote Benchmark',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        question: QUESTION,
        note: 'Local runs are private browser data unless this exported file is committed or published.',
      },
      responses: localResponses.filter((r) => normalizeChoice(r.choice)),
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
        maxTokens: Number(maxTokens),
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

      const unsupportedStructuredModelIds = selectedModels
        .filter((model) => !supportsStructuredOutput(model))
        .map((model) => model.id)
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
  const activeNavItem = NAV_ITEMS.find((item) => item.id === activeSection) ?? NAV_ITEMS[0]

  const questionCard = (
    <article className="panel question-panel">
      <div className="panel-heading">
        <h2>Question</h2>
        <span className="fixed-label">Fixed</span>
      </div>
      <p>{QUESTION}</p>
    </article>
  )

  const schemaCard = (
    <article className="panel">
      <div className="panel-heading">
        <h2>Response Format</h2>
        <button className="icon-button" onClick={copySchema} title="Copy schema" type="button">
          <Icon name="clipboard" size={17} />
        </button>
      </div>
      <pre className="schema-block">{schemaText}</pre>
    </article>
  )

  const runSettingsCard = (
    <article className="panel settings-panel">
      <div className="panel-heading">
        <h2>Run Settings</h2>
        <span className="small-status">
          {modelStatus === 'ready' ? `${modelOptions.length} live models` : modelStatus === 'loading' ? 'Loading models' : 'Catalog unavailable'}
        </span>
      </div>

      <label className="field">
        <span>OpenRouter API key</span>
        <div className="input-with-icon">
          <Icon name="key" size={16} />
          <input
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-or-..."
            type="password"
            value={apiKey}
          />
        </div>
        <small>Stored in localStorage on this device only.</small>
      </label>

      <div className="field">
        <span>Models</span>
        {modelStatus === 'error' && (
          <div className="inline-alert">
            <Icon name="alert" size={16} />
            Could not load the OpenRouter model catalog. Check the network connection and reload.
          </div>
        )}
        <div className="model-search">
          <Icon name="search" size={16} />
          <input
            onChange={(event) => setModelSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addModel(modelSearch)
            }}
            placeholder="Search or paste any model id"
            type="text"
            value={modelSearch}
          />
          <button onClick={() => addModel(modelSearch)} type="button">
            Add
          </button>
        </div>
        <label className="toggle-line">
          <input
            checked={showStructuredOnly}
            onChange={(event) => setShowStructuredOnly(event.target.checked)}
            type="checkbox"
          />
          Only show structured-output capable models (recommended)
        </label>
        <div className="model-results">
          {filteredModels.length ? (
            filteredModels.map((model) => (
              <button
                className={selectedModelIds.includes(model.id) ? 'selected' : ''}
                key={model.id}
                onClick={() => addModel(model.id)}
                type="button"
              >
                <span>
                  <strong>{modelLabel(model)}</strong>
                  <small>{model.id}</small>
                </span>
                {supportsStructuredOutput(model) && <em>structured</em>}
              </button>
            ))
          ) : (
            <div className="model-results-empty">
              {modelStatus === 'loading' ? 'Loading OpenRouter models...' : 'No matching live models.'}
            </div>
          )}
        </div>
        <div className="selected-models">
          {selectedModels.map((model) => (
            <span className="model-chip" key={model.id}>
              {modelLabel(model)}
              <button aria-label={`Remove ${modelLabel(model)}`} onClick={() => removeModel(model.id)} type="button">
                x
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="settings-grid">
        <label className="field compact-field">
          <span>Iterations per model</span>
          <input
            max="1000"
            min="1"
            onChange={(event) => setIterations(event.target.value)}
            type="number"
            value={iterations}
          />
        </label>
        <label className="field compact-field">
          <span>Max tokens</span>
          <input max="512" min="16" onChange={(event) => setMaxTokens(event.target.value)} type="number" value={maxTokens} />
        </label>
        <label className="field compact-field">
          <span>Concurrency</span>
          <input max="20" min="1" onChange={(event) => setConcurrency(event.target.value)} type="number" value={concurrency} />
        </label>
      </div>

      <label className="toggle-line">
        <input
          checked={requireParameters}
          onChange={(event) => setRequireParameters(event.target.checked)}
          type="checkbox"
        />
        Require providers that support structured output parameters
      </label>

      {runError && (
        <div className="inline-alert">
          <Icon name="alert" size={16} />
          {runError}
        </div>
      )}

      {isRunning && (
        <div className="run-progress" role="status">
          <div>
            <span>{runProgress.active}</span>
            <strong>
              {runProgress.completed}/{runProgress.total}
            </strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progressPercent}%` }}></span>
          </div>
        </div>
      )}

      <div className="run-actions">
        {isRunning ? (
          <button className="danger-button" onClick={stopRun} type="button">
            <Icon name="stop" size={16} />
            Stop Run
          </button>
        ) : (
          <button className="primary-button" onClick={runBenchmark} type="button">
            <Icon name="play" size={16} />
            Run Benchmark
          </button>
        )}
        <button className="secondary-button" disabled={isRunning || !localResponses.length} onClick={clearLocalResults} type="button">
          <Icon name="trash" size={16} />
          Clear Local
        </button>
      </div>
      <p className="fine-print">Each request is one-shot with no conversation history.</p>
    </article>
  )

  const pageContent = {
    overview: (
      <div className="page-stack">
        <section className="overview-layout">
          {questionCard}
          {schemaCard}
        </section>
        <SummaryGrid
          lastUpdated={lastUpdated}
          selectedCount={selectedModels.length}
          statusLabel={statusLabel}
          summary={globalSummary}
        />
        <section className="chart-grid">
          <article className="panel wide-panel">
            <div className="panel-heading">
              <h2>Vote Distribution By Model</h2>
            </div>
            <DistributionChart models={globalSummary.models} />
          </article>
          <article className="panel">
            <div className="panel-heading">
              <h2>Overall Vote Distribution</h2>
            </div>
            <DonutChart summary={globalSummary} />
          </article>
        </section>
      </div>
    ),
    results: (
      <div className="page-stack">
        <SummaryGrid
          lastUpdated={lastUpdated}
          selectedCount={selectedModels.length}
          statusLabel={statusLabel}
          summary={globalSummary}
        />
        <ResultsPanels logLimit={logLimit} setLogLimit={setLogLimit} summary={globalSummary} />
      </div>
    ),
    runs: (
      <div className="page-stack">
        <article className="panel log-panel">
          <div className="panel-heading">
            <h2>Raw Runs</h2>
            <span className="small-status">{globalResponses.length} rows</span>
          </div>
          <RunsTable page={runsPage} rows={globalSummary.latest} setPage={setRunsPage} />
        </article>
      </div>
    ),
    models: (
      <div className="page-stack">
        <SummaryGrid
          lastUpdated={lastUpdated}
          selectedCount={selectedModels.length}
          statusLabel={statusLabel}
          summary={globalSummary}
        />
        <article className="panel">
          <div className="panel-heading">
            <h2>Provider And Model Breakdown</h2>
            <span className="small-status">{providerBreakdown.length} providers</span>
          </div>
          <ProviderBreakdown providers={providerBreakdown} />
        </article>
      </div>
    ),
    'my-runs': (
      <div className="page-stack">
        <SummaryGrid
          lastUpdated={localLastUpdated}
          selectedCount={selectedModels.length}
          statusLabel={localStatusLabel}
          summary={localSummary}
        />
        {isRunning && (
          <article className="panel">
            <div className="panel-heading">
              <h2>Current Run</h2>
              <span className="small-status">Live</span>
            </div>
            <div className="run-progress" role="status">
              <div>
                <span>{runProgress.active}</span>
                <strong>
                  {runProgress.completed}/{runProgress.total}
                </strong>
              </div>
              <div className="progress-track">
                <span style={{ width: `${progressPercent}%` }}></span>
              </div>
            </div>
          </article>
        )}
        <section className="chart-grid">
          <article className="panel wide-panel">
            <div className="panel-heading">
              <h2>Vote Distribution By Model</h2>
            </div>
            <DistributionChart models={localSummary.models} />
          </article>
          <article className="panel">
            <div className="panel-heading">
              <h2>Overall Vote Distribution</h2>
            </div>
            <DonutChart summary={localSummary} />
          </article>
        </section>
        <ResultsPanels logLimit={logLimit} setLogLimit={setLogLimit} summary={localSummary} />
        <article className="panel log-panel">
          <div className="panel-heading">
            <h2>Raw Runs</h2>
            <span className="small-status">{localResponses.length} rows</span>
          </div>
          <RunsTable page={runsPage} rows={localSummary.latest} setPage={setRunsPage} />
        </article>
      </div>
    ),
    configuration: (
      <div className="config-layout">
        <section className="config-reference">
          {questionCard}
          {schemaCard}
        </section>
        {runSettingsCard}
      </div>
    ),
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="activity" size={32} />
          </div>
          <div>
            <h1>LLM Vote Benchmark</h1>
            <p>Revealed preference via single-shot structured responses</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="timestamp">{formatDateTime(lastUpdated)}</span>
          <span className={`status-badge ${statusLabel.toLowerCase()}`}>{statusLabel}</span>
          <button className="secondary-button" disabled={!localResponses.length} onClick={exportLocalResults} type="button">
            <Icon name="download" size={16} />
            Export
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <nav aria-label="Benchmark sections">
          {NAV_ITEMS.map((item) => (
            <button
              aria-current={activeSection === item.id ? 'page' : undefined}
              className={activeSection === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => changeSection(item.id)}
              type="button"
            >
              <Icon name={item.icon} size={17} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="privacy-card">
          <Icon name="check" size={17} />
          <strong>Local runs are private</strong>
          <span>User-generated responses stay in this browser unless exported and committed.</span>
        </div>
      </aside>

      <main className="dashboard">
        <div className="page-header">
          <div>
            <span className="eyebrow">{APP_TITLE}</span>
            <h2>{activeNavItem.label}</h2>
          </div>
        </div>
        {pageContent[activeSection]}
      </main>
    </div>
  )
}

export default App
