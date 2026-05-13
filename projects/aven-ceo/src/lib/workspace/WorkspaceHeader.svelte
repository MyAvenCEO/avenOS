<script lang="ts">
/**
 * Jazz profile UI is dewired. Re-enable: `(workspace)/+layout` `JazzSvelteProvider`,
 * `jazzSvelteKit` in `vite.config.ts`, and `.env` `PUBLIC_JAZZ_*`.
 */

import { page } from '$app/stores'
import { workspaceContentClass } from '$lib/workspace/layout'
</script>

<!--
ORIGINAL (Jazz) script — restore when rewiring:
import { getJazzContext } from 'jazz-tools/svelte'
import { app } from '$lib/schema'
const ctx = getJazzContext()
… loadProfile, syncDisplayName, logOut …
-->

<header
	class={`mb-3 sm:mb-4 grid grid-cols-3 items-center gap-x-2 gap-y-3 ${workspaceContentClass}`}
>
	<div class="min-w-0" aria-hidden="true"></div>

	<nav
		class="flex flex-wrap items-center justify-center justify-self-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-wider"
		aria-label="Workspace sections"
	>
		<a
			href="/me"
			class="uppercase opacity-40 transition-opacity hover:opacity-80 {$page.url.pathname === '/me'
				? 'opacity-95 underline underline-offset-4'
				: ''}"
			>Me</a
		>
		<span class="opacity-25 select-none" aria-hidden="true">|</span>
		<a
			href="/talk"
			class="uppercase opacity-40 transition-opacity hover:opacity-80 {$page.url.pathname === '/talk'
				? 'opacity-95 underline underline-offset-4'
				: ''}"
			>Talk</a
		>
		<span class="opacity-25 select-none" aria-hidden="true">|</span>
		<a
			href="/memory"
			class="uppercase opacity-40 transition-opacity hover:opacity-80 {$page.url.pathname === '/memory'
				? 'opacity-95 underline underline-offset-4'
				: ''}"
			>Brain</a
		>
		<span class="opacity-25 select-none" aria-hidden="true">|</span>
		<a
			href="/demo/runtime-explorer"
			class="uppercase opacity-40 transition-opacity hover:opacity-80 {$page.url.pathname === '/demo/runtime-explorer'
				? 'opacity-95 underline underline-offset-4'
				: ''}"
			>Demo</a
		>
	</nav>

	<div class="flex min-w-0 items-center justify-end justify-self-end gap-2 sm:gap-3">
		<span
			class="min-w-0 truncate text-right text-lg font-medium tracking-tight opacity-50 sm:text-xl"
			title="Jazz profile sync disabled (POC dewired)"
		>
			You
		</span>
	</div>
</header>
