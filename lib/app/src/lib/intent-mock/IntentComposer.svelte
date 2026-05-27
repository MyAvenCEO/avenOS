<script lang="ts">
import { focusShellWebview } from '$lib/intent-mock/focus-shell-webview'
import { onDestroy, tick } from 'svelte'

/** Typing-mode textarea: grow with content up to this many text rows, then scroll. */
const TYPING_TEXTAREA_MAX_ROWS = 12
const BAR_COUNT = 24
/** Matches {@link classifyIntentUploadFile} allowed types (layout drag-drop hint). */
const FILE_INPUT_ACCEPT =
	'application/pdf,image/jpeg,image/png,image/svg+xml,.pdf,.jpg,.jpeg,.png,.svg'

type ComposerAttachment = {
	file: File
	/** Object URL for image preview; `null` for non-images (generic tile). */
	previewUrl: string | null
}

function isImageFile(file: File): boolean {
	return file.type.startsWith('image/')
}

function revokeAttachmentPreview(a: ComposerAttachment) {
	if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
}

/** Plausible mock transcripts when user “sends” a voice note (no real STT). */
const VOICE_MOCK_TRANSCRIPTS = [
	'Voice note — follow up on the vendor invoice; needs approval before Friday.',
	'Diction: schedule a sync with finance on the Q2 close checklist.',
	'Note to self: reconcile the MT940 import with last week’s bank feed.',
	'Quick capture: flag the EU VAT line items for a second reviewer.',
	'Voice: remind me to archive the signed PO once legal countersigns.',
	'Memo — escalate the unmatched IBAN on the Acme transfer.',
	'Capture: bundle the three expense PDFs into one intent for bookkeeping.'
]

type Mode = 'collapsed' | 'listening' | 'typing'

let {
	onSubmitMessage,
	onModeChange,
	/**
	 * Invoked on submit while a command badge is active. Receives the active
	 * command label (e.g. `'retrain'`) and the trailing free-form feedback the
	 * user typed after the badge. The composer clears its own state after firing.
	 */
	onCommandSubmit,
	/** Outer shell omits full-width stretch — use inline in centered HITL / archive clusters. */
	rowCluster = false,
	/**
	 * Active command badge ("slash command" style chip rendered at the start of
	 * the typing-mode input). `$bindable` so the parent owns the value and it
	 * survives composer remounts (the page swaps which `IntentComposer` instance
	 * is rendered as `mode` flips between `collapsed` and `typing`).
	 */
	command = $bindable<string | null>(null),
	placeholder = 'Describe an intent… (mock — not sent)',
	submitBusy = false,
	disabled = false,
	enableAttachments = true
}: {
	onSubmitMessage?: (text: string, files: File[]) => void
	onModeChange?: (mode: Mode) => void
	onCommandSubmit?: (command: string, text: string, files: File[]) => void
	rowCluster?: boolean
	command?: string | null
	placeholder?: string
	submitBusy?: boolean
	disabled?: boolean
	enableAttachments?: boolean
} = $props()

/**
 * Composer mode is intentionally not `$bindable`: a parent-held bind can reconcile after clears and resurrect `typing`.
 *
 * Initial value is derived from the `command` prop at mount time: when the
 * parent swaps which `IntentComposer` instance is rendered (rowCluster vs
 * stacked) in response to a mode change, the freshly-mounted instance must
 * start in a mode that *agrees* with the parent's already-set view of
 * `composerMode`. If we always defaulted to `'collapsed'`, the new instance
 * would emit `onModeChange('collapsed')` from its first effect run, undoing
 * the parent's `'typing'` state and triggering an unmount/remount swap of
 * the *other* layout — which then re-applies the typing intent via the
 * auto-open `$effect` below, causing an infinite mount/swap loop (freeze)
 * after clicking Re-train. By seeding from `command`, the new instance
 * mounts in `'typing'` and the cycle terminates immediately.
 */
