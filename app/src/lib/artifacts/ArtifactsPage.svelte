<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ArtifactContentViewer from './ArtifactContentViewer.svelte'
import LocalArtifactsShelf from './LocalArtifactsShelf.svelte'
import { artifactTypeLabel } from './processing'
import { artifactsState } from './state.svelte'

interface BrowsedArtifact {
	artifactId: string
	localKey: string
	publicationOrdinal: number
	typeKey: string
	typeVersion: number
	artifactSha256: string
	producerRunId: string | null
	output: unknown
	publicationId: string
	scopeSequence: number
	publicationKind: string
	runId: string | null
	committedAt: string
}

interface BrowseResult {
	storeEpoch: string
	artifacts: BrowsedArtifact[]
	truncated: boolean
}

interface ArtifactContent {
	mediaType: string
	base64: string
}

const FIXTURE_ID = '33333333-3333-4333-8333-333333333333'
let mode = $state<'store' | 'local'>(artifactsState.selected ? 'local' : 'store')
let result = $state<BrowseResult | null>(null)
let loading = $state(true)
let failure = $state<string | null>(null)
let query = $state('')
let selectedId = $state<string | null>(null)
let envelope = $state<Record<string, unknown> | null>(null)
let envelopeLoading = $state(false)
let envelopeFailure = $state<string | null>(null)
let content = $state<ArtifactContent | null>(null)
let contentLoading = $state(false)
let contentFailure = $state<string | null>(null)

const filtered = $derived.by(() => {
	const needle = query.trim().toLowerCase()
	if (!needle) return result?.artifacts ?? []
	return (result?.artifacts ?? []).filter((artifact) =>
		[
			artifact.typeKey,
			artifact.artifactId,
			artifact.localKey,
			artifact.publicationId,
			artifact.runId ?? ''
		].some((value) => value.toLowerCase().includes(needle))
	)
})
const selected = $derived(result?.artifacts.find((artifact) => artifact.artifactId === selectedId))
const hasBlob = $derived(Boolean(envelope?.blob))
const envelopeJson = $derived(envelope ? JSON.stringify(envelope, null, 2) : '')

async function refresh(): Promise<void> {
	loading = true
	failure = null
	try {
		if (isTauri()) {
			result = await invoke<BrowseResult>('artifact_store_list')
		} else {
			result = {
				storeEpoch: 'browser-fixture',
				truncated: false,
				artifacts: [
					{
						artifactId: FIXTURE_ID,
						localKey: 'file',
						publicationOrdinal: 0,
						typeKey: 'core.file',
						typeVersion: 1,
						artifactSha256: 'fixture',
						producerRunId: null,
						output: null,
						publicationId: '22222222-2222-4222-8222-222222222222',
						scopeSequence: 1,
						publicationKind: 'roots',
						runId: null,
						committedAt: '2026-08-25T12:00:00Z'
					}
				]
			}
		}
		if (!selectedId || !result.artifacts.some((artifact) => artifact.artifactId === selectedId)) {
			await selectArtifact(result.artifacts[0]?.artifactId ?? null)
		}
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		loading = false
	}
}

async function selectArtifact(artifactId: string | null): Promise<void> {
	selectedId = artifactId
	envelope = null
	content = null
	contentFailure = null
	if (!artifactId) return
	envelopeLoading = true
	envelopeFailure = null
	try {
		const loaded = isTauri()
			? await invoke<Record<string, unknown>>('artifact_get', { artifactId })
			: {
					artifactId,
					typeKey: 'core.file',
					typeVersion: 1,
					payload: { originalName: 'example.pdf', sourceKind: 'desktop-drop' },
					blob: { sha256: 'fixture', length: 1234 }
				}
		if (selectedId === artifactId) envelope = loaded
	} catch (cause) {
		if (selectedId === artifactId)
			envelopeFailure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		if (selectedId === artifactId) envelopeLoading = false
	}
}

async function loadContent(): Promise<void> {
	if (!selectedId) return
	const artifactId = selectedId
	contentLoading = true
	contentFailure = null
	try {
		if (!isTauri()) throw new Error('Content preview is available in the desktop app.')
		const loaded = await invoke<ArtifactContent>('artifact_content_get', { artifactId })
		if (selectedId === artifactId) content = loaded
	} catch (cause) {
		if (selectedId === artifactId)
			contentFailure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		if (selectedId === artifactId) contentLoading = false
	}
}

async function copy(value: string): Promise<void> {
	await navigator.clipboard.writeText(value)
}

