<script lang="ts">
	import { page } from '$app/state'
	import { deviceSession } from '$lib/self/device-session-store'
	import { provideSelfContext } from '$lib/self/self-context.svelte'

	let { children } = $props()

	const ctx = provideSelfContext()
	const sessionKind = $derived($deviceSession.kind)

	// Effect runs on mount and on every lock-state flip; re-pull peer status + derived keys.
	$effect(() => {
		void sessionKind
		void ctx.refresh()
	})

	const path = $derived(page.url.pathname)
	const tabs = [
		{ href: '/self', label: 'Peer IDs', match: (p: string) => p === '/self' || p === '/self/' },
		{
			href: '/self/sparks',
			label: 'Sparks',
			match: (p: string) => p.startsWith('/self/sparks'),
		},
		{
			href: '/self/network',
			label: 'Network',
			match: (p: string) => p.startsWith('/self/network'),
		},
		{
			href: '/self/db',
			label: 'DB',
			match: (p: string) => p.startsWith('/self/db'),
		},
	]

	const sessionLabel = $derived(
		sessionKind === 'unlocked' ? 'Unlocked' : sessionKind === 'dev_bypass' ? 'Dev bypass' : 'Locked',
	)
	const sessionDot = $derived(
		sessionKind === 'unlocked'
			? 'bg-emerald-500'
			: sessionKind === 'dev_bypass'
				? 'bg-amber-500'
				: 'bg-zinc-400',
	)
</script>

<div class="grid h-full min-h-0 w-full grid-cols-[14rem_1fr]">
	<aside
		class="flex min-h-0 flex-col border-r border-border/60 bg-card/20 px-3 py-6"
		aria-label="Self settings"
	>
		<div class="mb-4 px-3">
			<h2 class="text-sm font-semibold tracking-tight">Self</h2>
			<p class="text-muted-foreground text-[11px] leading-snug">Who you are on this Mac</p>
		</div>

		<nav class="flex flex-col gap-0.5">
			{#each tabs as tab (tab.href)}
				{@const active = tab.match(path)}
				<a
					href={tab.href}
					data-sveltekit-preload-data="hover"
					class="rounded-md px-3 py-1.5 text-[13px] transition-colors
						{active
						? 'bg-accent/15 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'}"
					aria-current={active ? 'page' : undefined}
				>
					{tab.label}
				</a>
			{/each}
		</nav>

		<div class="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-[11px]">
			<span class="inline-flex h-2 w-2 rounded-full {sessionDot}" aria-hidden="true"></span>
			<span class="text-muted-foreground">{sessionLabel}</span>
		</div>
	</aside>

	<main class="min-h-0 overflow-y-auto">
		<div class="mx-auto w-full max-w-3xl px-6 py-8 sm:px-8">
			{@render children()}
		</div>
	</main>
</div>
