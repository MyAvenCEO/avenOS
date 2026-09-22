<script lang="ts">
import { tick } from 'svelte'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { composer } from '$lib/intents/composer.svelte'
import InputRouting from '$lib/intents/InputRouting.svelte'
import { intents } from '$lib/intents/intents.svelte'
import { followBottom } from './follow-bottom'
import MessageActions from './MessageActions.svelte'
import MessageBody from './MessageBody.svelte'
import ReplyContext from './ReplyContext.svelte'
import SourceContext from './SourceContext.svelte'
import ToolCalls from './ToolCalls.svelte'

let { voiceActive, onvoice }: { voiceActive: boolean; onvoice: () => void } = $props()
const chat = chatActor.core
let field: HTMLTextAreaElement | undefined = $state()
$effect(() => {
	void composer.focusTick
	if (composer.overlay) void tick().then(() => field?.focus())
})
function close() {
	composer.close()
	void tick().then(() =>
		document
			.querySelector<HTMLButtonElement>(
				'[aria-label="Open conversation"], [aria-label="Start conversation"]'
			)
			?.focus()
	)
}
function key(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		event.preventDefault()
		close()
	}
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault()
		composer.send()
	}
}
</script>

{#if composer.overlay}
	<section class="conversation" aria-label="Conversation with Aven">
		<header>
			<div>
				<strong>Aven</strong
				><span
					>To
					{intents.items.find(intent => intent.id === chat.session)?.title ?? 'New conversation'}</span
				>
			</div>
			<button aria-label="Close conversation" onclick={close}>×</button>
		</header>
		<div class="messages" role="log" aria-live="polite" use:followBottom={chat.session}>
			{#if !chat.turns.length && !chat.routing && !chat.preparingPrompt}
				<p class="welcome">What would you like to do with this?</p>
			{/if}
			{#each chat.turns as turn (turn.id)}
				{@const content = turn.pending ? chat.routingReply : turn.content}
				<ReplyContext inputs={turn.inReplyTo} />
				{#if turn.calls?.length || turn.startedAt !== undefined || turn.durationMs !== undefined}
					<ToolCalls
						calls={turn.calls ?? []}
						durationMs={turn.durationMs}
						modelRequests={turn.modelRequests}
						modelRequestCount={turn.modelRequestCount}
						startedAt={turn.startedAt}
						active={chat.streaming && turn.pending === true}
						modelActivity={chat.modelActivity}
						recovering={chat.recoveringStream}
					/>
				{/if}
				{#if content}
					<div class="message-turn">
						<div class:user={turn.role === 'user'} class="message">
							{#if turn.role === 'assistant'}
								<MessageBody text={content} />
							{:else}
								{turn.content}
							{/if}
						</div>
						{#if turn.role === 'user'}
							<SourceContext source={turn.inputAdmission?.sourceContext} />
						{/if}
						{#if turn.queued}
							<p role="status" class="welcome">Queued · follows the current response</p>
						{/if}
						{#if turn.deliveryError}
							<p role="alert" class="text-error">Not sent · {turn.deliveryError}</p>
						{/if}
						{#if !turn.pending}
							<MessageActions {turn} intentId={chat.session} />
						{/if}
					</div>
				{/if}
			{/each}

			{#if chat.failure}
				<p class="failure" role="alert">{chat.failure}</p>
			{/if}
		</div>
		{#if chat.streaming}
			<button
				class="thread-stop"
				aria-label="Stop response in this Intent"
				onclick={() => chat.stop()}
			>
				Stop this response
			</button>
		{/if}
		<form onsubmit={e => { e.preventDefault(); composer.send() }}>
			<InputRouting />
			<textarea
				bind:this={field}
				bind:value={composer.draft}
				onkeydown={key}
				aria-label="Message Aven"
				placeholder="Sprich — oder schreib…"
				rows="2"
			></textarea>
			<div class="controls">
				<button
					type="button"
					class:enabled={voiceActive}
					aria-pressed={voiceActive}
					aria-label={voiceActive ? 'Turn voice off' : 'Turn voice on'}
					onclick={onvoice}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.7"
						aria-hidden="true"
					>
						<rect x="9" y="3" width="6" height="12" rx="3" />
						<path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8" />
					</svg>
					Voice
				</button>

				<button
					class="send"
					type="submit"
					aria-label="Send message"
					disabled={!composer.draft.trim()}
				>
					↑
				</button>
			</div>
		</form>
	</section>
{/if}

<style>
.thread-stop {
	align-self: flex-start;
	margin: 0.5rem 1.25rem;
	font-size: 0.8rem;
	text-decoration: underline;
}
.conversation {
	position: fixed;
	z-index: 110;
	bottom: 100px;
	left: 50%;
	transform: translateX(-50%);
	width: min(600px, calc(100vw - 32px));
	max-height: calc(100dvh - 130px);
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-border);
	border-radius: 24px;
	background: var(--color-surface-raised, #fffdf8);
	color: var(--color-foreground, #233043);
	box-shadow: 0 16px 70px #172b4030;
	overflow: hidden;
}
header {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	border-bottom: 1px solid var(--color-border);
}
header div {
	display: grid;
	gap: 3px;
	min-width: 0;
}
header span {
	font-size: 12px;
	opacity: 0.65;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
button {
	border-radius: 50px;
	padding: 8px 12px;
	cursor: pointer;
}
button:hover {
	background: var(--color-surface-selected, #e8ece6);
}
button:focus-visible,
textarea:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: -2px;
}
.messages {
	overflow: auto;
	min-height: 0;
	flex: 1 1 auto;
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.message-turn {
	display: flex;
	flex-direction: column;
	flex: 0 0 auto;
	min-width: 0;
}
.message {
	align-self: flex-start;
	max-width: 92%;
	border: 1px solid var(--color-border);
	background: var(--color-surface-card, white);
	border-radius: 16px 16px 16px 4px;
	padding: 10px 14px;
	font-size: 14px;
	line-height: 1.6;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.message.user {
	align-self: flex-end;
	background: var(--color-primary, #233043);
	color: var(--color-primary-foreground, white);
	border-radius: 16px 16px 4px 16px;
}
.welcome {
	text-align: center;
	padding: 18px;
	opacity: 0.65;
}
.failure {
	color: var(--color-error-ink, #923b2a);
	font-size: 13px;
}
form {
	flex: 0 0 auto;
	border-top: 1px solid var(--color-border);
	padding: 12px;
}
textarea {
	width: 100%;
	resize: none;
	max-height: 160px;
	field-sizing: content;
	padding: 8px;
	background: transparent;
	font-size: 14px;
}
.controls {
	display: flex;
	gap: 8px;
	align-items: center;
	font-size: 12px;
}
.enabled {
	background: var(--color-surface-selected);
}
.send {
	margin-left: auto;
	width: 38px;
	height: 38px;
	background: var(--color-primary);
	color: var(--color-primary-foreground);
	font-size: 20px;
	padding: 0;
}
.send:disabled {
	opacity: 0.35;
	cursor: default;
}
</style>
