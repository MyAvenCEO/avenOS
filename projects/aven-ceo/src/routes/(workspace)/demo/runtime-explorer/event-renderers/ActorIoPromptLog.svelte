<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { nestedRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const trace = nestedRecord(event.payload, 'trace')
</script>

<div class="space-y-2">
	<FocusPanel
		title="Prompt input"
		prose={readString(trace.inputSummary)}
		rows={[
			{ label: 'Label', value: readString(trace.label) },
			{ label: 'At', value: readString(trace.at) }
		]}
	/>
	<FocusPanel title="Model output" prose={readString(trace.outputSummary)} />
</div>