let mode = $state<Mode>(command != null ? 'typing' : 'collapsed')
let text = $state('')
let elapsed = $state(0)
let textareaEl = $state<HTMLTextAreaElement | null>(null)
let fileInputEl = $state<HTMLInputElement | null>(null)
/** Files dropped or picked for this draft; previews shown above the textarea. */
let attachments = $state<ComposerAttachment[]>([])
/** Latest attachment list for teardown (avoids stale `onDestroy` reads). */
let attachmentsUnmountSnapshot = $state<ComposerAttachment[]>([])

$effect(() => {
	attachmentsUnmountSnapshot = attachments
})
/** Skip the typing auto-collapse `$effect` while we drive `mode` + `text` after submit/stop (avoids reorder races). */
let suppressTextEffect = false
/** User explicitly opened typing (mobile tap) — keep open until blur even with empty text. */
let keepTypingOpenUntilBlur = false

/** Briefly suppress Space→mic while collapsed right after Space-to-submit avoids reopening listening. */
let openMicCooldownUntilMs = 0

/** Tailwind `sm` breakpoint — coarse/mobile composer interactions. */
let isMobile = $state(false)

/** Hold-to-record on mobile submits on pointer up (no send button). Stream / desktop keep the send control. */
let listeningSubmitOnRelease = $state(false)

	const MOBILE_MQ = '(max-width: 639px)'
const LONG_PRESS_MS = 420
const DOUBLE_TAP_MS = 220

let lastTapAtMs = 0
let holdActive = false
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let pendingSingleTapTimer: ReturnType<typeof setTimeout> | null = null

$effect(() => {
	if (typeof window === 'undefined') return
	const mq = window.matchMedia(MOBILE_MQ)
	const sync = () => {
		isMobile = mq.matches
	}
	sync()
	mq.addEventListener('change', sync)
	return () => mq.removeEventListener('change', sync)
})

function clearLongPressTimer() {
	if (longPressTimer != null) {
		clearTimeout(longPressTimer)
		longPressTimer = null
	}
}

function clearPendingSingleTapTimer() {
	if (pendingSingleTapTimer != null) {
		clearTimeout(pendingSingleTapTimer)
		pendingSingleTapTimer = null
	}
}

function openTyping() {
	void focusShellWebview()
	keepTypingOpenUntilBlur = true
	mode = 'typing'
}

function openMobileFilePicker() {
	void focusShellWebview()
	fileInputEl?.click()
}

function onFileInputChange(e: Event) {
	const input = e.currentTarget as HTMLInputElement
	const files = input.files
	if (files?.length) openWithFiles(files)
	input.value = ''
}

function openStreamListening() {
	listeningSubmitOnRelease = false
	openListening()
}

function onMobileCollapsedPointerDown(e: PointerEvent) {
	holdActive = false
	clearLongPressTimer()
	clearPendingSingleTapTimer()
	const target = e.currentTarget as HTMLElement
	target.setPointerCapture(e.pointerId)
	longPressTimer = setTimeout(() => {
		longPressTimer = null
		clearPendingSingleTapTimer()
		lastTapAtMs = 0
		holdActive = true
		listeningSubmitOnRelease = true
		openListening()
	}, LONG_PRESS_MS)
}

function onMobileCollapsedPointerUp(e: PointerEvent) {
	clearLongPressTimer()
	const target = e.currentTarget as HTMLElement
	if (target.hasPointerCapture(e.pointerId)) {
		target.releasePointerCapture(e.pointerId)
	}

	if (holdActive || (mode === 'listening' && listeningSubmitOnRelease)) {
		holdActive = false
		if (mode === 'listening') void commitVoiceNote()
		return
	}

	const now = performance.now()
	if (now - lastTapAtMs < DOUBLE_TAP_MS) {
		clearPendingSingleTapTimer()
		lastTapAtMs = 0
		openStreamListening()
		return
	}

	lastTapAtMs = now
	pendingSingleTapTimer = setTimeout(() => {
		pendingSingleTapTimer = null
		if (mode === 'collapsed') openTyping()
	}, DOUBLE_TAP_MS)
}

