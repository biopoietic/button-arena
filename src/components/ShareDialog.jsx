import { useEffect, useState } from 'react'
import { Copy, ExternalLink, X } from 'lucide-react'
import { APP_TITLE, getShareUrl } from '../lib/benchmark-core'

const SHARE_DESCRIPTION = 'See how AI models reason about altruism vs. self-interest.'

function supportsNativeShare(shareData) {
	return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(shareData))
}

export function ShareDialog({ isOpen, onClose }) {
	const [nativeShareFailed, setNativeShareFailed] = useState(false)
	const [copyStatus, setCopyStatus] = useState('idle') // 'idle' | 'link-copied' | 'rich-copied' | 'error'

	const url = getShareUrl()
	const shareData = { title: APP_TITLE, text: SHARE_DESCRIPTION, url }
	const canUseNativeShare = isOpen && !nativeShareFailed && supportsNativeShare(shareData)

	// Attempt native share; setNativeShareFailed(true) is only called in async callbacks
	useEffect(() => {
		if (!canUseNativeShare) return

		let cancelled = false
		navigator
			.share(shareData)
			.then(() => {
				if (!cancelled) onClose()
			})
			.catch((error) => {
				if (cancelled) return
				if (error instanceof DOMException && error.name === 'AbortError') {
					onClose()
				} else {
					setNativeShareFailed(true)
				}
			})

		return () => {
			cancelled = true
		}
	}, [canUseNativeShare]) // eslint-disable-line react-hooks/exhaustive-deps

	// Reset nativeShareFailed in cleanup (runs when isOpen goes false→true next time)
	useEffect(() => {
		if (!isOpen) return
		return () => setNativeShareFailed(false)
	}, [isOpen])

	useEffect(() => {
		if (!isOpen || canUseNativeShare) return undefined

		function handleKeyDown(event) {
			if (event.key === 'Escape') onClose()
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [isOpen, canUseNativeShare, onClose])

	if (!isOpen || canUseNativeShare) return null

	async function copyToClipboard(text, target) {
		try {
			await navigator.clipboard.writeText(text)
			setCopyStatus(target === 'rich' ? 'rich-copied' : 'link-copied')
			setTimeout(() => setCopyStatus('idle'), 2000)
		} catch {
			setCopyStatus('error')
			setTimeout(() => setCopyStatus('idle'), 2000)
		}
	}

	const shareUrls = {
		x: `https://x.com/intent/tweet?text=${encodeURIComponent(SHARE_DESCRIPTION)}&url=${encodeURIComponent(url)}`,
		linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
		facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
	}

	const linkLabel = copyStatus === 'link-copied' ? 'Copied!' : copyStatus === 'error' ? 'Failed to copy' : 'Copy Link'
	const richLabel = copyStatus === 'rich-copied' ? 'Copied!' : copyStatus === 'error' ? 'Failed to copy' : 'Copy Rich Text'

	return (
		<div className='fixed inset-0 z-50 grid place-items-center bg-[rgba(15,23,42,0.52)] px-4 backdrop-blur-[6px]' onClick={onClose}>
			<div
				aria-labelledby='share-benchmark-title'
				aria-modal='true'
				className='w-full max-w-md overflow-hidden rounded-lg border border-line bg-linear-to-b from-surface/95 to-surface-muted/95 text-ink shadow-soft'
				onClick={(event) => event.stopPropagation()}
				role='dialog'>
				{/* Header */}
				<div className='flex items-center justify-between gap-4 border-b border-line px-6 py-4'>
					<h3 className='text-lg font-extrabold tracking-[-0.02em]' id='share-benchmark-title'>
						Share Button Arena
					</h3>
					<button aria-label='Close dialog' className='button secondary px-3.5' onClick={onClose} type='button'>
						<X aria-hidden='true' size={16} />
					</button>
				</div>

				{/* Content Preview */}
				<div className='border-b border-line px-6 py-4'>
					<h4 className='m-0 font-semibold text-ink line-clamp-2'>Button Arena</h4>
					<p className='mt-1.5 mb-0 text-sm text-ink-muted line-clamp-3'>
						Button Arena tests the world's leading LLMs on the ultimate moral gamble: sacrifice for the many, or survive alone?
					</p>
					<div className='mt-3 rounded-xl border border-line bg-surface p-3'>
						<p className='mt-1.5 mb-0 break-all text-sm leading-relaxed text-ink'>{url}</p>
					</div>
				</div>

				{/* Share Options */}
				<div className='space-y-2 px-6 py-4'>
					{/* Social Shares */}
					<a className='button w-full justify-between' href={shareUrls.x} rel='noopener noreferrer' target='_blank'>
						<span className='flex items-center gap-3'>
							<svg aria-hidden='true' fill='currentColor' height='16' viewBox='0 0 24 24' width='16'>
								<path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.746-8.855L1.5 2.25h6.312l4.256 5.634 5.25-5.634zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z' />
							</svg>
							Share on X
						</span>
						<ExternalLink aria-hidden='true' size={14} />
					</a>
					<a className='button w-full justify-between' href={shareUrls.linkedin} rel='noopener noreferrer' target='_blank'>
						<span className='flex items-center gap-3'>
							<svg aria-hidden='true' fill='currentColor' height='16' viewBox='0 0 24 24' width='16'>
								<path d='M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' />
							</svg>
							Share on LinkedIn
						</span>
						<ExternalLink aria-hidden='true' size={14} />
					</a>
					<a className='button w-full justify-between' href={shareUrls.facebook} rel='noopener noreferrer' target='_blank'>
						<span className='flex items-center gap-3'>
							<svg aria-hidden='true' fill='currentColor' height='16' viewBox='0 0 24 24' width='16'>
								<path d='M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' />
							</svg>
							Share on Facebook
						</span>
						<ExternalLink aria-hidden='true' size={14} />
					</a>

					{/* Copy Options */}
					<div className='space-y-2 border-t border-line pt-2'>
						<button className='button secondary w-full' disabled={copyStatus === 'link-copied'} onClick={() => copyToClipboard(url, 'link')} type='button'>
							<Copy aria-hidden='true' size={16} />
							{linkLabel}
						</button>
						<button
							className='button secondary w-full'
							disabled={copyStatus === 'rich-copied'}
							onClick={() => copyToClipboard(SHARE_DESCRIPTION + '\n\n' + url, 'rich')}
							type='button'>
							<Copy aria-hidden='true' size={16} />
							{richLabel}
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
