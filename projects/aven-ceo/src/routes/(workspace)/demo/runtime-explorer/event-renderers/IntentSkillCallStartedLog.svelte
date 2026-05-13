<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
</script>

<FocusPanel
	title="Skill request"
	prose={readString(payload.request)}
	rows={[
		{ label: 'Skill', value: readString(payload.skillId) },
		{ label: 'Call', value: readString(payload.callId) },
		{ label: 'Intent', value: readString(payload.intentId) }
	]}
/>