onMount(() => {
	void refresh()
})
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
	<header class="flex items-center gap-2 px-1">
		<div class="flex rounded-full border border-border p-0.5 text-xs">
			<button
				type="button"
				onclick={() => (mode = 'store')}
				class="rounded-full px-3 py-1 {mode === 'store' ? 'bg-primary text-primary-foreground' : 'text-foreground/55'}"
			>
				Artifact Store
			</button>
			<button
				type="button"
				onclick={() => (mode = 'local')}
				class="rounded-full px-3 py-1 {mode === 'local' ? 'bg-primary text-primary-foreground' : 'text-foreground/55'}"
			>
				Lokale Downloads
			</button>
		</div>
		{#if mode === 'store' && result}
			<span class="font-mono text-[0.625rem] text-foreground/40">
				{result.artifacts.length}
				Artefakte · Epoch {result.storeEpoch.slice(0, 8)}
			</span>
		{/if}
	</header>

	{#if mode === 'local'}
		<LocalArtifactsShelf />
	{:else}
		<div class="flex min-h-0 flex-1 gap-2">
			<section
				class="flex min-h-0 w-[42%] flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
			>
				<div class="flex items-center gap-2 border-border border-b p-3">
					<input
						bind:value={query}
						placeholder="Typ, ID, Run oder Local Key filtern"
						class="min-w-0 flex-1 rounded-xl border border-border bg-surface-soft px-3 py-2 text-xs outline-none focus:border-primary/50"
					>
					<button
						type="button"
						onclick={() => void refresh()}
						class="rounded-xl border border-border px-3 py-2 text-xs hover:bg-surface-soft"
					>
						Aktualisieren
					</button>
				</div>
				{#if loading}
					<p class="p-4 text-foreground/40 text-sm">Artifact Store wird gelesen …</p>
				{:else if failure}
					<p class="p-4 text-error-strong text-sm">{failure}</p>
				{:else if filtered.length === 0}
					<p class="p-4 text-foreground/40 text-sm">Keine Artefakte gefunden.</p>
				{:else}
					<ul class="min-h-0 flex-1 overflow-y-auto p-2">
						{#each filtered as artifact (artifact.artifactId)}
							<li>
								<button
									type="button"
									onclick={() => void selectArtifact(artifact.artifactId)}
									class="w-full rounded-xl border px-3 py-2.5 text-left transition-colors {selectedId === artifact.artifactId ? 'border-primary/30 bg-surface-card-selected' : 'border-transparent hover:bg-surface-soft'}"
								>
									<div class="flex items-baseline gap-2">
										<span class="min-w-0 flex-1 truncate font-medium text-xs">
											{artifactTypeLabel(artifact.typeKey)}
										</span>
										<span
											class="rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.5625rem]"
										>
											v{artifact.typeVersion}
										</span>
									</div>
									<p class="mt-0.5 truncate font-mono text-[0.625rem] text-foreground/45">
										{artifact.typeKey}
										· {artifact.localKey}
									</p>
									<div class="mt-1 flex gap-2 text-[0.625rem] text-foreground/35">
										<span>#{artifact.scopeSequence}</span>
										<span>{new Date(artifact.committedAt).toLocaleString('de-DE')}</span>
										<span class="ml-auto font-mono">{artifact.artifactId.slice(0, 8)}</span>
									</div>
								</button>
							</li>
						{/each}
					</ul>
					{#if result?.truncated}
						<p class="border-border border-t px-3 py-2 text-warning-ink text-xs">
							Ansicht auf die neuesten 2.000 Artefakte begrenzt.
						</p>
					{/if}
				{/if}
			</section>

			<section
				class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
			>
				{#if selected}
					<header class="border-border border-b px-4 py-3">
						<div class="flex items-baseline gap-2">
							<h2 class="min-w-0 flex-1 truncate font-semibold text-sm">{selected.typeKey}</h2>
							<span class="font-mono text-[0.625rem] text-foreground/40"
								>v{selected.typeVersion}</span
							>
						</div>
						<div class="mt-1 flex items-center gap-2">
							<button
								type="button"
								onclick={() => void copy(selected.artifactId)}
								class="truncate font-mono text-[0.625rem] text-foreground/45 hover:text-foreground"
								title="ID kopieren"
							>
								{selected.artifactId}
							</button>
							<span class="ml-auto text-foreground/40 text-xs">#{selected.scopeSequence}</span>
						</div>
					</header>
					{#if envelopeLoading}
						<p class="p-4 text-foreground/40 text-sm">Envelope wird geladen …</p>
					{:else if envelopeFailure}
						<p class="p-4 text-error-strong text-sm">{envelopeFailure}</p>
					{:else if envelope}
						<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
							<div class="flex min-h-0 flex-1 flex-col border-border lg:border-r">
								<div class="flex items-center justify-between border-border border-b px-4 py-2">
									<h3
										class="font-semibold text-foreground/45 text-[0.625rem] uppercase tracking-wide"
									>
										Envelope
									</h3>
									<button
										type="button"
										onclick={() => void copy(envelopeJson)}
										class="text-foreground/45 text-xs hover:text-foreground"
									>
										JSON kopieren
									</button>
								</div>
								<pre
									class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[0.6875rem] leading-relaxed"
								>{envelopeJson}</pre>
							</div>
							<div class="flex min-h-0 flex-1 flex-col">
								<div class="flex items-center justify-between border-border border-b px-4 py-2">
									<h3
										class="font-semibold text-foreground/45 text-[0.625rem] uppercase tracking-wide"
									>
										Content
									</h3>
									{#if hasBlob && !content}
										<button
											type="button"
											onclick={() => void loadContent()}
											class="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-soft"
										>
											Blob laden
										</button>
									{/if}
								</div>
								{#if contentLoading}
									<p class="p-4 text-foreground/40 text-xs">Inhalt wird geladen …</p>
								{:else if contentFailure}
									<p class="p-4 text-error-strong text-xs">{contentFailure}</p>
								{:else if content}
									{#key selected.artifactId}
										<ArtifactContentViewer {...content} />
									{/key}
								{:else if !hasBlob}
									<p class="p-4 text-foreground/40 text-xs">Dieses Artefakt hat keinen Blob.</p>
								{:else}
									<p class="p-4 text-foreground/40 text-xs">Blob-Vorschau bei Bedarf laden.</p>
								{/if}
							</div>
						</div>
					{/if}
				{:else}
					<p class="m-auto text-foreground/40 text-sm">Wähle ein Artefakt aus.</p>
				{/if}
			</section>
		</div>
	{/if}
</div>
