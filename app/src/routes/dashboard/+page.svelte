<script lang="ts">
import { isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import { dev } from '$app/environment'
import { page } from '$app/state'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { listenerActor } from '$lib/actors/listener.actor.svelte'
import { speakerActor } from '$lib/actors/speaker.actor.svelte'
import '$lib/actors/windows'
import IntentsPlaceholder from '$lib/intents/IntentsPlaceholder.svelte'
import { shell } from '$lib/intents/talk.svelte'
import QueryModal from '$lib/query/QueryModal.svelte'
import { query } from '$lib/query/query.svelte'
import { registerMockSources } from '$lib/query/sources.mock'
import SkillsPlatform from '$lib/skills/SkillsPlatform.svelte'

/**
 * Dashboard — a chat against RedPill's confidential Gemma
 * (`phala/gemma-4-31b-it`), streamed token by token, spoken aloud in German by
 * Supertonic as it arrives, and listened to with Nemotron + Silero VAD.
 *
 * The split is deliberate: the brain is remote and attested, the voice is
 * entirely on-device.
 */

/**
 * The page constructs nothing. The mesh assembles itself in the actor
 * modules — registration, contracts, the emit wiring — and this file merely
 * renders the actors' state. The aliases keep the template readable.
 */
const speaker = speakerActor.core
const chat = chatActor.core
const listener = listenerActor.core

/**
 * Which surface fills the middle of the screen — driven by the left rail
 * now that the tab bar is gone: the intents workspace, or the skills
 * platform. One store, so the rail and the shell never disagree.
 */

/**
 * Voice is the default, except where there is no voice.
 *
 * In a plain browser tab the recognizer is unavailable, and starting in voice
 * mode there means an empty panel with no way to say anything until you find
 * the icon. Text is the only mode that works, so it is the one to start in.
 */
/**
 * Dev only: `?voice=<phase>` in a browser tab fakes the voice UI so the pill
 * can be styled without a Tauri build — `idle`, `hearing`, `speaking`,
 * `thinking`, `loading`, `blocked`, `denied`, `error`. No mic, no TTS: the
 * phase is painted, not produced. Production ignores the parameter.
 */
const MOCK_PHASES = {
	idle: 'Ready',
	hearing: 'Listening',
	speaking: 'Speaking',
	thinking: 'Thinking',
	loading: 'Ears loading 42%',
	blocked: 'Enable audio',
	denied: 'No microphone',
	error: 'Error'
} as const
const mockPhase = $derived.by(() => {
	if (!dev) return null
	const v = page.url.searchParams.get('voice')
	return v !== null && v in MOCK_PHASES ? (v as keyof typeof MOCK_PHASES) : null
})
const voiceUi = $derived(isTauri() || mockPhase !== null)

let typing = $state(!isTauri())

/**
 * Whether the conversation is running at all — on by default, because
 * hands-free IS the product. Deliberately separate from `typing`: that
 * switches the INPUT, this ends the session. Ending means the ears close
 * (the OS mic indicator goes dark), the voice goes silent, and the pill
 * shrinks to the logo — one tap to come back.
 */
let conversing = $state(isTauri())

// The mock enters voice mode without opening anything.
$effect.pre(() => {
	if (mockPhase !== null) {
		conversing = true
		typing = false
	}
})

// Hands-free by default: the mic opens as soon as the page does.
//
// `onMount`, emphatically not `$effect`. An effect tracks what its body reads,
// and `start()` both reads and writes `listener.status` — so the write
// invalidated the effect, the cleanup tore the audio graph down, and it started
// over, forever. The microphone was genuinely open the whole time (macOS even
// showed the orange indicator), but the worklet never survived long enough to
// deliver a single batch.
onMount(() => {
	if (conversing && mockPhase === null) void listener.start()
	return () => listener.stop()
})

/**
 * Leaving the conversation stops everything that could still make noise or
 * listen: the reply stream, the work lane, the voice, the ears. Coming back
 * reopens the ears — and only then, so the mic is never live while the
 * conversation is off.
 */
function endConversation() {
	conversing = false
	// Also out of typing mode: "ended" must look the same from wherever it
	// was ended, otherwise the logo is not reliably the way back.
	typing = false
	chat.stop()
	speaker.silence()
	listener.stop()
}

function beginConversation() {
	conversing = true
	typing = false
	// Voice mode always speaks: clear any mute left over from a text session.
	speaker.muted = false
	void listener.start()
}

/** Clear whatever error is showing above the pill; the next good turn clears it anyway. */
function dismissError() {
	chat.failure = null
	speaker.failure = null
	listener.failure = null
}

// The recognizer needs to know when its own voice is in the room. Reading
// `speaker.speaking` is the tracked dependency; `setOutputActive` writes no
// reactive state, so this cannot feed back into itself.
$effect(() => {
	listener.setOutputActive(speaker.speaking)
})

// Any conversation activity — typed or spoken — opens the one answer surface,
// where the reply and anything it renders appear together.
$effect(() => {
	if (chat.turns.length > 0) {
		query.show()
		shell.tab = 'intents'
	}
})

// The mocked slice-1 sources; slice 2 registers one per skill instead.
registerMockSources()

/**
 * One state for the whole conversation, instead of one per component.
 *
 * The pieces each know their own status, but what you actually want to see is
 * whose turn it is — and the order matters: speaking wins over thinking because
 * the reply is still streaming while the first sentence is already being read
 * out, and hearing wins over everything because interrupting is allowed.
 */
const phase = $derived.by(() => {
	if (mockPhase !== null && conversing && !typing)
		return { key: mockPhase, label: MOCK_PHASES[mockPhase] }
	// Off wins over everything: with the ears closed, every other status is
	// a leftover from the session that just ended.
	if (!conversing && !typing) return { key: 'off', label: 'Conversation ended' }
	if (listener.status === 'denied') return { key: 'denied', label: 'No microphone' }
	if (listener.status === 'error' || speaker.status === 'error')
		return { key: 'error', label: 'Error' }
	// A sentence that fails to synthesize does not stop the voice for good, so it
	// keeps `status` — but it must not just go quiet either, which is
	// indistinguishable from the voice being broken.
	if (speaker.failure) return { key: 'error', label: `Voice: ${speaker.failure}` }
	if (speaker.status === 'preparing')
		return { key: 'loading', label: `Voice loading ${Math.round(speaker.progress * 100)}%` }
	if (listener.status === 'preparing')
		return listener.stage === 'load'
			? { key: 'starting', label: 'Ears starting…' }
			: { key: 'loading', label: `Ears loading ${Math.round(listener.progress * 100)}%` }
	if (listener.speech) return { key: 'hearing', label: 'Listening' }
	// Audio output that never got a user gesture. Saying "Spricht" over a sleeping
	// device is the one state that gives you nothing to act on — this one you can
	// tap, and one tap fixes it for the rest of the session.
	if (speaker.output === 'suspended') return { key: 'blocked', label: 'Enable audio' }
	if (speaker.speaking) return { key: 'speaking', label: 'Speaking' }
	if (chat.streaming) return { key: 'thinking', label: 'Thinking' }
	if (listener.status === 'listening') return { key: 'idle', label: 'Ready' }
	return { key: 'text', label: 'Text only' }
})

// Model-load percent (STT or TTS, whichever is preparing). Kept as a number so
// the loading bar and its label can share ONE line — no second row that grows
// the pill's height.
const loadPct = $derived(
	mockPhase === 'loading'
		? 42
		: Math.round((listener.status === 'preparing' ? listener.progress : speaker.progress) * 100)
)

let draft = $state('')
/** Height of the floating bottom dock (toast/HITL/pill) — the center column
 * of the workspaces keeps this much clearance while the asides run to the
 * screen bottom underneath it. */
let dockH = $state(0)

/**
 * How far the dock floats off the bottom edge, in px — the `bottom-2`/`left-2`/
 * `right-2` on the dock below, named so the clearance above it can use the SAME
 * number. It was hard-coded as 16 while the dock sat at 8, which is why the gap
 * over the pill read as twice the gap under it.
 */
const DOCK_INSET = 8

let form: HTMLFormElement | null = $state(null)
let textareaEl: HTMLTextAreaElement | null = $state(null)

// Switching to text mode should land the cursor in the field — no second click
// to start writing. The effect fires when `typing` flips true and the textarea
// has mounted; focusing an already-focused field is a harmless no-op.
$effect(() => {
	if (typing && textareaEl) textareaEl.focus()
})

/**
 * Text mode is silent AND deaf: the ears close, the voice mutes — a typed
 * reply is read, not heard. The models stay loaded; the way back is instant.
 */
function enterTyping(seed = '') {
	if (typing) return
	typing = true
	if (seed) draft += seed
	listener.stop()
	speaker.silence()
	speaker.muted = true
}

/**
 * Back to voice: unmute the mouth and reopen the ears.
 *
 * Unless there is no voice to go back to. In a plain browser tab the
 * recognizer never runs, so dropping out of text mode left the panel with no
 * input at all — and `enterTyping` could not rescue it, because the keystroke
 * that calls it is gated on the conversation being live. One message, then
 * silence. Text is the only mode there, so stay in it.
 */
function leaveTyping() {
	if (!conversing) return
	typing = false
	speaker.muted = false
	if (conversing) void listener.start()
}

/**
 * Voice→text without a click: the first printable keystroke IS the mode
 * switch — start typing anywhere and the pill becomes the input, seeded
 * with that very character.
 */
function onGlobalKeydown(event: KeyboardEvent) {
	// The two keys every spotlight already answers to, before anything else
	// claims them — including while typing, which is when you most want out.
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
		event.preventDefault()
		query.toggle()
		return
	}
	if (event.key === 'Escape' && query.open) {
		event.preventDefault()
		query.close()
		return
	}
	if (typing || !conversing) return
	if (event.metaKey || event.ctrlKey || event.altKey) return
	if (event.key.length !== 1) return
	const el = document.activeElement
	if (
		el instanceof HTMLInputElement ||
		el instanceof HTMLTextAreaElement ||
		(el instanceof HTMLElement && el.isContentEditable)
	)
		return
	event.preventDefault()
	enterTyping(event.key)
}

