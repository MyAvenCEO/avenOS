<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
</script>

<FocusPanel title="Envelope completed" prose={`${readString(payload.actorId) ?? 'Actor'} finished ${readString(payload.envelopeType) ?? 'work'}`} rows={[{ label: 'Envelope', value: readString(payload.envelopeId) }, { label: 'Run', value: readString(payload.runId) }]} />