<script lang="ts">
import { onMount } from 'svelte'
import {
	type AvenContextFull,
	type AvenContextPreview,
	type AvenContextSection,
	memoryToolBadgeClasses
} from '$lib/aven/context-preview'
import { renderVaultMarkdown } from '$lib/memory/markdown-view'
import { workspaceContentClass } from '$lib/workspace/layout'

type Msg = { role: 'user' | 'assistant'; content: string }

type StreamEvent =
	| { type: 'context'; preview: AvenContextPreview; fullContext: AvenContextFull }
	| { type: 'status'; detail: string }
	| { type: 'done'; reply: string; model: string }
	| { type: 'error'; message: string; status?: number }

let messages = $state<Msg[]>([])
let draft = $state('')
let error = $state<string | null>(null)
let busy = $state(false)
let statusDetail = $state<string | null>(null)
let contextPreview = $state<AvenContextPreview | null>(null)
let fullContext = $state<AvenContextFull | null>(null)
let bootingConversation = $state(true)

const origin =
	typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''

function anchorForSection(id: AvenContextSection['id']): string {
	const map: Record<AvenContextSection['id'], string> = {
		soul: 'ctx-soul',
		rules: 'ctx-rules',
		vault_snapshot: 'ctx-vault',
		vault_graph: 'ctx-graph',
		tools: 'ctx-tools',
		transcript: 'ctx-transcript'
	}
	return `#${map[id]}`
}

