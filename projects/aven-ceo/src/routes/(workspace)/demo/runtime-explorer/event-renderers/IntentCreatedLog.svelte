<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
</script>

<div class="space-y-2">
	<FocusPanel title="Intent goal" prose={readString(payload.goal)} />
	<FocusPanel rows={[{ label: 'Title', value: readString(payload.title) }, { label: 'Status', value: readString(payload.status) }, { label: 'Intent', value: readString(payload.intentId) }]} />
</div>