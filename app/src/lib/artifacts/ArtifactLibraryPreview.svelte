<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import { shell } from '$lib/intents/talk.svelte'
import { studio } from '$lib/skills/studio.svelte'
import ArtifactContentViewer from './ArtifactContentViewer.svelte'
import ArtifactSemanticViewer from './ArtifactSemanticViewer.svelte'
import type { ArtifactEvidence, EvidenceResource } from './artifact-view'
import type { LibraryRow } from './library'
import PdfContentViewer from './PdfContentViewer.svelte'

const representationLabels: Record<string, string> = {
	'bookkeeping.invoice-details': 'Rechnungsangaben',
	'bookkeeping.invoice-candidate': 'Rechnungskandidat',
	'banking.account-statement-candidate': 'Kontoauszug',
	'bookkeeping.invoice-validation': 'Rechnungsprüfung',
	'banking.statement-validation': 'Auszugsprüfung'
}

interface ArtifactContent {
	mediaType: string
	base64: string
}

let {
	row,
	initialArtifactId,
	onclose
}: {
	row: LibraryRow
	initialArtifactId: string
	onclose: () => void
} = $props()

const sourceId = $derived(row.source.artifactId)
let selectedId = $state('')
let envelope = $state<Record<string, unknown> | null>(null)
let evidence = $state<ArtifactEvidence[]>([])
let activeEvidence = $state<ArtifactEvidence | null>(null)
let sourceContent = $state<ArtifactContent | null>(null)
let sourceLoading = $state(false)
let sourceFailure = $state('')
let envelopeLoading = $state(false)
let envelopeFailure = $state('')
let alive = true
let selectionRevision = 0

const sourceLocator = $derived(
	activeEvidence?.inputArtifactId === sourceId ? activeEvidence.inputLocator : null
)

async function loadSource() {
	if (!isTauri()) return
	sourceLoading = true
	sourceFailure = ''
	try {
		const loaded = await invoke<ArtifactContent>('artifact_content_get', { artifactId: sourceId })
		if (alive) sourceContent = loaded
	} catch (error) {
		if (alive) sourceFailure = error instanceof Error ? error.message : String(error)
	} finally {
		if (alive) sourceLoading = false
	}
}

async function selectArtifact(artifactId: string) {
	const revision = ++selectionRevision
	selectedId = artifactId
	envelope = null
	evidence = []
	activeEvidence = null
	envelopeLoading = true
	envelopeFailure = ''
	try {
		const [loaded, resource] = await Promise.all([
			invoke<Record<string, unknown>>('artifact_get', { artifactId }),
			invoke<EvidenceResource>('artifact_evidence_get', { artifactId })
		])
		if (!alive || revision !== selectionRevision) return
		envelope = loaded
		evidence = resource.evidence ?? []
	} catch (error) {
		if (alive && revision === selectionRevision)
			envelopeFailure = error instanceof Error ? error.message : String(error)
	} finally {
		if (alive && revision === selectionRevision) envelopeLoading = false
	}
}

onMount(() => {
	selectedId = initialArtifactId
	void loadSource()
	if (isTauri()) void selectArtifact(initialArtifactId)
	return () => {
		alive = false
		selectionRevision++
	}
})
</script>

<div
	class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
>
	<header class="flex shrink-0 items-start justify-between gap-3 border-border border-b p-3">
		<div class="min-w-0">
			<strong class="block truncate text-sm" title={row.name}>{row.name}</strong>
			<p class="mt-1 font-mono text-[length:var(--fs-micro)] text-foreground/45">
				{sourceId.slice(0, 8)}
				· {row.mediaType}
			</p>
		</div>
		<button
			type="button"
			class="shrink-0 rounded border border-border px-2 py-1 text-xs"
			onclick={onclose}
			aria-label="Vorschau schließen"
		>
			Schließen
		</button>
	</header>
	<div class="flex shrink-0 flex-wrap items-center gap-2 border-border border-b p-3">
		<button
			type="button"
			aria-pressed={selectedId === sourceId}
			class="rounded-full border border-border px-2.5 py-1 text-xs {selectedId === sourceId ? 'bg-primary text-primary-foreground' : ''}"
			onclick={() => void selectArtifact(sourceId)}
		>
			Original
		</button>
		{#each row.representations.filter((artifact) => ['bookkeeping.invoice-details', 'bookkeeping.invoice-candidate', 'banking.account-statement-candidate', 'bookkeeping.invoice-validation', 'banking.statement-validation'].includes(artifact.typeKey)) as artifact (artifact.artifactId)}
			<button
				type="button"
				aria-pressed={selectedId === artifact.artifactId}
				class="rounded-full border border-border px-2.5 py-1 text-xs {selectedId === artifact.artifactId ? 'bg-primary text-primary-foreground' : ''}"
				onclick={() => void selectArtifact(artifact.artifactId)}
			>
				{representationLabels[artifact.typeKey]}
			</button>
		{/each}
		<button
			type="button"
			class="ml-auto rounded-full border border-border px-2.5 py-1 text-xs"
			onclick={() => { studio.requestedArtifactId = selectedId; shell.tab = 'skills' }}
		>
			Explore possibilities ↗
		</button>
	</div>
	<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
		{#if selectedId !== sourceId}
			<section
				class="flex min-h-[12rem] min-w-0 flex-1 flex-col overflow-auto border-border border-b lg:border-r lg:border-b-0"
				aria-label="Extrahierte Angaben"
			>
				{#if envelopeLoading}
					<p class="p-4 text-sm" role="status">Angaben werden geladen …</p>
				{/if}
				{#if envelopeFailure}
					<p class="p-4 text-error-ink text-sm" role="alert">{envelopeFailure}</p>
				{/if}
				{#if envelope}
					<ArtifactSemanticViewer
						typeKey={String(envelope.typeKey ?? row.artifactType)}
						payload={envelope.payload}
						{evidence}
						{activeEvidence}
						onEvidence={(edge) => activeEvidence = edge}
					/>
				{/if}
			</section>
		{/if}
		<section
			class="flex min-h-[12rem] min-w-0 flex-1 flex-col overflow-hidden bg-surface-sunken/25"
			aria-label="Quelldokument"
		>
			{#if sourceLoading}
				<p class="p-4 text-sm" role="status">Dokument wird geladen …</p>
			{/if}
			{#if sourceFailure}
				<p class="p-4 text-error-ink text-sm" role="alert">{sourceFailure}</p>
			{/if}
			{#if sourceContent}
				{#if sourceContent.mediaType === 'application/pdf'}
					<PdfContentViewer base64={sourceContent.base64} locator={sourceLocator} />
				{:else}
					<ArtifactContentViewer {...sourceContent} locator={sourceLocator} />
				{/if}
			{/if}
		</section>
	</div>
</div>
