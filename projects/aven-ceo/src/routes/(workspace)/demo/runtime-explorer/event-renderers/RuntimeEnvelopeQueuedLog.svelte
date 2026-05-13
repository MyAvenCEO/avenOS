<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
</script>

<FocusPanel title="Envelope queued" prose={`${readString(payload.fromActor) ?? 'Unknown'} → ${readString(payload.toActor) ?? 'unknown'} · ${readString(payload.envelopeType) ?? 'message'}`} rows={[{ label: 'Envelope', value: readString(payload.envelopeId) }, { label: 'Correlation', value: readString(payload.correlationId) }]} />