<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
	const body = readString(payload.message) ?? readString(payload.question)
</script>

<div class="space-y-2">
	<FocusPanel title="User-facing message" prose={body} />
	<FocusPanel rows={[{ label: 'Kind', value: readString(payload.messageType) }, { label: 'Intent', value: readString(payload.intentId) }]} />
</div>