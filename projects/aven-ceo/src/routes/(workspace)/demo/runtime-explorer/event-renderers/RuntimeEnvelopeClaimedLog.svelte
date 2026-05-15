<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString, readNumber } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
	const runtimeWorkerId = typeof payload['workerActorId'] === 'string' ? payload['workerActorId'] : null
</script>

<FocusPanel title="Envelope claimed" prose={`${readString(payload.actorId) ?? 'Actor'} was claimed by ${runtimeWorkerId ?? 'worker'}`} rows={[{ label: 'Envelope', value: readString(payload.envelopeId) }, { label: 'Runtime worker', value: runtimeWorkerId }, { label: 'Attempts', value: readNumber(payload.attempts) != null ? String(payload.attempts) : null }]} />