function onMobileCollapsedPointerCancel(e: PointerEvent) {
	clearLongPressTimer()
	clearPendingSingleTapTimer()
	const target = e.currentTarget as HTMLElement
	if (target.hasPointerCapture(e.pointerId)) {
		target.releasePointerCapture(e.pointerId)
	}
	if (holdActive || (mode === 'listening' && listeningSubmitOnRelease)) {
		holdActive = false
		if (mode === 'listening') void commitVoiceNote()
	}
}

$effect(() => {
	onModeChange?.(mode)
})

/**
 * Keep the textarea focused when entering typing mode — including when the parent
 * swaps composer layout (rowCluster ↔ stacked) and this instance mounts with
 * `mode === 'typing'` already, which skips the command auto-open effect below.
 * Subscribes to `textareaEl` / `command` only while typing so we do not steal
 * focus on unrelated updates in other modes.
 */
$effect(() => {
	if (mode !== 'typing') return
	void textareaEl
	void command
	void tick().then(() => {
		const el = textareaEl
		if (!el || mode !== 'typing') return
		el.focus()
		const len = el.value.length
		el.setSelectionRange(len, len)
	})
})

/**
 * Parent-callable entry: opens typing mode with a prefilled slash-command badge.
 * Safe to call right after `bind:this` resolves; the auto-open `$effect` below
 * also handles cases where the composer instance is freshly mounted with
 * `command` already non-null (after a parent-driven mode swap).
 */
export function openWithCommand(label: string) {
	command = label
	if (mode !== 'typing') {
		mode = 'typing'
	}
	scheduleResizeForProgrammaticOpen()
}

/**
 * Add dropped files, open typing mode, focus input. Does not clear existing text;
 * appends to `attachments` (deduped by name + size + lastModified).
 */
export function openWithFiles(fileList: File[] | FileList) {
	const incoming = Array.from(fileList)
	if (!incoming.length) return

	const seen = new Set(
		attachments.map((a) => `${a.file.name}\0${a.file.size}\0${a.file.lastModified}`)
	)
	const next: ComposerAttachment[] = []
	for (const file of incoming) {
		const key = `${file.name}\0${file.size}\0${file.lastModified}`
		if (seen.has(key)) continue
		seen.add(key)
		const previewUrl = isImageFile(file) ? URL.createObjectURL(file) : null
		next.push({ file, previewUrl })
	}
	if (next.length) attachments = [...attachments, ...next]

	if (mode === 'listening') {
		suppressTextEffect = true
		elapsed = 0
	}
	mode = 'typing'
	void tick().then(() => {
		suppressTextEffect = false
		const el = textareaEl
		if (!el || mode !== 'typing') return
		el.focus()
		const len = el.value.length
		el.setSelectionRange(len, len)
	})
	scheduleResizeForProgrammaticOpen()
}

function removeAttachmentAt(index: number) {
	const a = attachments[index]
	if (!a) return
	revokeAttachmentPreview(a)
	attachments = attachments.filter((_, i) => i !== index)
}

function clearAttachments() {
	for (const a of attachments) revokeAttachmentPreview(a)
	attachments = []
}

function formatAttachmentSummary(): string {
	if (attachments.length === 0) return ''
	const names = attachments.map((a) => a.file.name)
	if (names.length === 1) return `Attached: ${names[0]}`
	return `Attached (${names.length}): ${names.join(', ')}`
}

onDestroy(() => {
	clearLongPressTimer()
	clearPendingSingleTapTimer()
	for (const a of attachmentsUnmountSnapshot) revokeAttachmentPreview(a)
})

/**
 * Whenever a command badge is present, force typing mode (covers the remount
 * case where a fresh composer instance receives `command` via bindable prop).
 */
$effect(() => {
	if (command != null && mode !== 'typing' && mode !== 'listening') {
		mode = 'typing'
	}
})

const barIndices = [...Array.from({ length: BAR_COUNT }).keys()]

