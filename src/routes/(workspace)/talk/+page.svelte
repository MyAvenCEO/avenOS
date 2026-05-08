<script lang="ts">
import { onMount } from 'svelte'
import {
	type AvenContextPreview,
	type AvenContextSection,
	memoryToolBadgeClasses
} from '$lib/aven/context-preview'
import { workspaceContentClass } from '$lib/workspace/layout'

type Msg = { role: 'user' | 'assistant'; content: string }

type StreamEvent =
	| { type: 'context'; preview: AvenContextPreview }
	| { type: 'status'; detail: string }
	| { type: 'done'; reply: string; model: string }
	| { type: 'error'; message: string; status?: number }

let messages = $state<Msg[]>([])
let draft = $state('')
let error = $state<string | null>(null)
let busy = $state(false)
let statusDetail = $state<string | null>(null)
/** Last LLM roundtrip scaffold (first completion call — before tool-result turns). */
let contextPreview = $state<AvenContextPreview | null>(null)
let bootingConversation = $state(true)

const origin =
	typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''

function sectionHasAsideBody(section: AvenContextSection): boolean {
	if (section.id === 'transcript') return section.items.length > 0
	if (section.id === 'tools') return section.toolNames.length > 0
	return section.bodyLines.length > 0
}

onMount(() => {
	void (async () => {
		try {
			const res = await fetch(`${origin}/api/aven/conversation`)
			const data: unknown = await res.json().catch(() => null)
			if (
				data !== null &&
				typeof data === 'object' &&
				'ok' in data &&
				(data as { ok?: boolean }).ok === true
			) {
				const d = data as { messages?: Msg[]; contextPreview?: AvenContextPreview }
				if (Array.isArray(d.messages)) {
					messages = d.messages.filter(
						(m) =>
							m &&
							typeof m === 'object' &&
							(m.role === 'user' || m.role === 'assistant') &&
							typeof m.content === 'string'
					) as Msg[]
				}
				if (d.contextPreview && typeof d.contextPreview === 'object') {
					contextPreview = d.contextPreview
				}
			}
		} finally {
			bootingConversation = false
		}
	})()
})

