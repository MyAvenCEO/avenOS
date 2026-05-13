<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, nestedRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
	const inner = nestedRecord(payload, 'payload')
	const body = readString(inner.question) ?? readString(inner.message) ?? readString(inner.summary)
</script>

<div class="space-y-2">
	<FocusPanel title="Received message" prose={body} />
	<FocusPanel
		rows={[
			{ label: 'Type', value: readString(payload.envelopeType) },
			{ label: 'From', value: readString(payload.fromActor) },
			{ label: 'Intent', value: readString(inner.intentId) }
		]}
	/>
</div>