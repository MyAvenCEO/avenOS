<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, nestedRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
	const inner = nestedRecord(payload, 'payload')
	const body = readString(inner.message) ?? readString(inner.question) ?? readString(inner.summary)
</script>

<div class="space-y-2">
	<FocusPanel title="Sent message" prose={body} />
	<FocusPanel
		rows={[
			{ label: 'Type', value: readString(payload.envelopeType) },
			{ label: 'To', value: readString(payload.toActor) },
			{ label: 'Intent', value: readString(inner.intentId) },
			{ label: 'Status', value: readString(inner.status) }
		]}
	/>
</div>