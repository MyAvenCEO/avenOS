<script lang="ts">
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'

	let { event }: { event: ActorLogRecord } = $props()

	const payload = $derived(payloadRecord(event.payload))
	const kind = $derived(readString(payload.kind) ?? 'unknown')
	const key = $derived(readString(payload.key) ?? 'unknown')
	const summary = $derived(readString(payload.summary))
	const actorId = $derived(readString(payload.actorId))
	const callId = $derived(readString(payload.callId))
	const visibility = $derived(readString(payload.visibility) ?? 'worklog')
</script>

<div class="space-y-1 text-sm">
	<div class="font-medium">Context appended: {kind}/{key}</div>
	<div class="text-xs opacity-75">
		seq {payload.seq} · {visibility}
		{#if actorId} · actor {actorId}{/if}
		{#if callId} · call {callId}{/if}
	</div>
	{#if summary}
		<div class="text-xs opacity-85">{summary}</div>
	{/if}
</div>