function isEditableTarget(node: EventTarget | null): boolean {
	if (!(node instanceof HTMLElement)) return false
	const tag = node.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
	if (node.isContentEditable) return true
	return false
}

$effect(() => {
	const onKeyDown = async (e: KeyboardEvent) => {
		if (mode === 'listening' && e.key === 'Escape') {
			e.preventDefault()
			await stopListening()
			return
		}

		if (isEditableTarget(document.activeElement)) return

		const isSpace = e.key === ' ' || e.code === 'Space'

		if (mode === 'collapsed') {
			if (isMobile) return
			if (isSpace) {
				e.preventDefault()
				if (performance.now() < openMicCooldownUntilMs) return
				listeningSubmitOnRelease = false
				openListening()
				return
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return
			if (e.key.length !== 1) return
			e.preventDefault()
			mode = 'typing'
			text = e.key
			return
		}

		if (mode === 'listening' && isSpace) {
			e.preventDefault()
			void commitVoiceNote()
		}
	}

	window.addEventListener('keydown', onKeyDown, true)
	return () => window.removeEventListener('keydown', onKeyDown, true)
})

$effect(() => {
	if (mode !== 'listening') {
		elapsed = 0
		return
	}
	elapsed = 0
	const id = setInterval(() => {
		elapsed += 1
	}, 1000)
	return () => clearInterval(id)
})

function resizeComposer() {
	const el = textareaEl
	if (!el) return
	// Reset flex-induced height so `scrollHeight` reflects text, not parent stretch (TAURI / flex layouts).
	el.style.minHeight = '0'
	el.style.height = '0px'
	const style = getComputedStyle(el)
	const lineHeight = parseFloat(style.lineHeight)
	const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
	const lh =
		Number.isFinite(lineHeight) && lineHeight > 0
			? lineHeight
			: (parseFloat(style.fontSize) || 16) * 1.3
	const minH = lh + (Number.isFinite(pad) ? pad : 0)
	const maxPx = lh * TYPING_TEXTAREA_MAX_ROWS + (Number.isFinite(pad) ? pad : 0)
	// Empty text → always one line. Avoids initial mount measurement returning a multi-line scrollHeight
	// when the box was just inserted into a flex container with align-items: stretch.
	const scrollH = el.value.length === 0 ? minH : el.scrollHeight
	const h = Math.min(Math.max(scrollH, minH), maxPx)
	el.style.height = `${h}px`
	el.style.overflowY = scrollH > maxPx ? 'auto' : 'hidden'
}

/** Ensure the textarea is sized for one line on programmatic open (drop / retrain). */
function scheduleResizeForProgrammaticOpen() {
	void tick().then(() => {
		resizeComposer()
		requestAnimationFrame(() => resizeComposer())
	})
}

$effect(() => {
	void text
	void textareaEl
	void mode
	void tick().then(() => resizeComposer())
})

function openListening() {
	void focusShellWebview()
	mode = 'listening'
}

async function stopListening() {
	suppressTextEffect = true
	keepTypingOpenUntilBlur = false
	listeningSubmitOnRelease = false
	holdActive = false
	mode = 'collapsed'
	await tick()
	suppressTextEffect = false
}

function collapseIfEmpty() {
	keepTypingOpenUntilBlur = false
	if (command != null) return
	if (text.trim() === '' && attachments.length === 0) mode = 'collapsed'
}

$effect(() => {
	if (suppressTextEffect) return
	if (mode !== 'typing') return
	if (keepTypingOpenUntilBlur) return
	if (command != null) return
	if (text.trim() !== '') return
	if (attachments.length > 0) return
	mode = 'collapsed'
})

async function finalizeSubmitCollapseAfterParent() {
	await tick()
	await tick()
	mode = 'collapsed'
	suppressTextEffect = false
}

async function commitVoiceNote() {
	if (!onSubmitMessage || disabled || submitBusy) return
	const body = VOICE_MOCK_TRANSCRIPTS[Math.floor(Math.random() * VOICE_MOCK_TRANSCRIPTS.length)]

	suppressTextEffect = true
	text = ''
	clearAttachments()
	keepTypingOpenUntilBlur = false
	listeningSubmitOnRelease = false
	holdActive = false
	mode = 'collapsed'
	openMicCooldownUntilMs = performance.now() + 280

	onSubmitMessage(body, [])
	await finalizeSubmitCollapseAfterParent()
}

async function commitMessage() {
	if (disabled || submitBusy) return
	const raw = text.trim()
	const activeCommand = command
	const attachBlock = formatAttachmentSummary()

	if (activeCommand != null) {
		if (!onCommandSubmit) return
		if (!raw && !attachBlock) return
		const filesSnapshot = attachments.map((a) => a.file)
		suppressTextEffect = true
		keepTypingOpenUntilBlur = false
		text = ''
		command = null
		mode = 'collapsed'
		textareaEl?.blur()
		const combined = [raw, attachBlock].filter(Boolean).join('\n\n')
		clearAttachments()
		onCommandSubmit(activeCommand, combined, filesSnapshot)
		await finalizeSubmitCollapseAfterParent()
		return
	}

	if (!onSubmitMessage) return
	if (!raw && !attachBlock) return

	const filesSnapshot = attachments.map((a) => a.file)
	suppressTextEffect = true
	keepTypingOpenUntilBlur = false
	text = ''
	mode = 'collapsed'
	textareaEl?.blur()

	const message = [attachBlock, raw].filter(Boolean).join('\n\n')
	clearAttachments()

	onSubmitMessage(message, filesSnapshot)
	await finalizeSubmitCollapseAfterParent()
}

async function onTextareaKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape') {
		e.preventDefault()
		suppressTextEffect = true
		keepTypingOpenUntilBlur = false
		text = ''
		command = null
		clearAttachments()
		mode = 'collapsed'
		textareaEl?.blur()
		await tick()
		suppressTextEffect = false
		return
	}
	if (e.key === 'Backspace' && command != null && text.length === 0) {
		e.preventDefault()
		command = null
		return
	}
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault()
		commitMessage()
	}
}

