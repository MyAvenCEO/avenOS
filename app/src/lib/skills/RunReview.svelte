<script lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { onMount, untrack } from 'svelte'
import { refreshStudio, type StudioArtifact, studioName } from './studio.svelte'

let {
	environmentId,
	subjectId,
	runId,
	reviewId,
	artifacts,
	inspect
}: {
	environmentId: string
	subjectId: string
	runId: string
	reviewId: string
	artifacts: StudioArtifact[]
	inspect: (id: string) => void
} = $props()
type Review = {
	id: string
	revision: number
	subjectDigest: string
	title: string
	expiresAt: string
	superseded: boolean
	eventVersion: number
	subject: { subjects?: Record<string, Array<{ artifactId: string }>>; [key: string]: unknown }
	decision: { id: string; outcome: 'approve' | 'deny' | 'postpone' } | null
}
let review = $state<Review | null>(null)
let busy = $state(false),
	error = $state(''),
	resumed = $state(false)
// Frozen at mount. Workspace switching destroys this keyed component; a late
// callback cannot choose the new customer as its destination.
const context = untrack(() => ({ environmentId, subjectId, runId, reviewId }))
let disposed = false
const send = <T>(action: string, command?: unknown) =>
	invoke<T>('actor_review_request', { ...context, action, command })
const sources = $derived([
	...new Set(
		Object.values(review?.subject.subjects ?? {})
			.flat()
			.map((s) => s.artifactId)
	)
])
const expired = $derived(review ? Date.parse(review.expiresAt) <= Date.now() : false)
const connection = $derived(connectionSummary(review?.subject))
function connectionSummary(subject: Review['subject'] | undefined) {
	if (!subject || !['http', 'imap'].includes(String(subject.protocol))) return null
	const object = (value: unknown): Record<string, unknown> =>
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {}
	const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 8192) : '')
	const request = object(subject.request),
		profile = object(object(subject.connection).profile)
	const limits = object(subject.limits),
		criteria = object(request.criteria),
		dates = object(criteria.internalDate)
	const detail =
		subject.protocol === 'http'
			? text(request.url)
			: [text(profile.host), text(request.mailbox)].filter(Boolean).join(' · ')
	const filters =
		subject.protocol === 'http'
			? ['No redirects']
			: [
					typeof request.uid === 'number' ? `Message ${request.uid}` : '',
					dates.since ? `From ${text(dates.since)}` : '',
					dates.before ? `Before ${text(dates.before)}` : '',
					criteria.fromContains ? `Sender: ${text(criteria.fromContains)}` : '',
					criteria.subjectContains ? `Subject: ${text(criteria.subjectContains)}` : '',
					criteria.seen === 'unseen' ? 'Unread only' : criteria.seen === 'seen' ? 'Read only' : ''
				].filter(Boolean)
	return {
		label: text(subject.credentialLabel),
		purpose: text(subject.purpose),
		detail,
		filters,
		operation:
			subject.protocol === 'http'
				? text(request.method)
				: request.uid
					? 'Read message'
					: 'Search mail',
		maxBytes:
			typeof limits.maximumBytes === 'number' ? `${Math.ceil(limits.maximumBytes / 1024)} KiB` : '',
		requestId: text(subject.requestOccurrenceId)
	}
}
async function load() {
	busy = true
	error = ''
	try {
		const value = await send<Review>('read')
		if (!disposed) review = value
	} catch {
		if (!disposed) error = 'Review unavailable. Try again.'
	} finally {
		if (!disposed) busy = false
	}
}
async function resume() {
	if (disposed) return
	await send('resume', { requestId: crypto.randomUUID() })
	if (disposed) return
	resumed = true
	await refreshStudio()
}
async function act(outcome?: 'approve' | 'deny' | 'postpone') {
	if (!review || busy || disposed) return
	busy = true
	error = ''
	try {
		if (outcome) {
			const value = await send<Review>('decide', {
				id: crypto.randomUUID(),
				revision: review.revision,
				subjectDigest: review.subjectDigest,
				expectedEventVersion: review.eventVersion,
				outcome
			})
			if (disposed) return
			review = value
		}
		if (review.decision?.outcome !== 'postpone') await resume()
	} catch {
		// Never assume a failed acknowledgement means the decision was not saved.
		if (!disposed) {
			await load()
			error = 'Check the saved decision below before continuing.'
		}
	} finally {
		if (!disposed) busy = false
	}
}
onMount(() => {
	void load()
	return () => {
		disposed = true
	}
})
</script>

<section class="review" aria-label="Review required" aria-busy={busy}>
	{#if review}
		<strong>{review.title}</strong>
		{#if connection}
			<div class="connection">
				<span><b>{connection.operation}</b> · {connection.label}</span>
				<span class="destination">{connection.detail}</span>
				{#if connection.filters.length}
					<small>{connection.filters.join(' · ')}</small>
				{/if}
				<small>Read only · up to {connection.maxBytes} · content saved in this workspace</small>
				<details>
					<summary>Request details</summary>
					<small>Purpose: {connection.purpose}</small>
					<button class="source" onclick={() => inspect(connection!.requestId)}>
						View exact request ↗
					</button>
				</details>
			</div>
		{/if}
		{#if sources.length}
			<div class="sources">
				{#each sources as id, index (id)}
					{@const artifact = artifacts.find(a => a.artifactId === id)}
					<button class="source" onclick={() => inspect(id)}>
						{artifact ? studioName(artifact) : `Document ${index + 1}`}
						↗
					</button>
				{/each}
			</div>
		{/if}
		{#if resumed}
			<small>Decision saved.</small>
		{:else if expired || review.superseded}
			<small>This review is no longer valid. Start a fresh run.</small>
		{:else if review.decision && review.decision.outcome !== 'postpone'}
			<small>{review.decision.outcome === 'approve' ? 'Approved' : 'Declined'} · saved</small>
			<button disabled={busy} onclick={() => void act()}>Continue</button>
		{:else}
			{#if review.decision?.outcome === 'postpone'}
				<small>Postponed</small>
			{/if}
			<div class="actions">
				<button disabled={busy} onclick={() => void act('approve')}>Approve</button>
				<button disabled={busy} onclick={() => void act('deny')}>Decline</button>
				<button disabled={busy} onclick={() => void act('postpone')}>Later</button>
			</div>
		{/if}
	{:else}
		<button disabled={busy} onclick={() => void load()}>
			{busy ? 'Loading review…' : 'Load review'}
		</button>
	{/if}
	{#if error}
		<small role="alert">{error}</small>
	{/if}
</section>

<style>
.review {
	display: grid;
	gap: 0.6rem;
	padding: 0.75rem;
	border: 1px solid #d8ddd6;
	border-radius: 0.75rem;
	margin-top: 0.6rem;
}
.sources,
.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}
.connection {
	display: grid;
	gap: 0.25rem;
	font-size: 0.85rem;
}
.destination {
	overflow-wrap: anywhere;
}
.connection details {
	font-size: 0.8rem;
}
.connection details[open] {
	display: grid;
	gap: 0.3rem;
}
button {
	font: inherit;
	font-size: 0.8rem;
	border: 1px solid #d8ddd6;
	border-radius: 0.5rem;
	padding: 0.35rem 0.6rem;
	background: transparent;
	color: inherit;
	cursor: pointer;
}
button:disabled {
	opacity: 0.5;
	cursor: default;
}
.source {
	max-width: 100%;
	overflow-wrap: anywhere;
	text-align: left;
}
small {
	color: #67717d;
}
</style>
