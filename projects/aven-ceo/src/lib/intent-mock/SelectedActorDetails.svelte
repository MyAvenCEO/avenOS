<script lang="ts">
import { onMount } from 'svelte'

import type { DebugActorEvent, DebugActorSnapshot } from '../jaensen/types'

import { runtimeActorIdsForSelection, type InvolvedActorId } from './involved-actors-display'
import type { ActorDetailItem, IntentOrchestrator } from './types'

let {
	intent,
	selectedActorId
}: {
	intent: IntentOrchestrator | null
	selectedActorId: InvolvedActorId
} = $props()

let snapshot = $state<DebugActorSnapshot>({ actors: [] })
let details = $state<Record<string, ActorDetailItem[]>>({})

const runtimeActorIds = $derived.by(() => (intent ? runtimeActorIdsForSelection(intent, selectedActorId) : []))
const selectedItems = $derived.by(() => {
	const collected = runtimeActorIds.flatMap((actorId) => details[actorId] ?? [])
	return collected.sort((a, b) => a.id.localeCompare(b.id)).slice(-40).reverse()
})
const selectedSnapshotActors = $derived.by(() =>
	runtimeActorIds
		.map((actorId) => snapshot.actors.find((actor: DebugActorSnapshot['actors'][number]) => actor.id === actorId))
		.filter((actor): actor is NonNullable<typeof actor> => Boolean(actor))
)

onMount(() => {
	let source: EventSource | null = null
	void fetch('/api/aven/jaensen/debug/actors')
		.then((response) => response.json())
		.then((value: DebugActorSnapshot) => {
			snapshot = value
		})

	source = new EventSource('/api/aven/jaensen/debug/actors/events')
	for (const type of ['ActorSpawned', 'ActorStateChanged', 'MessageSent', 'ActorStopped', 'ActorTraceRecorded']) {
		source.addEventListener(type, (raw) => {
			const event = JSON.parse((raw as MessageEvent<string>).data) as DebugActorEvent
			applyDebugEvent(event)
		})
	}

	return () => source?.close()
})

function applyDebugEvent(event: DebugActorEvent) {
	if (event.type === 'ActorSpawned') {
		upsertActor(event.actor)
		appendDetail(event.actor.id, {
			id: `${event.type}:${event.actor.id}:${event.actor.lastEventAt}`,
			at: formatTime(event.actor.lastEventAt),
			kind: 'status',
			title: 'Actor spawned',
			detail: event.actor.type,
			meta: event.actor.id
		})
		return
	}

	if (event.type === 'ActorStateChanged') {
		updateActor(event.actorId, { status: event.status, currentTask: event.currentTask, lastEventAt: event.at })
		appendDetail(event.actorId, {
			id: `${event.type}:${event.actorId}:${event.at}`,
			at: formatTime(event.at),
			kind: 'status',
			title: `Status → ${event.status}`,
			detail: event.currentTask,
			meta: event.actorId
		})
		return
	}

	if (event.type === 'ActorStopped') {
		updateActor(event.actorId, { status: 'stopped', lastEventAt: event.at })
		appendDetail(event.actorId, {
			id: `${event.type}:${event.actorId}:${event.at}`,
			at: formatTime(event.at),
			kind: 'status',
			title: 'Actor stopped',
			meta: event.actorId
		})
		return
	}

	if (event.type === 'MessageSent') {
		appendDetail(event.from, {
			id: `${event.type}:from:${event.id}`,
			at: formatTime(event.at),
			kind: 'message',
			title: `Sent ${event.messageType}`,
			detail: `to ${event.to}`,
			meta: event.from
		})
		appendDetail(event.to, {
			id: `${event.type}:to:${event.id}`,
			at: formatTime(event.at),
			kind: 'message',
			title: `Received ${event.messageType}`,
			detail: `from ${event.from}`,
			meta: event.to
		})
		return
	}

	appendDetail(event.actorId, {
		id: `${event.type}:${event.actorId}:${event.trace.at}`,
		at: formatTime(event.trace.at),
		kind: event.trace.kind,
		title: labelForTrace(event.trace),
		detail: detailForTrace(event.trace),
		meta: metaForTrace(event.trace)
	})
}

