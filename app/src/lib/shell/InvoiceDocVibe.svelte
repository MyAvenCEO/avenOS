<script lang="ts">
import { createDocCompareShell, type DocType, isDocType, mapDocView } from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'

// board 0096 — the EXTRACTED INVOICE alone: the structured extracted fields rendered through the generic
// doc-view engine, WITHOUT the side-by-side original-doc preview (that's DocCompareVibe). Used by the
// extract step's vibe card, where there's no doc preview (the bytes aren't kept) — just the data.
let {
	containerName = 'aven-vibes-invoice-doc',
	data
}: {
	containerName?: string
	data?: Record<string, unknown>
} = $props()

const type = $derived<DocType>(isDocType(data?.type) ? (data?.type as DocType) : 'invoice')
const extracted = $derived(data?.extracted ?? {})
const shell = createDocCompareShell('invoice', {})
const view = $derived(mapDocView(type, extracted) as unknown as Record<string, unknown>)
</script>

<div class="border-border mx-auto max-h-[80vh] w-full overflow-y-auto rounded-[var(--radius-lg)] border p-3">
	<AvenVibeView {shell} source={view} onEvent={() => {}} {containerName} desktopHint="Loading…" />
</div>
