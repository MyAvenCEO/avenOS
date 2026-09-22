<script lang="ts">
import type { ResponseFeedback } from '@avenos/chat-engine/response-feedback'
import { type Snippet, tick } from 'svelte'
import type { Turn } from './chat.svelte'
import { feedbackEditor, reloadFeedback, saveFeedback } from './feedback'

let { turn, intentId, children }: { turn: Turn; intentId: string; children?: Snippet } = $props()
let field: HTMLTextAreaElement | undefined = $state()
const editState = $derived(turn.feedbackEditor)
const vote = $derived(turn.feedback?.vote ?? null)
const unavailable = $derived(
	!turn.persisted || Boolean(editState?.saving) || Boolean(editState?.pending)
)

function editor() {
	return feedbackEditor(turn)
}

async function save(next: ResponseFeedback['vote'], reason = turn.feedback?.reason ?? '') {
	await saveFeedback(turn, intentId, next, reason)
}

async function editReason() {
	editor().draft = turn.feedback?.reason ?? ''
	await tick()
	field?.focus()
}

async function reload() {
	const edit = editor()
	if (edit.saving) return
	edit.saving = true
	try {
		await reloadFeedback(turn)
	} finally {
		edit.saving = false
	}
}
</script>

<div class="response-feedback" data-response-id={turn.id} aria-label="Response feedback">
	<div class="feedback-actions">
		{@render children?.()}
		{#each ['up', 'down'] as direction}
			<button
				type="button"
				class="vote"
				aria-label={direction === 'up' ? 'Helpful response' : 'Unhelpful response'}
				aria-pressed={vote === direction}
				title={!turn.persisted ? 'Available once this response is saved' : vote === direction ? 'Clear vote' : direction === 'up' ? 'Helpful' : 'Not helpful'}
				disabled={unavailable}
				onclick={() => void save(vote === direction ? null : direction as 'up' | 'down', editState?.draft ?? turn.feedback?.reason ?? '')}
			>
				<svg
					class:down={direction === 'down'}
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M7 10v11H3V10h4Zm0 0 5-8c3 0 3 3 2 7h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7" />
				</svg>
			</button>
		{/each}
		{#if vote && editState?.draft == null}
			<button class="reason-link" type="button" disabled={unavailable} onclick={editReason}>
				{turn.feedback?.reason ? 'Edit reason' : 'Add a reason'}
			</button>
		{/if}
		<span class="feedback-status" role="status"
			>{editState?.saving ? 'Saving…' : vote && !editState?.error ? turn.feedback?.inferredFrom ? 'Automatically detected · editable' : 'Saved' : ''}</span
		>
	</div>
	{#if editState?.draft != null}
		<form onsubmit={event => { event.preventDefault(); void save(vote, editState?.draft ?? '') }}>
			<textarea
				bind:this={field}
				aria-label="Reason for response feedback"
				placeholder="What worked, or what could be better? (optional)"
				maxlength="2000"
				rows="2"
				value={editState.draft}
				oninput={event => editor().draft = event.currentTarget.value}
				disabled={Boolean(editState.saving || editState.pending)}
			></textarea>
			<div class="reason-actions">
				<button type="submit" disabled={unavailable || !vote}>Save reason</button>
				<button
					type="button"
					disabled={Boolean(editState.saving)}
					onclick={() => editor().draft = null}
				>
					Cancel
				</button>
			</div>
		</form>
	{/if}
	{#if editState?.error}
		<div class="feedback-error" role="alert">
			<span>Couldn’t confirm the save: {editState.error}</span>
			<button type="button" disabled={editState.saving} onclick={() => void save(vote)}>
				Retry
			</button>
			<button type="button" disabled={editState.saving} onclick={() => void reload()}>
				Reload feedback
			</button>
		</div>
	{/if}
</div>

<style>
.response-feedback {
	max-width: min(100%, 36rem);
	margin: 0.35rem 0 0.65rem;
	color: var(--color-foreground);
	font-size: 0.75rem;
	white-space: normal;
}
.feedback-actions,
.reason-actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.25rem;
}
button {
	font: inherit;
	color: inherit;
	background: transparent;
	border: 1px solid transparent;
	border-radius: 0.5rem;
	cursor: pointer;
	padding: 0.45rem 0.6rem;
}
button:hover:not(:disabled) {
	background: var(--color-surface-card);
	border-color: var(--color-border);
}
button:focus-visible,
textarea:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: 2px;
}
button:disabled {
	opacity: 0.45;
	cursor: default;
}
.vote {
	min-width: 34px;
	min-height: 34px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	opacity: 0.65;
}
.vote[aria-pressed="true"] {
	opacity: 1;
	background: var(--color-surface-card);
	border-color: var(--color-primary);
}
.down {
	transform: rotate(180deg);
}
.reason-link {
	text-decoration: underline;
	text-underline-offset: 0.2em;
}
.feedback-status {
	opacity: 0.6;
	padding-left: 0.3rem;
}
form {
	display: grid;
	gap: 0.35rem;
	margin-top: 0.4rem;
}
textarea {
	box-sizing: border-box;
	width: 100%;
	resize: vertical;
	min-height: 4rem;
	max-height: 10rem;
	padding: 0.65rem;
	border: 1px solid var(--color-border);
	border-radius: 0.65rem;
	color: inherit;
	background: var(--color-surface-raised);
	font: inherit;
	font-size: 0.85rem;
}
.reason-actions button:first-child {
	border-color: var(--color-border);
}
.feedback-error {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.25rem;
	color: var(--color-error-ink, #a13822);
}
.feedback-error span {
	flex-basis: 100%;
	overflow-wrap: anywhere;
}
@media (pointer: coarse) {
	.vote {
		min-width: 44px;
		min-height: 44px;
	}
}
</style>