function upsertActor(actor: DebugActorSnapshot['actors'][number]) {
	const next = snapshot.actors.filter((item) => item.id !== actor.id)
	snapshot = { actors: [...next, actor] }
}

function updateActor(actorId: string, patch: Partial<DebugActorSnapshot['actors'][number]>) {
	snapshot = {
		actors: snapshot.actors.map((actor: DebugActorSnapshot['actors'][number]) =>
			actor.id === actorId ? { ...actor, ...patch } : actor
		)
	}
}

function appendDetail(actorId: string, item: ActorDetailItem) {
	const current = details[actorId] ?? []
	details = {
		...details,
		[actorId]: [...current.filter((entry) => entry.id !== item.id), item].slice(-80)
	}
}

function formatTime(value?: string): string {
	if (!value) return '--:--'
	return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function labelForTrace(trace: Extract<DebugActorEvent, { type: 'ActorTraceRecorded' }>['trace']): string {
	if (trace.kind === 'shell') return `Shell · ${trace.command}`
	return `${trace.kind === 'prompt' ? 'Prompt' : 'Task'} · ${trace.label}`
}

function detailForTrace(trace: Extract<DebugActorEvent, { type: 'ActorTraceRecorded' }>['trace']): string | undefined {
	if (trace.kind === 'shell') {
		return [trace.stdout, trace.stderr].filter(Boolean).join('\n') || `exit ${trace.exitCode}`
	}
	return [trace.inputSummary, trace.outputSummary].filter(Boolean).join('\n→\n') || undefined
}

function metaForTrace(trace: Extract<DebugActorEvent, { type: 'ActorTraceRecorded' }>['trace']): string | undefined {
	if (trace.kind === 'shell') return trace.cwd ? `${trace.cwd} · exit ${trace.exitCode}` : `exit ${trace.exitCode}`
	return trace.kind === 'task' && trace.cwd ? trace.cwd : undefined
}
</script>

<section class="min-h-0 flex flex-1 flex-col">
	<div class="mb-1.5 flex items-center justify-between gap-2">
		<span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Skills</span>
		<span class="text-[9px] opacity-40">selected actor trace</span>
	</div>

	{#if !intent}
		<p class="py-3 text-[11px] opacity-40">Select an intent to inspect actor details.</p>
	{:else}
		<div class="mb-2 space-y-1 rounded-lg border border-border/40 bg-background/40 px-2.5 py-2">
			{#each selectedSnapshotActors as actor (actor.id)}
				<div>
					<p class="text-[11px] font-semibold leading-tight">{actor.name}</p>
					<p class="font-mono text-[9px] opacity-45">{actor.id}</p>
					<p class="mt-0.5 text-[10px] opacity-60">{actor.status} · mailbox {actor.mailboxDepth}{actor.currentTask ? ` · ${actor.currentTask}` : ''}</p>
				</div>
			{:else}
				<p class="text-[11px] opacity-45">No live runtime actor mapped for this selection yet.</p>
			{/each}
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
			{#if selectedItems.length === 0}
				<p class="py-3 text-[11px] opacity-40">No detailed runtime events yet.</p>
			{:else}
				<ol class="space-y-2">
					{#each selectedItems as item (item.id)}
						<li class="rounded-lg border border-border/35 bg-background/35 px-2.5 py-2">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="text-[10px] font-bold uppercase tracking-wide opacity-40">{item.kind}</p>
									<p class="text-[11px] font-semibold leading-snug break-words">{item.title}</p>
								</div>
								<span class="font-mono text-[9px] opacity-35">{item.at}</span>
							</div>
							{#if item.meta}
								<p class="mt-1 font-mono text-[9px] opacity-40 break-all">{item.meta}</p>
							{/if}
							{#if item.detail}
								<pre class="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed opacity-65">{item.detail}</pre>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</section>