async function send() {
	const text = draft.trim()
	if (!text || busy || bootingConversation) return
	error = null
	const prev = messages
	const next: Msg[] = [...messages, { role: 'user', content: text }]
	messages = next
	draft = ''
	busy = true
	statusDetail = 'Maia · sending…'
	let streamGotDone = false
	try {
		const res = await fetch(`${origin}/api/aven/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messages: next, stream: true })
		})

		const ct = res.headers.get('content-type') ?? ''

		if (!res.ok || !res.body || !ct.includes('ndjson')) {
			const data: unknown = await res.json().catch(() => null)
			const msg =
				data !== null &&
				typeof data === 'object' &&
				'error' in data &&
				typeof (data as { error: unknown }).error === 'string'
					? (data as { error: string }).error
					: `Chat failed (${res.status})`
			throw new Error(msg)
		}

		const reader = res.body.getReader()
		const dec = new TextDecoder()
		let buf = ''

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buf += dec.decode(value, { stream: true })
			let nl = buf.indexOf('\n')
			while (nl !== -1) {
				const line = buf.slice(0, nl).trim()
				buf = buf.slice(nl + 1)
				if (line) {
					let ev: StreamEvent
					try {
						ev = JSON.parse(line) as StreamEvent
					} catch {
						continue
					}
					if (ev.type === 'context') {
						contextPreview = ev.preview
					} else if (ev.type === 'status') {
						statusDetail = ev.detail
					} else if (ev.type === 'done') {
						messages = [...next, { role: 'assistant', content: ev.reply }]
						streamGotDone = true
						statusDetail = null
					} else if (ev.type === 'error') {
						throw new Error(ev.message)
					}
				}
				nl = buf.indexOf('\n')
			}
		}

		if (!streamGotDone) {
			throw new Error('Stream ended without a reply.')
		}
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
		messages = prev
		statusDetail = null
	} finally {
		busy = false
	}
}
</script>

<svelte:head> <title>Talk — Aven Maia</title> </svelte:head>

<div class={`${workspaceContentClass} flex min-h-0 flex-1 flex-col overflow-hidden`}>
	{#if error}
		<div
			class={`${workspaceContentClass} mb-4 shrink-0 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error`}
			role="alert"
		>
			{error}
			<button type="button" class="ml-2 underline font-medium" onclick={() => (error = null)}>
				Dismiss
			</button>
		</div>
	{/if}

	<main
		class="flex w-full min-h-0 flex-1 flex-col gap-6 overflow-hidden lg:flex-row lg:items-stretch lg:gap-8"
	>
		<div class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
			<div class="mb-3 flex min-h-6 shrink-0 items-center" id="conversation-panel-label">
				<span class="tech-label opacity-35">Conversation</span>
			</div>
			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 max-lg:min-h-[42vh]">
				{#if bootingConversation}
					<p class="text-sm opacity-35 leading-relaxed">Loading conversation…</p>
				{:else if messages.length === 0}
					<p class="text-sm opacity-35 leading-relaxed">No messages yet.</p>
				{:else}
					{#each messages as m, i (i)}
						<div
							class="rounded-2xl border border-border/80 px-4 py-3 {m.role === 'user' ? 'bg-white/25 ml-6' : 'bg-white/10 mr-6'}"
						>
							<div class="tech-label mb-2">{m.role === 'user' ? 'You' : 'Maia'}</div>
							<pre
								class="whitespace-pre-wrap font-sans text-sm leading-relaxed text-balance"
							>{m.content}</pre>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<aside
			class="flex w-full shrink-0 flex-col overflow-hidden min-h-[min(44vh,24rem)] lg:min-h-0 lg:w-56 xl:w-[15.5rem]"
			aria-label="LLM request context"
		>
			<div class="mb-3 flex min-h-6 shrink-0 items-center">
				<span class="tech-label opacity-50">Context (this send)</span>
			</div>
			<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
				{#if !contextPreview}
					<div
						class="rounded-xl border border-dashed border-border/60 bg-white/5 px-3 py-4 text-[10px] opacity-40 leading-relaxed"
					>
						Send a message to load context.
					</div>
				{:else}
					<p class="text-[10px] font-mono opacity-50 mb-0.5">model · {contextPreview.model}</p>
					<p
						class="text-[9px] opacity-40 mb-2"
						title="Sum of estimated tokens: full system blob (SOUL + Maia prompt + vault snapshot) + transcript + tools JSON (chars ÷ 4 heuristic)"
					>
						Σ ≈ ~{contextPreview.totalEstimatedTokens.toLocaleString()}
						tok (rough)
					</p>
					{#each contextPreview.sections as block (block.id + block.heading)}
						<div class="rounded-xl border border-border/80 bg-white/15 px-3 py-2.5 shadow-sm/10">
							<div
								class={`flex flex-nowrap items-center justify-between gap-2 ${sectionHasAsideBody(block) ? 'mb-2 border-b border-dashed border-border/40 pb-2' : ''}`}
							>
								<span
									class="min-w-0 flex-1 break-words text-[9px] font-mono font-semibold leading-snug tracking-tight opacity-60"
									title={block.heading}
									>{block.heading}</span
								>
								<span
									class="shrink-0 whitespace-nowrap font-mono text-[9px] tabular-nums opacity-55"
									title="Rough estimate: characters ÷ 4. Actual model tokenizer (e.g. cl100k) will differ."
									>{`~${block.estimatedTokens.toLocaleString()}\u00A0tok`}</span
								>
							</div>
							{#if block.id === 'transcript'}
								<ul class="space-y-2 list-none m-0 p-0">
									{#each block.items as row (row.key)}
										<li class="text-[10px] leading-snug border-l-2 border-border/50 pl-2">
											<span class="font-mono font-semibold opacity-70">{row.key}</span>
											<span class="opacity-40"> · </span>
											<span class="uppercase text-[9px] opacity-50">{row.role}</span>
											<div class="opacity-70 mt-0.5 whitespace-pre-wrap break-words">
												{row.snippet}
											</div>
										</li>
									{/each}
								</ul>
							{:else if block.id === 'tools'}
								<div class="-mt-1 flex flex-col gap-1.5 pt-1">
									{#each block.toolNames as name (name)}
										<span
											class="flex w-full items-center justify-center rounded-full border px-2 py-1 font-mono text-[9px] font-semibold tracking-tight break-words text-center leading-snug {memoryToolBadgeClasses(name)}"
											>{name}</span
										>
									{/each}
								</div>
							{:else if sectionHasAsideBody(block)}
								<ul class="space-y-1.5 list-none m-0 p-0">
									{#each block.bodyLines as line (line)}
										<li class="text-[10px] leading-snug opacity-75 pl-0">{line}</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</aside>
	</main>

	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-background from-40% via-background/95 to-transparent px-6 pb-6 pt-10 sm:px-8"
	>
		<div
			class={`pointer-events-auto flex flex-col items-center ${workspaceContentClass}`}
		>
			{#if busy && statusDetail}
				<div
					class="mb-2 inline-flex w-fit max-w-full items-center justify-center rounded-full border border-tuscan-sun/45 bg-tuscan-sun/20 px-3 py-1.5 text-center text-[10px] font-semibold uppercase leading-snug tracking-wider text-foreground shadow-sm"
					role="status"
					aria-live="polite"
				>
					{statusDetail}
				</div>
			{/if}
			<section class="tech-pill w-full justify-between gap-4 py-3 px-4 sm:px-5">
				<div class="flex flex-1 min-w-0 items-center gap-3">
					<div
						class="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-white/20"
					>
						<svg
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
							/>
						</svg>
					</div>
					<form
						class="min-w-0 flex-1"
						onsubmit={(e) => {
							e.preventDefault()
							void send()
						}}
					>
						<input
							bind:value={draft}
							placeholder="Message Maia…"
							disabled={busy || bootingConversation}
							class="w-full min-w-0 border-none bg-transparent p-0 text-xl font-medium tracking-tight outline-none placeholder:opacity-20 focus:ring-0 disabled:opacity-40"
						>
					</form>
				</div>
				<div class="ml-1 flex shrink-0 items-center self-stretch border-l border-border pl-3">
					<span class="text-[10px] font-bold uppercase tracking-[0.2em] opacity-35">Maia</span>
				</div>
			</section>
		</div>
	</div>
</div>
