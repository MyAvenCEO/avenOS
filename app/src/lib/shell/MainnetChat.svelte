<script lang="ts">
import { tick } from 'svelte'
import { t } from '$lib/i18n'
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'

type ChatMessage = {
	id: number
	role: 'user' | 'assistant'
	text: string
}

let messages = $state<ChatMessage[]>([])
let nextId = 0
let scrollEl = $state<HTMLDivElement | null>(null)

function scrollToBottom(): void {
	void tick().then(() => {
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
	})
}

// Local echo mock — submitted messages append to an in-memory list (user bubble +
// a canned assistant reply). No backend, no persistence: mainnet currently renders
// only this mocked chat UI.
function handleSubmit(text: string, files: File[]): void {
	const trimmed = text.trim()
	const fileNote = files.length > 0 ? ` (${files.length} attachment(s))` : ''
	if (trimmed === '' && files.length === 0) return

	messages = [...messages, { id: nextId++, role: 'user', text: `${trimmed}${fileNote}` }]
	scrollToBottom()

	messages = [
		...messages,
		{ id: nextId++, role: 'assistant', text: t('mainnet.chat.mockReply') }
	]
	scrollToBottom()
}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background">
	<header
		class="shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-center"
	>
		<p class="text-primary text-[10px] font-bold tracking-[0.18em] uppercase">
			{t('mainnet.chat.tag')}
		</p>
		<h1 class="font-display text-lg font-medium tracking-tight">{t('mainnet.chat.title')}</h1>
	</header>

	<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto px-4">
		<div class="mx-auto flex w-full max-w-2xl flex-col gap-3 py-4">
			{#if messages.length === 0}
				<div class="text-muted-foreground py-16 text-center text-sm leading-relaxed">
					{t('mainnet.chat.empty')}
				</div>
			{/if}
			{#each messages as message (message.id)}
				<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
					<div
						class="max-w-[80%] rounded-[var(--radius-lg)] px-3.5 py-2 text-sm leading-relaxed {message.role ===
						'user'
							? 'bg-primary text-primary-foreground'
							: 'border-border bg-card text-foreground border'}"
					>
						{message.text}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
		<div class="mx-auto w-full max-w-2xl">
			<IntentComposer
				placeholder={t('mainnet.chat.placeholder')}
				enableAttachments={true}
				onSubmitMessage={handleSubmit}
			/>
		</div>
	</div>
</div>
