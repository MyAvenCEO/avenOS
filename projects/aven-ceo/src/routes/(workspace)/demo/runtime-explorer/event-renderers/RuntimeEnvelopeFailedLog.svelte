<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
</script>

<div class="space-y-2">
	<FocusPanel title="Failure" prose={readString(payload.error)} />
	<FocusPanel rows={[{ label: 'Envelope', value: readString(payload.envelopeId) }, { label: 'Actor', value: readString(payload.actorId) }, { label: 'Status', value: readString(payload.status) }]} />
</div>