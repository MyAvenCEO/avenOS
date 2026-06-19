<script lang="ts">
import { t } from '$lib/i18n'
import MainnetChat from '$lib/shell/MainnetChat.svelte'
import MainnetVibes from '$lib/shell/MainnetVibes.svelte'

// Mainnet (Alberobello) shell: a top-left Chat | Vibes nav switching between the AI chat
// and the JSON-vibe views (both backed by the betterauth backend). board 0054.
let tab = $state<'chat' | 'vibes'>('chat')
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background">
	<nav
		class="shrink-0 flex items-center gap-2 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-0.5 text-[10px] font-bold tracking-wider uppercase"
		aria-label="Mainnet sections"
	>
		<button
			type="button"
			class="transition-opacity hover:opacity-80 {tab === 'chat' ? 'opacity-95' : 'opacity-40'}"
			aria-current={tab === 'chat' ? 'page' : undefined}
			onclick={() => (tab = 'chat')}
		>
			{t('mainnet.nav.chat')}
		</button>
		<span class="select-none opacity-25" aria-hidden="true">|</span>
		<button
			type="button"
			class="transition-opacity hover:opacity-80 {tab === 'vibes' ? 'opacity-95' : 'opacity-40'}"
			aria-current={tab === 'vibes' ? 'page' : undefined}
			onclick={() => (tab = 'vibes')}
		>
			{t('mainnet.nav.vibes')}
		</button>
	</nav>

	{#if tab === 'chat'}
		<MainnetChat />
	{:else}
		<MainnetVibes />
	{/if}
</div>
