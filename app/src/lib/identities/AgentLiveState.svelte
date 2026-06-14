<!--
	One unified live-state indicator for the identity agent — sits just above the intent button on
	every sub-view and ALWAYS shows the single latest state, morphing in place between:
	  • thinking   — the cloud model is being called
	  • tool       — a tool call is running (e.g. "Updating todos…")
	  • result     — the turn's summary reply (prose) + a compact tool trace
	  • error      — a submit/transcription error (dismissable)
	Replaces the three separate floating chips (thinking pill, tool-badge strip, reply card).
-->
<script lang="ts">
import { fade } from 'svelte/transition'
import { t } from '$lib/i18n'
import type { IdentityAgent } from './identity-agent.svelte'

let { agent }: { agent: IdentityAgent } = $props()

type Live =
	| { kind: 'idle' }
	| { kind: 'confirm' }
	| { kind: 'error' }
	| { kind: 'thinking' }
	| { kind: 'tool'; label: string }
	| { kind: 'result' }

// The single "latest" state, by priority: HITL confirm → error → running tool → thinking →
// result → idle. A pending confirmation is the most important interactive state, so it wins.
const live = $derived.by((): Live => {
	if (agent.pendingConfirm) return { kind: 'confirm' }
	if (agent.err) return { kind: 'error' }
	const running = agent.toolBadges.find((b) => b.status === 'running')
	if (running) return { kind: 'tool', label: running.label }
	if (agent.busy || agent.phase !== 'idle') return { kind: 'thinking' }
	if (agent.lastReply) return { kind: 'result' }
	return { kind: 'idle' }
})

// Title line for the delete confirmation card.
const confirmTitles = $derived(agent.pendingConfirm?.titles ?? [])
// A generic sidecar human prompt (action === 'prompt') vs. the legacy todos-delete gate.
const promptCard = $derived(
	agent.pendingConfirm?.action === 'prompt' ? agent.pendingConfirm : undefined
)
</script>