const timerLabel = $derived.by(() => {
	const m = Math.floor(elapsed / 60)
	const s = elapsed % 60
	return `${m}:${String(s).padStart(2, '0')}`
})

const pillClass = $derived.by(() => {
	const base =
		'flex max-w-full overflow-hidden transition-[width,max-width,background-color,border-color,border-radius,box-shadow,padding] duration-[360ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]'
	if (mode === 'collapsed') {
		return `${base} h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary p-0 text-primary-foreground shadow-[0_8px_24px_-8px_color-mix(in_srgb,var(--color-primary)_50%,transparent)]`
	}
	if (mode === 'listening') {
		if (isMobile) {
			if (listeningSubmitOnRelease) {
				return `${base} h-14 w-[min(18rem,calc(100vw-5.5rem))] items-center gap-2 rounded-full border border-primary/25 bg-primary px-2.5 text-primary-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]`
			}
			return `${base} h-14 w-[min(20rem,calc(100vw-3rem))] items-center gap-2 rounded-full border border-primary/25 bg-primary px-2.5 text-primary-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]`
		}
		return `${base} h-14 w-[min(18rem,46vw)] items-center gap-2.5 rounded-full border border-primary/25 bg-primary px-3 text-primary-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] sm:gap-3 sm:px-3.5`
	}
	return `${base} tech-pill !max-w-[min(36rem,80vw)] !rounded-2xl mx-auto w-full items-center justify-center gap-2 border-border py-0 pl-2 pr-2 text-foreground shadow-none sm:gap-3 sm:pl-4 sm:pr-2`
})
</script>

<div
	class={rowCluster
		? 'flex shrink-0 flex-col items-center justify-center gap-2'
		: 'flex w-full flex-col items-center justify-center gap-2'}
