<script lang="ts">
	import { page } from '$app/state'
	import { founderDocs, developerDocs } from '$lib/docs/network-collection'

	let { children } = $props()

	const groups = [
		{ id: 'founders', label: 'Concepts', docs: founderDocs, base: '/docs/network/founders' },
		{ id: 'developers', label: 'Developers', docs: developerDocs, base: '/docs/network/developers' },
	] as const
</script>

<svelte:head>
	<title>My Network — documentation · AvenOS</title>
</svelte:head>

<div
	class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background font-sans text-foreground antialiased"
>
	<!-- Top breadcrumb bar -->
	<div class="border-border/60 shrink-0 border-b px-6 py-3 sm:px-10">
		<a
			href="/docs"
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase transition-colors"
		>
			<svg class="size-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M15 18l-6-6 6-6"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			Documentation
		</a>
		<p class="text-muted-foreground mt-1 text-xs font-bold tracking-widest uppercase">
			My Network
		</p>
	</div>

	<!-- Three-column area -->
	<div
		class="mx-auto flex min-h-0 w-full max-w-[min(100%,90rem)] flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:overflow-hidden lg:py-8"
	>
		<!-- Left sidebar -->
		<nav
			class="hidden w-52 shrink-0 flex-col gap-5 overflow-y-auto pr-4 lg:flex lg:min-h-0"
			aria-label="Chapters"
		>
			{#each groups as group (group.id)}
				<div>
					<p
						class="text-muted-foreground mb-1.5 px-2 text-[10px] font-bold tracking-widest uppercase"
					>
						{group.label}
					</p>
					<div class="flex flex-col gap-0.5">
						{#each group.docs as d (d.slug)}
							{@const href = `${group.base}/${d.slug}`}
							{@const active = page.url.pathname === href}
							<a
								{href}
								data-sveltekit-preload-data="hover"
								class="rounded-md px-2 py-1.5 text-sm leading-snug transition-colors {active
									? 'bg-accent/20 text-foreground font-medium'
									: 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'}"
								aria-current={active ? 'page' : undefined}
							>
								<span class="line-clamp-2">{d.title}</span>
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</nav>

		<!-- Mobile: accordion -->
		<div class="flex flex-col gap-3 lg:hidden">
			{#each groups as group (group.id)}
				<details class="border-border/60 rounded-lg border bg-card/30 p-3">
					<summary class="cursor-pointer text-sm font-medium">{group.label}</summary>
					<div class="mt-2 flex flex-col gap-1">
						{#each group.docs as d (d.slug)}
							<a
								href="{group.base}/{d.slug}"
								class="text-muted-foreground hover:text-foreground rounded px-2 py-1 text-sm"
							>
								{d.title}
							</a>
						{/each}
					</div>
				</details>
			{/each}
		</div>

		<!-- Main content -->
		<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:min-h-0">
			{@render children()}
		</div>
	</div>
</div>