{#if live.kind !== 'idle'}
	<div
		class="pointer-events-auto mb-2 flex w-full max-w-lg justify-center px-4"
		transition:fade={{ duration: 120 }}
	>
		{#if live.kind === 'confirm' && promptCard}
			<!-- Generic .NET sidecar human prompt (HITL). Same compact card location + destructive
			     styling option as the delete gate; answer/cancel go to the .NET runtime. -->
			<div
				class="bg-card/95 flex w-full flex-col gap-2.5 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur {promptCard.destructive
					? 'border-red-500/40 ring-1 ring-red-500/10'
					: 'border-border/60 ring-1 ring-primary/15'}"
			>
				<div class="min-w-0 flex-1">
					<p class="text-foreground text-sm font-semibold leading-snug">
						{promptCard.title ?? t('identities.talk.approvalNeeded')}
					</p>
					{#if promptCard.body?.trim()}
						<p class="text-muted-foreground mt-0.5 whitespace-pre-wrap text-xs leading-snug">
							{promptCard.body}
						</p>
					{/if}
				</div>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="border-border/70 text-foreground hover:bg-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold transition"
						onclick={() => agent.cancelPending()}
					>
						{t('identities.talk.promptReject')}
					</button>
					<button
						type="button"
						class="rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition {promptCard.destructive
							? 'bg-red-600 hover:bg-red-700'
							: 'bg-primary hover:bg-primary/90'}"
						onclick={() => agent.confirmPending()}
					>
						{t('identities.talk.promptAccept')}
					</button>
				</div>
			</div>
		{:else if live.kind === 'confirm'}
			<!-- HITL gate: the human must accept before a destructive (delete) action runs.
			     (Explicit red — this theme has no `destructive` color token.) -->
			<div
				class="bg-card/95 flex w-full flex-col gap-2.5 rounded-2xl border border-red-500/40 px-4 py-3 shadow-lg ring-1 ring-red-500/10 backdrop-blur"
			>
				<div class="flex items-start gap-2.5">
					<svg
						class="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-500"
						viewBox="0 0 16 16"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M6.5 1a1 1 0 0 0-1 1v.5H3a.75.75 0 0 0 0 1.5h.3l.6 8.2A2 2 0 0 0 5.9 15h4.2a2 2 0 0 0 2-1.8l.6-8.2h.3a.75.75 0 0 0 0-1.5h-2.5V2a1 1 0 0 0-1-1zm.5 4.25a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0zm3 0a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0zm-4.5 0a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0z"
						/>
					</svg>
					<div class="min-w-0 flex-1">
						<p class="text-foreground text-sm font-semibold leading-snug">
							{confirmTitles.length === 1
								? t('identities.talk.confirmDeleteOne', { title: confirmTitles[0] })
								: t('identities.talk.confirmDeleteMany', { count: confirmTitles.length })}
						</p>
						<p class="text-muted-foreground mt-0.5 text-xs leading-snug">
							{t('identities.talk.confirmDeletePrompt')}
						</p>
						{#if confirmTitles.length > 1}
							<ul class="text-muted-foreground mt-1.5 space-y-0.5 text-xs">
								{#each confirmTitles as title (title)}
									<li class="truncate">• {title}</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="border-border/70 text-foreground hover:bg-muted rounded-full border px-3.5 py-1.5 text-xs font-semibold transition"
						onclick={() => agent.cancelPending()}
					>
						{t('identities.talk.confirmReject')}
					</button>
					<button
						type="button"
						class="rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700"
						onclick={() => agent.confirmPending()}
					>
						{t('identities.talk.confirmAccept')}
					</button>
				</div>
			</div>
		{:else if live.kind === 'error'}
			<div
				role="alert"
				class="text-destructive border-destructive/40 bg-destructive/10 flex w-full items-start gap-2 rounded-2xl border px-4 py-2.5 text-sm leading-snug shadow-lg backdrop-blur"
			>
				<span class="min-w-0 flex-1">{agent.err}</span>
				<button
					type="button"
					class="hover:text-foreground -mr-1 shrink-0 px-1 font-semibold"
					onclick={() => agent.clearErr()}
					aria-label={t('identities.talk.dismissReply')}
				>
					×
				</button>
			</div>
		{:else if live.kind === 'thinking'}
			<div
				class="border-border/60 bg-card/95 text-muted-foreground flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-md backdrop-blur"
			>
				<span class="relative flex size-2">
					<span
						class="bg-primary/60 absolute inline-flex size-full animate-ping rounded-full"
					></span>
					<span class="bg-primary relative inline-flex size-2 rounded-full"></span>
				</span>
				{t('identities.talk.agentThinking')}
			</div>
		{:else if live.kind === 'tool'}
			<div
				class="border-primary/40 bg-card/95 text-foreground ring-primary/15 flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-md ring-1 backdrop-blur"
			>
				<svg
					class="text-primary size-3.5 shrink-0 animate-spin"
					viewBox="0 0 16 16"
					aria-hidden="true"
				>
					<circle
						cx="8"
						cy="8"
						r="6"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-opacity="0.25"
					/>
					<path
						d="M8 2a6 6 0 0 1 6 6"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
				<span class="max-w-[16rem] truncate">{live.label}</span>
			</div>
		{:else if agent.lastReply}
			{@const r = agent.lastReply}
			<button
				type="button"
				class="border-border/60 bg-card/95 text-foreground ring-primary/15 flex max-h-[50vh] w-full flex-col gap-1 overflow-y-auto rounded-2xl border px-4 py-2.5 text-left shadow-lg ring-1 backdrop-blur transition hover:bg-card"
				onclick={() => agent.dismissReply()}
				aria-label={t('identities.talk.dismissReply')}
			>
				{#if r.response?.trim()}
					<p class="text-sm leading-relaxed">{r.response}</p>
				{/if}
				<div class="text-muted-foreground/80 flex items-center gap-1.5 text-[11px]">
					<svg
						class="size-3 shrink-0 {r.ok
							? 'text-emerald-600 dark:text-emerald-500'
							: 'text-amber-600 dark:text-amber-500'}"
						viewBox="0 0 16 16"
						fill="currentColor"
						aria-hidden="true"
					>
						{#if r.ok}
							<path d="M6.4 11.3 3.2 8.1l1.1-1.1 2.1 2.1 5-5 1.1 1.1z" />
						{:else}
							<path d="M8 1.6 15.2 14H.8zm-.8 4.6v3.6h1.6V6.2zm0 4.8v1.6h1.6V11z" />
						{/if}
					</svg>
					<code class="font-mono font-semibold">{r.name}</code>
					{#if r.result}
						<span class="truncate {r.ok ? '' : 'text-amber-600 dark:text-amber-500'}"
							>· {r.result}</span
						>
					{/if}
				</div>
			</button>
		{/if}
	</div>
{/if}
