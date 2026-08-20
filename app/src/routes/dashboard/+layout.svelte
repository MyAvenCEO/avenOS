<script lang="ts">
import type { Snippet } from 'svelte'
import { SPARKS, todoActor } from '$lib/actors/todo.svelte'
import { talk } from '$lib/intents/talk.svelte'

/**
 * The dashboard shell: the spark rail on the left, the route's surface on the
 * right. A layout rather than page furniture so the rail — which spark
 * context everything operates in — stays put across the workspace and the
 * settings page alike. Clicking a spark and saying "zeig die Team-Liste"
 * write the same store.
 */
const { children }: { children: Snippet } = $props()
</script>

<div class="flex h-dvh">
	<aside class="flex w-16 shrink-0 flex-col items-center gap-3 border-border border-r py-4">
		<!-- The global chat context: MAIA sits above the sparks — talking is a
		     context like ME and TEAM are. -->
		<button
			type="button"
			onclick={() => {
				talk.open = true
			}}
			title="Talk to MAIA"
			aria-label="Talk to MAIA"
			class="relative flex size-11 items-center justify-center p-1 transition-all {talk.open
				? 'rounded-2xl bg-surface-card-selected ring-2 ring-primary/40'
				: 'rounded-full border border-border opacity-80 hover:rounded-2xl hover:opacity-100'}"
		>
			<img src="/aven-logo.svg" alt="" class="size-full rounded-full object-cover">
			{#if talk.open}
				<span class="-left-[13px] absolute h-6 w-1 rounded-full bg-primary"></span>
			{/if}
		</button>
		<!-- a quiet line between the chat context and the spark contexts -->
		<div class="h-px w-8 shrink-0 bg-border"></div>
		{#each SPARKS as spark (spark.id)}
			{@const active = todoActor.state.active === spark.id && !talk.open}
			<button
				type="button"
				onclick={() => {
					// The active spark is reducer state like any other — switch it
					// through the SHOW event, the same door the voice tool uses.
					// Picking a spark leaves the chat context.
					talk.open = false
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
		<a
			href="/dashboard/settings"
			title="Einstellungen"
			aria-label="Einstellungen"
			class="mt-auto flex size-11 items-center justify-center rounded-full border border-border bg-surface-card opacity-60 transition-all hover:rounded-2xl hover:opacity-100"
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
		</a>
	</aside>

	{@render children()}
</div>
