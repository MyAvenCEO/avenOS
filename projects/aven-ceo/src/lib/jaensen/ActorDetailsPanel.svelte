<script lang="ts">
	import type { ActorDetailDto, ActorDetailTab, ContextItemDto, EnvelopeDto, EventRecord } from './types'

	let {
		tab,
		events = [],
		envelopes = [],
		contextItems = [],
		actorDetail = null
	}: {
		tab: ActorDetailTab
		events?: EventRecord[]
		envelopes?: EnvelopeDto[]
		contextItems?: ContextItemDto[]
		actorDetail?: ActorDetailDto | null
	} = $props()

	function pretty(value: unknown): string {
		return JSON.stringify(value, null, 2)
	}
</script>

<section class="min-h-0 flex-1 overflow-auto rounded-xl border border-border/40 bg-background/45 p-3 text-[11px]">
	{#if tab === 'log'}
		<div class="space-y-2">
			{#each events as event (event.seq)}
				<div class="rounded-lg border border-border/35 p-2">
					<div class="flex gap-2 text-[10px] opacity-65">
						<span>#{event.seq}</span><span>{event.visibility}</span><span>{event.type}</span><span>{event.actorId}</span><span>{event.createdAt}</span>
					</div>
					<pre class="mt-1 overflow-auto whitespace-pre-wrap break-words">{pretty(event.payload)}</pre>
				</div>
			{:else}
				<div class="opacity-45">No events.</div>
			{/each}
		</div>
	{:else if tab === 'messages'}
		<div class="space-y-2">
			{#each envelopes as envelope (envelope.id)}
				<div class="rounded-lg border border-border/35 p-2">
					<div class="flex flex-wrap gap-2 text-[10px] opacity-65">
						<span>{envelope.type}</span><span>{envelope.status}</span><span>{envelope.fromActor} → {envelope.toActor}</span><span>{envelope.runId}</span>
					</div>
					<pre class="mt-1 overflow-auto whitespace-pre-wrap break-words">{pretty(envelope.payload)}</pre>
				</div>
			{:else}
				<div class="opacity-45">No messages.</div>
			{/each}
		</div>
	{:else if tab === 'context'}
		<div class="space-y-2">
			{#each contextItems as item (item.seq)}
				<div class="rounded-lg border border-border/35 p-2">
					<div class="flex flex-wrap gap-2 text-[10px] opacity-65">
						<span>#{item.seq}</span><span>{item.kind}</span><span>{item.visibility}</span><span>{item.actorId}</span><span>{item.key}</span>
					</div>
					<div class="mt-1">{item.summary}</div>
					<pre class="mt-1 overflow-auto whitespace-pre-wrap break-words">{pretty(item.body)}</pre>
				</div>
			{:else}
				<div class="opacity-45">No context.</div>
			{/each}
		</div>
	{:else if tab === 'state'}
		<pre class="overflow-auto whitespace-pre-wrap break-words">{pretty(actorDetail?.state ?? null)}</pre>
	{:else if tab === 'config'}
		{#if actorDetail?.config !== undefined}
			<pre class="overflow-auto whitespace-pre-wrap break-words">{pretty(actorDetail.config)}</pre>
		{:else}
			<div class="opacity-45">No config available.</div>
		{/if}
	{/if}
</section>