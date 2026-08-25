<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ArtifactThumbnail from './ArtifactThumbnail.svelte'
import ArtifactViewer from './ArtifactViewer.svelte'
import { artifactsState } from './state.svelte'

interface LocalArtifact {
	fileName: string
	sizeBytes: number
	modifiedMs: number
}

let artifacts = $state<LocalArtifact[]>([])
let loading = $state(true)
let failure = $state<string | null>(null)
const selected = $derived(
	artifacts.find((artifact) => artifact.fileName === artifactsState.selected)
)

function prettyName(fileName: string): string {
	const stem = fileName.replace(/\.[^.]+$/, '')
	const invoice = stem.match(/^rechnung-(.+)$/)
	if (invoice) return `Rechnung ${invoice[1].replace(/^ord_/, '').slice(0, 8)}`
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
		artifacts = [
			{
				fileName: 'rechnung-ord_demo_2.pdf',
				sizeBytes: 48_213,
				modifiedMs: Date.parse('2026-08-14T09:12:00Z')
			}
		]
		loading = false
		return
	}
	try {
		artifacts = (await invoke<LocalArtifact[]>('artifacts_list')).toSorted(
			(left, right) => right.modifiedMs - left.modifiedMs
		)
		if (artifactsState.selected && !artifacts.some((a) => a.fileName === artifactsState.selected))
			artifactsState.selected = null
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		loading = false
	}
})
</script>

<div class="flex min-h-0 flex-1 gap-2">
	<div class="flex min-h-0 w-1/2 flex-col gap-3 overflow-y-auto pr-1">
		{#if loading}
			<p class="px-1 text-foreground/40 text-sm">Lokale Dateien werden geladen …</p>
		{:else if failure}
			<p class="px-1 text-error-strong text-sm">{failure}</p>
		{:else if artifacts.length === 0}
			<p class="px-1 text-foreground/40 text-sm">Keine lokalen Downloads.</p>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each artifacts as artifact (artifact.fileName)}
					<button
						type="button"
						onclick={() => (artifactsState.selected = artifact.fileName)}
						class="flex aspect-square flex-col overflow-hidden rounded-3xl border p-1 text-left transition-colors {artifactsState.selected === artifact.fileName ? 'border-primary bg-surface-cream' : 'border-border bg-surface-card hover:bg-surface-cream'}"
					>
						<div class="min-h-0 flex-1 overflow-hidden rounded-[1.25rem]">
							<ArtifactThumbnail fileName={artifact.fileName} />
						</div>
						<div class="flex flex-col gap-0.5 px-2.5 pt-2 pb-1.5">
							<div class="flex items-baseline justify-between gap-2">
								<span class="truncate font-semibold text-sm">{prettyName(artifact.fileName)}</span>
								<span class="rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]">
									{extOf(artifact.fileName)}
								</span>
							</div>
							<p class="text-foreground/50 text-xs">
								{sizeLabel(artifact.sizeBytes)}
								· {dateOf(artifact.modifiedMs)}
							</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>
	<div
		class="flex min-h-0 w-1/2 flex-col overflow-hidden rounded-3xl border border-border bg-surface-soft/60"
	>
		{#if selected}
			<div class="flex items-baseline justify-between gap-2 border-border border-b px-4 py-2.5">
				<h3 class="truncate font-medium text-sm">{prettyName(selected.fileName)}</h3>
				<span class="text-foreground/40 text-xs">{sizeLabel(selected.sizeBytes)}</span>
			</div>
			{#key selected.fileName}
				<ArtifactViewer fileName={selected.fileName} />
			{/key}
		{:else}
			<p class="m-auto text-foreground/40 text-sm">Wähle eine lokale Datei aus.</p>
		{/if}
	</div>
</div>
