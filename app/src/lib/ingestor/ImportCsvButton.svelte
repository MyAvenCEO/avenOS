<script lang="ts">
import { t } from '$lib/i18n'
import { ordersFlow } from './orders-store.svelte'

let { compact = false }: { compact?: boolean } = $props()

async function onPick(event: Event): Promise<void> {
	const input = event.currentTarget as HTMLInputElement
	const file = input.files?.[0]
	if (!file) return
	await ordersFlow.runImport(file)
	input.value = ''
}
</script>

<label
	class="border-input bg-card/40 hover:bg-card/70 cursor-pointer rounded-lg border font-medium transition-colors {compact
		? 'px-3 py-1.5 text-xs'
		: 'px-3.5 py-2 text-sm'} {ordersFlow.importing ? 'pointer-events-none opacity-60' : ''}"
>
	{ordersFlow.importing ? t('avens.orders.importing') : t('avens.orders.import')}
	<input
		type="file"
		accept=".csv,text/csv,text/tab-separated-values"
		class="hidden"
		onchange={onPick}
	>
</label>