>
	{#if mode === 'typing' && enableAttachments && attachments.length > 0}
		<div
			class="flex w-full max-w-[min(36rem,80vw)] mx-auto gap-1.5 max-sm:gap-2 sm:px-1"
			aria-label="Attached files"
		>
			{#if isMobile}
				<div class="size-9 shrink-0" aria-hidden="true"></div>
			{/if}
			<div class="flex min-w-0 flex-1 flex-wrap gap-1.5 px-0.5 sm:px-0">
			{#each attachments as a, i (`${a.file.name}-${a.file.size}-${a.file.lastModified}-${i}`)}
				<div
					class="group relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/50 shadow-sm"
					title={a.file.name}
				>
					{#if a.previewUrl}
						<img src={a.previewUrl} alt="" class="size-full object-cover" />
					{:else}
						<div
							class="flex size-full flex-col items-center justify-center gap-0.5 px-0.5 text-center"
						>
							<svg
								class="size-4 shrink-0 opacity-60"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 12 0 00-9-9z"
								/>
							</svg>
							<span class="w-full truncate text-[8px] font-medium leading-none opacity-70">
								{a.file.name.split('.').pop() ?? '·'}
							</span>
						</div>
					{/if}
					<button
						type="button"
						class="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-border bg-background/95 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
						onclick={(ev) => {
							ev.preventDefault()
							ev.stopPropagation()
							removeAttachmentAt(i)
						}}
						aria-label={`Remove ${a.file.name}`}
					>
						<svg
							class="size-3"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			{/each}
			</div>
		</div>
	{/if}
	{#if mode === 'collapsed'}
		<div class={pillClass} role="group">
			<button
				type="button"
				class="flex h-14 w-14 shrink-0 touch-manipulation select-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-40"
				disabled={disabled}
				onpointerdown={(e) => {
					void focusShellWebview()
					if (isMobile) onMobileCollapsedPointerDown(e)
				}}
				onpointerup={(e) => {
					if (isMobile) onMobileCollapsedPointerUp(e)
				}}
				onpointercancel={(e) => {
					if (isMobile) onMobileCollapsedPointerCancel(e)
				}}
				onclick={(e) => {
					if (isMobile) {
						e.preventDefault()
						return
					}
					listeningSubmitOnRelease = false
					openListening()
				}}
				aria-label={isMobile
					? 'Tap to type, double-tap for voice stream, hold to record (mock)'
					: 'Start voice note (mock)'}
			>
				<svg
					class="size-6"
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path d="M0 0h24v24H0z" fill="none" />
					<path
						fill="none"
						stroke="currentColor"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 19c1.2-3.678 2.526-5.005 6-6c-3.474-.995-4.8-2.322-6-6c-1.2 3.678-2.526 5.005-6 6c3.474.995 4.8 2.322 6 6Zm-8-9c.6-1.84 1.263-2.503 3-3c-1.737-.497-2.4-1.16-3-3c-.6 1.84-1.263 2.503-3 3c1.737.497 2.4 1.16 3 3Zm1.5 10c.3-.92.631-1.251 1.5-1.5c-.869-.249-1.2-.58-1.5-1.5c-.3.92-.631 1.251-1.5 1.5c.869.249 1.2.58 1.5 1.5Z"
					/>
				</svg>
			</button>
		</div>
	{:else if mode === 'listening'}
	<div class={pillClass} role="group">
			<div
				class={`flex shrink-0 items-center justify-start ${isMobile ? 'w-[2.75rem]' : 'w-[4.5rem]'}`}
			>
				<span class="font-mono text-[10px] font-bold tracking-wider opacity-80 tabular-nums"
					>{timerLabel}</span
				>
			</div>
			<div
				class="flex min-h-7 min-w-0 flex-1 items-end justify-center gap-px px-1 py-1 sm:px-2"
				aria-hidden="true"
			>
				{#each barIndices as i (i)}
					<span
						class="intent-mock-bar inline-block h-7 w-0.5 shrink-0 rounded-full bg-primary-foreground/75"
						style={`animation-delay: ${i * 0.08}s`}
					></span>
				{/each}
			</div>
			{#if !listeningSubmitOnRelease}
				<div
					class={`flex shrink-0 items-center justify-end ${isMobile ? 'gap-1.5 pl-1' : 'w-[4.5rem] gap-2'}`}
				>
					<button
						type="button"
						class="flex size-8 shrink-0 items-center justify-center rounded-full border border-status-success/35 bg-status-success text-status-success-foreground shadow-[0_2px_8px_-2px_rgba(0,0,0,0.2)] outline-none transition-colors hover:bg-status-success/90 focus-visible:ring-2 focus-visible:ring-status-success/40"
						onclick={commitVoiceNote}
						aria-label="Submit voice note as intent (mock)"
					>
						<svg
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5L20 7" />
						</svg>
					</button>
					<button
						type="button"
						class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 text-primary-foreground transition-opacity hover:bg-primary-foreground/25"
						onclick={() => void stopListening()}
						aria-label="Stop listening"
					>
						<svg
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			{/if}
	</div>
	{:else}
		<div
			class="flex w-full max-w-[min(36rem,80vw)] mx-auto items-end gap-1.5 max-sm:gap-2 sm:items-center sm:gap-2.5"
		>
			{#if isMobile && enableAttachments}
				<button
					type="button"
					class="mb-1 flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-full border border-border/70 bg-muted/40 text-foreground/70 shadow-sm outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35"
					onclick={openMobileFilePicker}
					aria-label="Attach image or file"
				>
					<svg
						class="size-[1.05rem]"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
						/>
					</svg>
				</button>
			{/if}
			<div class="{pillClass} min-w-0 flex-1 !mx-0 max-sm:!max-w-none" role="group">
				<div class="flex min-h-0 min-w-0 w-full items-center gap-2 py-1 max-sm:py-1 sm:gap-2.5 sm:py-2">
					<form
						class="flex min-h-0 min-w-0 flex-1 items-center gap-2"
						onsubmit={(e) => {
							e.preventDefault()
							commitMessage()
						}}
					>
						{#if command}
							<span
								class="inline-flex shrink-0 items-center rounded-full border border-status-error/30 bg-status-error px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-status-error-foreground select-none"
								aria-label={`Active command: ${command}`}
								title="Backspace or Escape to remove"
							>
								{command.toUpperCase()}
							</span>
						{/if}
						<textarea
							bind:this={textareaEl}
							bind:value={text}
							placeholder={command ? 'Add feedback (optional)…' : placeholder}
							rows="1"
							disabled={disabled || submitBusy}
							oninput={resizeComposer}
							onkeydown={onTextareaKeydown}
							onblur={collapseIfEmpty}
							class="min-h-9 max-h-[min(24rem,calc(100vh-12rem))] w-full min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent py-2 px-0 text-sm leading-snug font-medium tracking-tight outline-none placeholder:opacity-20 focus:ring-0 sm:min-h-10 sm:py-2.5 sm:text-xl sm:leading-tight"
						></textarea>
					</form>
					<button
						type="button"
						onclick={commitMessage}
						disabled={
							disabled ||
							submitBusy ||
							(command == null && text.trim().length === 0 && attachments.length === 0)
						}
						aria-label={submitBusy ? 'Sending…' : 'Send message'}
						class="flex size-9 shrink-0 self-center items-center justify-center rounded-full border border-primary/25 bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_color-mix(in_srgb,var(--color-primary)_50%,transparent)] outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{#if submitBusy}
							<span class="text-xs font-bold" aria-hidden="true">…</span>
						{:else}
							<svg
								class="size-4"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0-7 7m7-7 7 7" />
							</svg>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
	<input
		bind:this={fileInputEl}
		type="file"
		class="sr-only"
		multiple
		accept={FILE_INPUT_ACCEPT}
		onchange={onFileInputChange}
		tabindex="-1"
		aria-hidden="true"
		disabled={!enableAttachments}
	/>
</div>
