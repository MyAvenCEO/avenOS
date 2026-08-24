<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ArtifactPreview from './ArtifactPreview.svelte'

/**
 * Artefakte — every locally stored artifact, as a responsive grid. For now
 * that is the downloaded invoice PDFs from the billing pane; later this
 * wires into the artifact store proper (intents' uploads, generated docs).
 * A tile opens the SAME inline blob-iframe preview the billing pane uses —
 * an in-page overlay, never a separate window.
 */

interface Artifact {
	fileName: string
	sizeBytes: number
	modifiedMs: number
}

let artifacts = $state<Artifact[]>([])
let loading = $state(true)
let failure = $state<string | null>(null)
let preview = $state<{ fileName: string; title: string } | null>(null)

/** "rechnung-<order_id>.pdf" → "Rechnung <order-short>"; anything else
 * keeps its stem as the label. */
function prettyName(fileName: string): string {
	const stem = fileName.replace(/\.[^.]+$/, '')
	const invoice = stem.match(/^rechnung-(.+)$/)
	if (invoice) return `Rechnung ${invoice[1].slice(0, 8)}`
	return stem
}

function extOf(fileName: string): string {
	const dot = fileName.lastIndexOf('.')
	return dot > 0 ? fileName.slice(dot + 1).toUpperCase() : 'DATEI'
}

function sizeLabel(bytes: number): string {
	if (bytes >= 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
	return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const dateOf = (ms: number) =>
	new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

onMount(async () => {
	if (!isTauri()) {
		loading = false
		return
	}
	try {
		const list = await invoke<Artifact[]>('artifacts_list')
		artifacts = list.toSorted((a, b) => b.modifiedMs - a.modifiedMs)
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		loading = false
	}
})
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
	<h2 class="px-1 font-semibold text-foreground/50 text-xs uppercase tracking-wide">Artefakte</h2>

	{#if loading}
		<p class="px-1 text-foreground/40 text-sm">Deine Artefakte werden geladen …</p>
	{:else if failure}
		<p class="px-1 text-error-strong text-sm">{failure}</p>
	{:else if artifacts.length === 0}
		<p class="px-1 text-foreground/40 text-sm">
			Noch keine Artefakte — deine Rechnungen und Dokumente landen hier.
		</p>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
			{#each artifacts as artifact (artifact.fileName)}
				<button
					type="button"
					onclick={() =>
						(preview = { fileName: artifact.fileName, title: prettyName(artifact.fileName) })}
					class="flex flex-col gap-2 rounded-2xl border border-border bg-surface-card p-4 text-left transition-colors hover:bg-surface-cream"
				>
					<div class="flex items-baseline justify-between gap-2">
						<span class="truncate font-semibold text-sm">{prettyName(artifact.fileName)}</span>
						<span
							class="shrink-0 rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]"
						>
							{extOf(artifact.fileName)}
						</span>
					</div>
					<p class="text-foreground/50 text-xs">
						{sizeLabel(artifact.sizeBytes)}
						· {dateOf(artifact.modifiedMs)}
					</p>
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if preview}
	<ArtifactPreview
		fileName={preview.fileName}
		title={preview.title}
		onclose={() => (preview = null)}
	/>
{/if}
