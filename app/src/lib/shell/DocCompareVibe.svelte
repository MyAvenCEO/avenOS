<script lang="ts">
import { createDocCompareShell, type DocType, isDocType, mapDocView } from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'

// Side-by-side document compare vibe (board 0064): original doc preview on the left, the extracted
// structured fields (mapped to the generic doc-view) on the right. Ephemeral — data comes from the
// classify→extract chat loop. The extracted JSON is also persisted in AvenDB server-side.
let {
	containerName = 'aven-vibes-doc-compare',
	data
}: {
	containerName?: string
	data?: Record<string, unknown>
} = $props()

const type = $derived<DocType>(isDocType(data?.type) ? (data?.type as DocType) : 'invoice')
const extracted = $derived(data?.extracted ?? {})
const fileUrl = $derived(typeof data?.fileUrl === 'string' ? (data?.fileUrl as string) : '')

// A stable shell (the view/style/logic never change); the live source is the mapped DocView.
const shell = createDocCompareShell('invoice', {})
const view = $derived(mapDocView(type, extracted) as unknown as Record<string, unknown>)
</script>

<div class="grid min-h-[320px] w-full grid-cols-1 gap-3 md:grid-cols-2">
	<div
		class="border-border bg-card flex min-h-[220px] items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border"
	>
		{#if fileUrl}
			<img src={fileUrl} alt="" class="h-full w-full object-contain">
		{:else}
			<span class="text-muted-foreground p-8 text-center text-sm">Keine Vorschau verfügbar.</span>
		{/if}
	</div>
	<div class="border-border max-h-[80vh] overflow-y-auto rounded-[var(--radius-lg)] border p-3">
		<AvenVibeView {shell} source={view} onEvent={() => {}} {containerName} desktopHint="Loading…" />
	</div>
</div>