function submit(event: SubmitEvent) {
	event.preventDefault()
	// The send click is the user gesture the audio device needs; without it the
	// first reply would synthesize into a suspended context and never be heard.
	speaker.resumeAudio()
	const text = draft
	draft = ''
	query.text = text
	query.show()
	chat.send(text)
	// Submitting hands the turn back to the voice: hands-free is the default.
	leaveTyping()
}

/** Enter sends, shift+enter makes a newline — the usual bargain. */
function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault()
		form?.requestSubmit()
	}
}
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<svelte:head>
	<title>Dashboard · avenOS</title>
</svelte:head>

<!-- Buchhaltung und Skills sind Arbeitsflächen im Inbox-Layout und bekommen
     die volle Fensterbreite; die übrigen Tabs bleiben auf Lesebreite zentriert.
     Ein einziges 8px-Raster (gap-2/p-2) trägt alle Abstände: Fensterkante →
     Tabs → Fläche → Voice-Panel → Fensterkante. -->
<!-- The workspaces (skills, intents) take the whole window; views stay at
     reading width. -->
<main
	class="relative mx-auto flex min-h-0 min-w-0 w-full max-w-none flex-1 flex-col gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
	style="--dock-h: {dockH + DOCK_INSET}px"
>
	{#if shell.tab === 'intents'}
		<!-- The intents workspace fills everything between the tabs and the
		     HITL bar — the wrapper carries the flex-1 so the three columns
		     stretch to the full available height. -->
		<div class="flex min-h-0 w-full flex-1">
			<IntentsPlaceholder />
		</div>
	{:else if shell.tab === 'skills'}
		<!-- The skills platform: a skill is a collection of composable
		     workflows; the canvas draws them n8n-style, every wire derived. -->
		<div class="flex min-h-0 w-full flex-1 flex-col">
			<SkillsPlatform />
		</div>
	{/if}

	<!-- THE answer surface: it floats over the workspace rather than replacing
	     it, so the selected intent it answers about stays in view behind. -->
	<QueryModal />

	<!-- The floating dock: errors and the pill hover OVER the workspace, so the
	     side columns can run to the bottom of the screen. What the tools DID is
	     not here — a tool result is part of the conversation that asked for it,
	     so it renders inline in the modal's chat band. -->
	<div
		bind:clientHeight={dockH}
		class="pointer-events-none absolute right-2 bottom-2 left-2 z-50 flex flex-col gap-1.5 pb-[env(safe-area-inset-bottom)] [&>*]:pointer-events-auto"
	>
		<!-- Errors surface HERE, above the voice area — the same universal band as
	     the human gate, so a failed reply (a dead lane, an unset key) is visible
	     from any tab and in voice mode, not buried in the chat stream. The × or
	     the next successful turn clears it. -->
		{#if chat.failure || speaker.failure || listener.failure}
			<div
				class="mx-auto mb-2 flex w-full max-w-2xl items-start gap-3 rounded-2xl border border-error/40 bg-error-muted px-4 py-2.5 text-error-strong shadow-[0_4px_16px_rgba(30,41,59,0.08)]"
			>
				<span class="shrink-0 pt-0.5 font-mono text-sm">✗</span>
				<p class="min-w-0 flex-1 text-sm leading-snug">
					{chat.failure ?? speaker.failure ?? listener.failure}
				</p>
				<button
					type="button"
					onclick={dismissError}
					title="Dismiss"
					aria-label="Dismiss error"
					class="-mr-1 shrink-0 rounded-full p-1 transition-colors hover:bg-error/15"
				>
					<svg
						viewBox="0 0 24 24"
						class="size-4"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					>
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>
		{/if}

		<!-- The bottom row: on phones, the way back from an open intent sits to
		     the LEFT of the pill — the pill is the one fixed landmark, so the
		     back button lives beside it rather than anywhere in the workspace. -->
		<div class="flex items-center justify-center gap-2">
			{#if shell.tab === 'intents' && shell.detail}
				<button
					type="button"
					onclick={() => {
					shell.detail = false
					shell.rightOpen = false
				}}
					title="Zurück zu den Intents"
					aria-label="Zurück zu den Intents"
					class="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface-card text-foreground shadow-[0_4px_16px_rgba(30,41,59,0.12)] transition-colors hover:bg-surface-card-selected md:hidden"
				>
					<svg
						viewBox="0 0 24 24"
						class="size-5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M19 12H5" />
						<path d="m12 19-7-7 7-7" />
					</svg>
				</button>
			{/if}
			<!-- One panel: what the system is doing, and how you talk to it. Dark, so it
	     reads as the active surface rather than another card on a pale page. -->
			<div
				class="{phase.key === 'off'
			? 'w-fit'
			: `rounded-full bg-primary text-primary-foreground ${typing ? 'w-full max-w-lg p-2.5' : 'w-full max-w-80 p-2.5'}`}"
				title="Silero VAD · Nemotron 3.5 (de-DE) · Supertonic-3 M5 — all on-device"
			>
				<div class="flex items-center {phase.key === 'off' ? '' : 'gap-3'}">
					<!-- The input-mode switch sits LEFT: it changes how you talk, so it leads
			     the panel; leaving the conversation is the last resort and sits at
			     the far right. -->
					{#if voiceUi && phase.key !== 'off'}
						<button
							type="button"
							onclick={() => {
						if (typing) {
							if (!conversing) beginConversation()
							else leaveTyping()
						} else {
							enterTyping()
						}
					}}
							class="shrink-0 rounded-full border border-primary-foreground/25 p-2 transition-colors hover:bg-primary-foreground/10"
							title={typing ? 'Back to voice' : 'Type instead'}
							aria-label={typing ? 'Back to voice' : 'Type instead'}
						>
							{#if typing}
								<!-- microphone: go back to speaking -->
								<svg
									viewBox="0 0 24 24"
									class="size-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
									<path d="M5 11a7 7 0 0 0 14 0" />
									<path d="M12 18v3" />
								</svg>
							{:else}
								<!-- keyboard: switch to typing -->
								<svg
									viewBox="0 0 24 24"
									class="size-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<rect x="2.5" y="6" width="19" height="12" rx="2" />
									<path d="M7 10h.01M11 10h.01M15 10h.01M17.5 10h.01M7.5 14h9" />
								</svg>
							{/if}
						</button>
					{/if}

					{#if typing}
						<form bind:this={form} onsubmit={submit} class="flex flex-1 items-center gap-2">
							<textarea
								bind:this={textareaEl}
								bind:value={draft}
								oninput={() => {
							query.text = draft
							if (draft !== '') query.show()
						}}
								onkeydown={onKeydown}
								rows="1"
								placeholder="Write…"
								class="field-sizing-content max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-primary-foreground/40"
							></textarea>
							<!-- Same shape as the mode toggle next to it, so the panel ends in a
					     matched pair of round icon buttons rather than a word and a circle. -->
							<button
								type="submit"
								disabled={draft.trim() === ''}
								title="Send"
								aria-label="Send"
								class="shrink-0 rounded-full border border-primary-foreground/25 p-2 transition-all hover:bg-primary-foreground/10 disabled:opacity-30 disabled:hover:bg-transparent"
							>
								<!-- arrow up: send -->
								<svg
									viewBox="0 0 24 24"
									class="size-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M12 19V5" />
									<path d="m5 12 7-7 7 7" />
								</svg>
							</button>
						</form>
					{:else if phase.key === 'off'}
						<!-- Ended: the pill shrinks to the mark itself. One target, one
				     meaning — tap the logo and the conversation is back. Nothing
				     else is offered here, because nothing else applies. -->
						<button
							type="button"
							onclick={beginConversation}
							title="Start conversation"
							aria-label="Start conversation"
							class="group relative block size-14 overflow-visible rounded-full"
						>
							<!-- The label is a standing tooltip above the mark — a light eggshell
					     chip with a little arrow pointing down at the circle, shown always
					     so the one thing to press names itself. -->
							<span
								class="-translate-x-1/2 pointer-events-none absolute bottom-full left-1/2 mb-2.5 whitespace-nowrap rounded-full border border-border bg-surface-cream px-3 py-1 font-medium text-foreground text-xs shadow-sm"
							>
								Start conversation
								<!-- The arrow: an eggshell diamond, its two lower sides bordered, so
						     it reads as the tail of the chip pointing at the button. -->
								<span
									class="-bottom-[5px] -translate-x-1/2 absolute left-1/2 size-2 rotate-45 border-border border-r border-b bg-surface-cream"
								></span>
							</span>
							<!-- The mark itself: a bordered circle with air between edge and logo.
					     Hover deepens the cream a touch — the border stays exactly as it
					     is; the whole gesture is a whisper, not a repaint. -->
							<span
								class="block size-full rounded-full border border-border bg-surface-cream p-1.5 transition-colors group-hover:bg-surface-card-selected"
							>
								<img src="/aven-logo.svg" alt="" class="size-full rounded-full object-cover">
							</span>
						</button>
					{:else}
						<!-- While listening the dot follows the microphone level, so a dead
				     input is visible as a dot that never moves. -->
						<span
							class="inline-block size-2 shrink-0 rounded-full transition-transform"
							class:bg-error={phase.key === 'hearing' || phase.key === 'idle'}
							class:bg-success={phase.key === 'speaking'}
							class:bg-progress={phase.key === 'thinking' ||
						phase.key === 'loading' ||
						phase.key === 'starting'}
							class:bg-primary-foreground={phase.key === 'denied' || phase.key === 'text'}
							class:animate-pulse={phase.key === 'thinking' ||
						phase.key === 'loading' ||
						phase.key === 'starting'}
							style={phase.key === 'hearing' || phase.key === 'idle'
						? `transform: scale(${1 + Math.min(listener.level, 1) * 2})`
						: ''}
						></span>
						{#if phase.key === 'blocked'}
							<!-- The whole label is the button. There is nothing else to do in this
					     state, and a separate control next to it would just be a second
					     thing to read before the obvious one. -->
							<button
								type="button"
								onclick={() => speaker.resumeAudio()}
								class="flex-1 text-left text-sm underline underline-offset-4"
							>
								{phase.label}
							</button>
						{:else if phase.key === 'loading'}
							<!-- Loading stays on the one line: the word, a thin inline bar, and the
					     percent — never a second row that would grow the pill. -->
							<span class="flex flex-1 items-center gap-2 text-sm">
								<span class="shrink-0 opacity-80">{phase.label.replace(/\s*\d+%$/, '')}</span>
								<span
									class="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-primary-foreground/20"
								>
									<span
										class="block h-full rounded-full bg-primary-foreground transition-[width]"
										style="width: {loadPct}%"
									></span>
								</span>
								<span class="shrink-0 text-xs tabular-nums opacity-70">{loadPct}%</span>
							</span>
						{:else}
							<span class="flex-1 text-sm">{phase.label}</span>
						{/if}
						{#if chat.streaming || speaker.speaking}
							<!-- Same circle as its neighbours, but filled: it is the one action
					     that matters while the assistant is talking, so it gets the
					     inverted colors instead of an outline. -->
							<button
								type="button"
								onclick={() => {
							// Stops the reply stream and the voice; the ears stay open,
							// because interrupting is allowed — that is what this is for.
							chat.stop()
							speaker.silence()
						}}
								title="Stop"
								aria-label="Stop"
								class="shrink-0 rounded-full bg-error p-2 text-primary-foreground transition-opacity hover:opacity-80"
							>
								<svg viewBox="0 0 24 24" class="size-4" fill="currentColor">
									<rect x="7" y="7" width="10" height="10" rx="1.5" />
								</svg>
							</button>
						{/if}
					{/if}

					<!-- Only where there is something to switch to. In the browser there is
			     no recognizer at all, so text is not a mode there — it is the whole
			     interface, and a button offering to leave it leads nowhere. -->
					<!-- Ending the conversation: the hang-up, far right — a phone put down,
			     not a power switch. Hidden once ended; the logo is the way back. -->
					{#if voiceUi && phase.key !== 'off'}
						<button
							type="button"
							onclick={endConversation}
							title="End conversation"
							aria-label="End conversation"
							class="shrink-0 rounded-full bg-error p-2 text-primary-foreground transition-opacity hover:opacity-80"
						>
							<!-- hang-up: the handset rotated OFF the hook — disconnect, not dial -->
							<svg
								viewBox="0 0 24 24"
								class="size-4 rotate-[135deg]"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path
									d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
								/>
							</svg>
						</button>
					{/if}
				</div>
			</div>
			{#if shell.tab === 'intents' && shell.detail}
				<!-- Skills & artifacts: the right column, as a drawer, bottom right. -->
				<button
					type="button"
					onclick={() => {
						shell.rightOpen = !shell.rightOpen
					}}
					title="Skills & Artefakte"
					aria-label="Skills & Artefakte"
					aria-expanded={shell.rightOpen}
					class="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface-card text-foreground shadow-[0_4px_16px_rgba(30,41,59,0.12)] transition-colors hover:bg-surface-card-selected md:hidden"
				>
					<svg
						viewBox="0 0 24 24"
						class="size-5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
					>
						<path d="M4 7h16M4 12h16M4 17h16" />
					</svg>
				</button>
			{/if}
		</div>
	</div>
</main>
