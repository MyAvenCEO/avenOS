<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { nestedRecord, readString } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const trace = nestedRecord(event.payload, 'trace')
</script>

<FocusPanel
	title="Shell execution"
	rows={[
		{ label: 'Command', value: readString(trace.command) },
		{ label: 'Cwd', value: readString(trace.cwd) },
		{ label: 'Stdout', value: readString(trace.stdout) },
		{ label: 'Stderr', value: readString(trace.stderr) },
		{ label: 'Exit code', value: trace.exitCode != null ? String(trace.exitCode) : null }
	]}
/>