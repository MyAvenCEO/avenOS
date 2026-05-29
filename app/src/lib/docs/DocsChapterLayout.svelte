<script lang="ts">
	import type { Snippet } from 'svelte'
	import { navigateApp } from '$lib/shell'
	import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
	import type { AsideNavSection } from '$lib/ui/aside-nav'
	import { docsChapterContentClass } from './docs-chapter-nav'

	type Props = {
		/** Shown under the Documentation back link in the breadcrumb bar. */
		chapterTitle: string
		sections: AsideNavSection[]
		routeKey: string
		children: Snippet
	}

	let { chapterTitle, sections, routeKey, children }: Props = $props()
</script>

<div
	class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background font-sans text-foreground antialiased"
>
	<div class="border-border/60 shrink-0 border-b px-6 py-3 sm:px-10">
		<a
			href="/docs"
			data-sveltekit-preload-data="hover"
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase transition-colors"
			onclick={(e) => navigateApp('/docs', e)}
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
			{chapterTitle}
		</p>
	</div>

	<AsidePageLayout
		asideLabel="Chapters"
		{sections}
		muted
		routeKey={routeKey}
		desktopGridClass="md:grid-cols-[13rem_minmax(0,1fr)]"
		class="min-h-0 flex-1"
		mainClass="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:flex-none"
		contentClass="pb-16 md:pb-0"
		innerContentClass={docsChapterContentClass}
	>
		{#snippet children()}
			{@render children()}
		{/snippet}
	</AsidePageLayout>
</div>
