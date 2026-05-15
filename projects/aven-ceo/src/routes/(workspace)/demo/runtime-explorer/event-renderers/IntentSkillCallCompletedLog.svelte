<script lang="ts">
	import FocusPanel from './FocusPanel.svelte'
	import type { ActorLogRecord } from './types'
	import { payloadRecord, readString, readNumber } from './types'
	let { event }: { event: ActorLogRecord } = $props()
	const payload = payloadRecord(event.payload)
	const result = payloadRecord(payload.result)
	const invoices = Array.isArray(result.invoices) ? result.invoices : []
</script>

<div class="space-y-2">
	<FocusPanel title="Skill result" prose={readNumber(result.count) != null ? `Returned ${result.count} result${result.count === 1 ? '' : 's'}` : null} rows={[{ label: 'Skill', value: readString(payload.fromSkillId) }, { label: 'Worker', value: readString(payload.workerName) ?? readString(payload.workerActorId) }, { label: 'Call', value: readString(payload.callId) }]} />
	{#if invoices.length > 0}
		<FocusPanel title="Top results" rows={invoices.slice(0,3).map((invoice, i) => ({ label: `Invoice ${i+1}`, value: `${payloadRecord(invoice).entityId ?? 'unknown'} · ${payloadRecord(invoice).status ?? 'unknown'}` }))} />
	{/if}
</div>