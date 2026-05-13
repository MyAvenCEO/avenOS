<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, nestedRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
	const inner = nestedRecord(payload, 'event')
</script>

<FocusPanel
	title="Actor event"
	rows={[
		{ label: 'Event type', value: readString(payload.eventType) },
		{ label: 'Actor', value: readString(inner.actorId) ?? event.actorId },
		{ label: 'Envelope', value: readString(inner.envelopeId) ?? event.envelopeId }
	]}
/>