async function refreshContextFromServer() {
	const res = await fetch(`${origin}/api/aven/conversation`)
	const data: unknown = await res.json().catch(() => null)
	if (
		data !== null &&
		typeof data === 'object' &&
		'ok' in data &&
		(data as { ok?: boolean }).ok === true
	) {
		const d = data as {
			contextPreview?: AvenContextPreview
			fullContext?: AvenContextFull
		}
		if (d.contextPreview && typeof d.contextPreview === 'object') {
			contextPreview = d.contextPreview
		}
		if (d.fullContext && typeof d.fullContext === 'object') {
			fullContext = d.fullContext
		}
	}
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
				const d = data as {
					messages?: Msg[]
					contextPreview?: AvenContextPreview
					fullContext?: AvenContextFull
				}
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
				if (d.fullContext && typeof d.fullContext === 'object') {
					fullContext = d.fullContext
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
						fullContext = ev.fullContext
					} else if (ev.type === 'status') {
						statusDetail = ev.detail
					} else if (ev.type === 'done') {
						messages = [...next, { role: 'assistant', content: ev.reply }]
						streamGotDone = true
						statusDetail = null
						void refreshContextFromServer()
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
		class="flex w-full min-h-0 flex-1 flex-col gap-6 overflow-hidden lg:flex-row lg:items-stretch lg:gap-6"
	>
		<div class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
			<div class="mb-2 flex min-h-6 shrink-0 flex-col gap-0.5">
				<span class="tech-label opacity-35">Talk · request payload</span>
				<p class="text-[11px] leading-snug opacity-45">
					Everything below is what the server composes for the model on each roundtrip (system bundle +
					tool schemas + transcript).
				</p>
			</div>
			<div
				id="talk-context-scroll"
				class="min-h-0 flex-1 space-y-10 overflow-y-auto scroll-pb-40 pr-1 max-lg:min-h-[46vh] pb-36 sm:scroll-mt-2"
			>
				{#if bootingConversation}
					<p class="text-sm opacity-35 leading-relaxed">Loading conversation and context…</p>
				{:else if !fullContext}
					<p class="text-sm opacity-35 leading-relaxed">Send a message to build context.</p>
				{:else}
					<section
						id="ctx-soul"
						class="scroll-mt-20 rounded-2xl border border-border/70 bg-white/10 p-4 sm:p-5"
						aria-labelledby="ctx-soul-h"
					>
						<h2
							id="ctx-soul-h"
							class="tech-label mb-3 block border-b border-border/35 pb-2 normal-case !text-[11px]"
						>
							{contextPreview?.sections.find((s) => s.id === 'soul')?.heading ?? 'SOUL.md'}
						</h2>
						<div
							class="memory-prose max-h-[min(70vh,32rem)] overflow-x-hidden overflow-y-auto text-sm leading-relaxed [&_table]:text-[11px] sm:[&_table]:text-sm"
							role="region"
							aria-label="SOUL rendered"
						>
							{#if !fullContext.soulMarkdown.trim()}
								<p class="text-xs opacity-35">Empty</p>
							{:else}
								{@html renderVaultMarkdown(fullContext.soulMarkdown)}
							{/if}
						</div>
					</section>

					<section
						id="ctx-rules"
						class="scroll-mt-20 rounded-2xl border border-border/70 bg-white/10 p-4 sm:p-5"
						aria-labelledby="ctx-rules-h"
					>
						<h2
							id="ctx-rules-h"
							class="tech-label mb-3 block border-b border-border/35 pb-2 normal-case !text-[11px]"
						>
							{contextPreview?.sections.find((s) => s.id === 'rules')?.heading ?? 'RULES.md'}
						</h2>
						<div
							class="memory-prose max-h-[min(70vh,32rem)] overflow-x-hidden overflow-y-auto text-sm leading-relaxed [&_table]:text-[11px] sm:[&_table]:text-sm"
							role="region"
							aria-label="RULES rendered"
						>
							{#if !fullContext.rulesMarkdown.trim()}
								<p class="text-xs opacity-35">Empty</p>
							{:else}
								{@html renderVaultMarkdown(fullContext.rulesMarkdown)}
							{/if}
						</div>
					</section>

					<section
						id="ctx-vault"
						class="scroll-mt-20 rounded-2xl border border-border/70 bg-white/10 p-4 sm:p-5"
						aria-labelledby="ctx-vault-h"
					>
						<h2
							id="ctx-vault-h"
							class="tech-label mb-3 block border-b border-border/35 pb-2 normal-case !text-[11px]"
						>
							{contextPreview?.sections.find((s) => s.id === 'vault_snapshot')?.heading ??
								'Vault snapshot'}
						</h2>
						<div
							class="memory-prose max-h-[min(70vh,32rem)] overflow-x-hidden overflow-y-auto text-sm leading-relaxed [&_table]:text-[11px] sm:[&_table]:text-sm"
							role="region"
							aria-label="Vault snapshot rendered"
						>
							{#if !fullContext.vaultSnapshotMarkdown.trim()}
								<p class="text-xs opacity-35">Empty</p>
							{:else}
								{@html renderVaultMarkdown(fullContext.vaultSnapshotMarkdown)}
							{/if}
						</div>
					</section>

					<section
						id="ctx-graph"
						class="scroll-mt-20 rounded-2xl border border-border/70 bg-white/10 p-4 sm:p-5"
						aria-labelledby="ctx-graph-h"
					>
						<h2
							id="ctx-graph-h"
							class="tech-label mb-3 block border-b border-border/35 pb-2 normal-case !text-[11px]"
						>
							{contextPreview?.sections.find((s) => s.id === 'vault_graph')?.heading ??
								'Link graph'}
						</h2>
						<div
							class="memory-prose max-h-[min(52vh,24rem)] overflow-x-hidden overflow-y-auto text-sm leading-relaxed [&_table]:text-[11px] sm:[&_table]:text-sm"
							role="region"
							aria-label="Link graph summary rendered"
						>
							{#if !fullContext.vaultGraphMarkdown.trim()}
								<p class="text-xs opacity-35">Empty</p>
							{:else}
								{@html renderVaultMarkdown(fullContext.vaultGraphMarkdown)}
							{/if}
						</div>
					</section>

					<section
						id="ctx-tools"
						class="scroll-mt-20 rounded-2xl border border-border/70 bg-white/10 p-4 sm:p-5"
						aria-labelledby="ctx-tools-h"
					>
						<h2
							id="ctx-tools-h"
							class="tech-label mb-3 block border-b border-border/35 pb-2 normal-case !text-[11px]"
						>
							{contextPreview?.sections.find((s) => s.id === 'tools')?.heading ?? 'Tools (OpenAI JSON)'}
						</h2>
						<pre
							class="m-0 max-h-[min(70vh,32rem)] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-foreground/88 sm:text-[11px]"
						>{fullContext.toolsSchemaJson}</pre>
					</section>

					<section
						id="ctx-transcript"
						class="scroll-mt-20 rounded-2xl border border-border/70 bg-white/10 p-4 sm:p-5"
						aria-labelledby="ctx-transcript-h"
					>
						<h2
							id="ctx-transcript-h"
							class="tech-label mb-4 block border-b border-border/35 pb-2 normal-case !text-[11px]"
						>
							{contextPreview?.sections.find((s) => s.id === 'transcript')?.heading ?? 'Transcript'}
						</h2>
						{#if messages.length === 0}
							<p class="text-sm opacity-35">No messages yet.</p>
						{:else}
							<div class="space-y-4">
								{#each messages as m, i (i)}
									<div
										class="rounded-2xl border border-border/80 px-4 py-3 {m.role === 'user'
											? 'bg-white/25 ml-4 sm:ml-6'
											: 'bg-white/10 mr-4 sm:mr-6'}"
									>
										<div class="tech-label mb-2">{m.role === 'user' ? 'You' : 'Maia'}</div>
										<div
											class="memory-prose text-sm leading-relaxed text-balance [&_table]:text-[11px] sm:[&_table]:text-sm"
											role="article"
										>
											{#if !m.content.trim()}
												<p class="text-xs opacity-35">(empty)</p>
											{:else}
												{@html renderVaultMarkdown(m.content)}
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</section>
				{/if}
			</div>
		</div>

		<aside
			class="flex w-full shrink-0 flex-col overflow-hidden border-t border-border/40 pt-4 min-h-0 min-w-0 lg:w-52 lg:border-l lg:border-t-0 lg:pt-0 xl:w-56"
			aria-label="Jump to context section"
		>
			<div class="mb-2 shrink-0 lg:sticky lg:top-0 lg:z-10 lg:bg-background/85 lg:pb-2 lg:backdrop-blur-sm">
				<span class="tech-label block opacity-60">On this page</span>
				{#if contextPreview}
					<p class="mt-1 text-[10px] font-mono opacity-45">
						model · {contextPreview.model}
					</p>
					<p
						class="text-[9px] opacity-40"
						title="Rough char÷4 sum: system + transcript user/assistant text + tools JSON."
					>
						Σ ≈ ~{contextPreview.totalEstimatedTokens.toLocaleString()} tok
					</p>
				{/if}
			</div>
			<nav
				class="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto overscroll-contain pr-1 text-[11px] leading-snug lg:max-h-none"
			>
				{#if !contextPreview}
					<p class="text-[10px] opacity-40">Send a message to load outline.</p>
				{:else}
					<ul class="m-0 list-none space-y-1 p-0">
						{#each contextPreview.sections as block (block.id + block.heading)}
							<li>
								<a
									href={anchorForSection(block.id)}
									class="flex flex-col gap-0.5 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-border/50 hover:bg-white/10"
								>
									<span
										class="break-words font-mono text-[10px] font-semibold tracking-tight opacity-70"
										>{block.heading}</span
									>
									<span class="font-mono text-[9px] tabular-nums opacity-45"
										>~{block.estimatedTokens.toLocaleString()} tok</span
									>
									{#if block.id === 'transcript' && block.items.length > 0}
										<ul class="mt-1 space-y-1 border-l border-border/40 pl-2">
											{#each block.items as row (row.key)}
												<li class="text-[9px] opacity-55">
													<span class="font-mono">{row.key}</span>
													<span class="opacity-40"> · </span>
													<span class="uppercase">{row.role}</span>
												</li>
											{/each}
										</ul>
									{:else if block.id === 'tools'}
										<ul class="mt-1 flex flex-wrap gap-1">
											{#each block.toolNames as name (name)}
												<li
													class="rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-semibold leading-tight {memoryToolBadgeClasses(
														name
													)}"
												>
													{name}
												</li>
											{/each}
										</ul>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</nav>
		</aside>
	</main>

	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-background from-40% via-background/95 to-transparent px-6 pb-6 pt-10 sm:px-8"
	>
		<div class={`pointer-events-auto flex flex-col items-center ${workspaceContentClass}`}>
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
