<script lang="ts">
import type { Snippet } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { SPARKS, todoActor } from '$lib/actors/todo.svelte'
import { shell } from '$lib/intents/talk.svelte'

/**
 * The dashboard shell: the spark rail on the left, the route's surface on the
 * right. A layout rather than page furniture so the rail — which spark
 * context everything operates in — stays put across the workspace and the
 * settings page alike. Clicking a spark and saying "zeig die Team-Liste"
 * write the same store.
 */
const { children }: { children: Snippet } = $props()

/**
 * Settings is a ROUTE while every other rail entry is a store flag, so for a
 * while it could not be switched away from: picking a spark rewrote the store
 * under a settings page that stayed mounted, and only the Back link escaped.
 * The rail is one exclusive group — whatever it opens, it closes the rest —
 * so leaving settings is part of pressing any other button, and the gear
 * itself toggles. That makes Back redundant; the page dropped it.
 */
const onSettings = $derived(page.url.pathname.startsWith('/dashboard/settings'))

/** Return to the workspace if a rail button was pressed while in settings. */
function leaveSettings() {
	if (onSettings) void goto('/dashboard')
}
</script>

<div class="flex h-dvh">
	<aside class="flex w-16 shrink-0 flex-col items-center gap-3 border-border border-r py-4">
		{#each SPARKS as spark (spark.id)}
			{@const active =
				todoActor.state.active === spark.id && !onSettings && shell.tab === 'intents'}
			<button
				type="button"
				onclick={() => {
					// The active spark is reducer state like any other — switch it
					// through the SHOW event, the same door the voice tool uses.
					// Picking a spark leaves settings.
					leaveSettings()
					shell.tab = 'intents'
					void todoActor.applyEvent({ send: 'SHOW', payload: { spark: spark.id } })
				}}
				title={spark.name}
				aria-label="Spark {spark.name}"
				class="relative flex size-11 items-center justify-center text-xs transition-all {active
					? 'rounded-2xl bg-primary text-primary-foreground'
					: 'rounded-full border border-border bg-surface-card opacity-70 hover:rounded-2xl hover:opacity-100'}"
			>
				{spark.id.slice(0, 2).toUpperCase()}
				{#if active}
					<span class="-left-[13px] absolute h-6 w-1 rounded-full bg-primary"></span>
				{/if}
			</button>
		{/each}

		<!-- The rail's foot: settings, below the contexts. The way "back" went
		     with the game — the dashboard is the root now; there is nothing
		     behind it. -->
		<!-- The skills platform lives in the rail too — a surface, not a tab. -->
		<button
			type="button"
			onclick={() => {
				// From settings, the gear's counterpart opens rather than toggles —
				// otherwise the first press would only walk back to the workspace.
				if (onSettings) {
					shell.tab = 'skills'
					void goto('/dashboard')
					return
				}
				shell.tab = shell.tab === 'skills' ? 'intents' : 'skills'
			}}
			title="Skills"
			aria-label="Skills"
			class="mt-auto flex size-11 items-center justify-center transition-all {shell.tab ===
				'skills' && !onSettings
				? 'rounded-2xl bg-primary text-primary-foreground'
				: 'rounded-full border border-border bg-surface-card opacity-60 hover:rounded-2xl hover:opacity-100'}"
		>
			<!-- three linked nodes: the flow canvas, in miniature -->
			<svg
				viewBox="0 0 24 24"
				class="size-4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="5" cy="12" r="2.5" />
				<circle cx="19" cy="6" r="2.5" />
				<circle cx="19" cy="18" r="2.5" />
				<path d="M7.2 10.8 16.8 7.2M7.2 13.2l9.6 3.6" />
			</svg>
		</button>
		<button
			type="button"
			onclick={() => {
				void goto(onSettings ? '/dashboard' : '/dashboard/settings')
			}}
			title="Einstellungen"
			aria-label="Einstellungen"
			class="relative flex size-11 items-center justify-center transition-all {onSettings
				? 'rounded-2xl bg-primary text-primary-foreground'
				: 'rounded-full border border-border bg-surface-card opacity-60 hover:rounded-2xl hover:opacity-100'}"
		>
			<!-- gear -->
			<svg
				viewBox="0 0 24 24"
				class="size-4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="12" r="3" />
				<path
					d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"
				/>
			</svg>
			{#if onSettings}
				<span class="-left-[13px] absolute h-6 w-1 rounded-full bg-primary"></span>
			{/if}
		</button>
	</aside>

	{@render children()}
</div>
