<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString, readNumber } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
</script>

<FocusPanel title="Envelope claimed" prose={`${readString(payload.actorId) ?? 'Actor'} was claimed by ${readString(payload.workerId) ?? 'worker'}`} rows={[{ label: 'Envelope', value: readString(payload.envelopeId) }, { label: 'Attempts', value: readNumber(payload.attempts) != null ? String(payload.attempts) : null }]} />