<script lang="ts">
import { page } from '$app/state'
import { ensureComposerTauriShortcutBridge } from '$lib/intent-mock/composer-tauri-bridge'
import '../app.css'

let { children: pageContent } = $props()

$effect(() => {
	ensureComposerTauriShortcutBridge()
})

const path = $derived(page.url.pathname)
const intentsActive = $derived(path === '/')
const sandboxActive = $derived(path.startsWith('/sandbox'))
const docsActive = $derived(path.startsWith('/docs'))
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</svelte:head>

<div class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background">
	<header class="shrink-0 bg-background/90 px-4 pt-3 pb-2 backdrop-blur-sm sm:px-6">
		<div
			class="mx-auto grid w-full max-w-[min(100%,88rem)] grid-cols-3 items-center gap-x-2 gap-y-2"
		>
			<div class="min-w-0" aria-hidden="true"></div>

			<nav
				class="flex flex-wrap items-center justify-center justify-self-center gap-x-2 gap-y-1 text-[10px] font-bold tracking-wider uppercase"
				aria-label="App sections"
			>
				<a
					href="/"
					data-sveltekit-preload-data="hover"
					class="transition-opacity hover:opacity-80 {intentsActive ? 'opacity-95' : 'opacity-40'}"
					aria-current={intentsActive ? 'page' : undefined}
					>Intents</a
				>
				<span class="select-none opacity-25" aria-hidden="true">|</span>
				<a
					href="/sandbox"
					data-sveltekit-preload-data="hover"
					class="transition-opacity hover:opacity-80 {sandboxActive ? 'opacity-95' : 'opacity-40'}"
					aria-current={sandboxActive ? 'page' : undefined}
					>Sandbox</a
				>
				<span class="select-none opacity-25" aria-hidden="true">|</span>
				<a
					href="/docs"
					data-sveltekit-preload-data="hover"
					class="transition-opacity hover:opacity-80 {docsActive ? 'opacity-95' : 'opacity-40'}"
					aria-current={docsActive ? 'page' : undefined}
					>Docs</a
				>
			</nav>

			<div class="min-w-0 justify-self-end" aria-hidden="true"></div>
		</div>
	</header>
	<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		{@render pageContent()}
	</div>
</div>
