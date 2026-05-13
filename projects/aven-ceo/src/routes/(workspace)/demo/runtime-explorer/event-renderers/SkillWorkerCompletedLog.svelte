<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString, readNumber } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
	const result = payloadRecord(payload.result)
</script>

<FocusPanel title="Worker finished" prose={readNumber(result.count) != null ? `Produced ${result.count} result${result.count === 1 ? '' : 's'}` : null} rows={[{ label: 'Worker', value: readString(payload.workerId) }, { label: 'Call', value: readString(payload.callId) }, { label: 'Intent', value: readString(payload.intentId) }]} />