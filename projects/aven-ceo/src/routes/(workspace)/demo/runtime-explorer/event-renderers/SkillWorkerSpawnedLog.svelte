<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
</script>

<FocusPanel title="Worker spawned" prose={`${readString(payload.workerActorId) ?? 'Worker'} was spawned for ${readString(payload.skillId) ?? 'skill work'}`} rows={[{ label: 'Worker', value: readString(payload.workerName) ?? readString(payload.workerActorId) }]} />