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
	| { kind: 'error' }
	| { kind: 'thinking' }
	| { kind: 'tool'; label: string }
	| { kind: 'result' }

// The single "latest" state, by priority: error → running tool → thinking → result → idle.
const live = $derived.by((): Live => {
	if (agent.err) return { kind: 'error' }
	const running = agent.toolBadges.find((b) => b.status === 'running')
	if (running) return { kind: 'tool', label: running.label }
	if (agent.busy || agent.phase !== 'idle') return { kind: 'thinking' }
	if (agent.lastReply) return { kind: 'result' }
	return { kind: 'idle' }
})
</script>

{#if live.kind !== 'idle'}
	<div
		class="pointer-events-auto mb-2 flex w-full max-w-md justify-center px-4"
		transition:fade={{ duration: 120 }}
	>
		{#if live.kind === 'error'}
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
				class="border-border/60 bg-card/95 text-foreground ring-primary/15 flex w-full flex-col gap-1 rounded-2xl border px-4 py-2.5 text-left shadow-lg ring-1 backdrop-blur transition hover:bg-card"
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
