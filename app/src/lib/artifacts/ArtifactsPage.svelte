<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ArtifactContentViewer from './ArtifactContentViewer.svelte'
import ArtifactSemanticViewer from './ArtifactSemanticViewer.svelte'
import { artifactBranchIds, artifactTreeRows, type BrowsedArtifact } from './artifact-tree'
import type { ArtifactEvidence, EvidenceResource } from './artifact-view'
import LocalArtifactsShelf from './LocalArtifactsShelf.svelte'
import { artifactTypeLabel } from './processing'
import { artifactsState } from './state.svelte'

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
const FIXTURE_CHILD_ID = '55555555-5555-4555-8555-555555555555'
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
let evidence = $state<ArtifactEvidence[]>([])
let evidenceLoading = $state(false)
let evidenceFailure = $state<string | null>(null)
let activeEvidence = $state<ArtifactEvidence | null>(null)
let sourceContent = $state<ArtifactContent | null>(null)
let sourceLoading = $state(false)
let sourceFailure = $state<string | null>(null)
let viewMode = $state<'view' | 'raw'>('view')
let collapsedIds = $state<Set<string>>(new Set())

const treeRows = $derived(artifactTreeRows(result?.artifacts ?? [], collapsedIds, query))
const branchCount = $derived(artifactBranchIds(result?.artifacts ?? []).size)
const selected = $derived(result?.artifacts.find((artifact) => artifact.artifactId === selectedId))
const envelopeJson = $derived(envelope ? JSON.stringify(envelope, null, 2) : '')

function toggleBranch(artifactId: string): void {
	const next = new Set(collapsedIds)
	if (next.has(artifactId)) next.delete(artifactId)
	else next.add(artifactId)
	collapsedIds = next
}

function collapseAll(): void {
	collapsedIds = artifactBranchIds(result?.artifacts ?? [])
}

function expandAll(): void {
	collapsedIds = new Set()
}

function outputLabel(output: unknown): string {
	if (!output || typeof output !== 'object') return '—'
	const binding = output as { role?: unknown; ordinal?: unknown }
	if (typeof binding.role !== 'string') return '—'
	return `${binding.role}:${typeof binding.ordinal === 'number' ? binding.ordinal : 0}`
}

function shortId(value: string | null): string {
	return value ? value.slice(0, 8) : '—'
}

async function refresh(): Promise<void> {
	loading = true
	failure = null
	try {
		if (isTauri()) {
			const loaded = await invoke<BrowseResult>('artifact_store_list')
			result = {
				...loaded,
				// Keep the client usable during a rolling API deployment from the
				// original flat browser response to the lineage-aware response.
				artifacts: loaded.artifacts.map((artifact) => ({
					...artifact,
					inputs: Array.isArray(artifact.inputs) ? artifact.inputs : []
				}))
			}
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
						inputs: [],
						publicationId: '22222222-2222-4222-8222-222222222222',
						scopeSequence: 1,
						publicationKind: 'roots',
						runId: null,
						committedAt: '2026-08-25T12:00:00Z'
					},
					{
						artifactId: FIXTURE_CHILD_ID,
						localKey: 'description',
						publicationOrdinal: 0,
						typeKey: 'core.content-description',
						typeVersion: 1,
						artifactSha256: 'fixture-child',
						producerRunId: '66666666-6666-4666-8666-666666666666',
						output: { role: 'description', ordinal: 0 },
						inputs: [{ role: 'source', ordinal: 0, artifactId: FIXTURE_ID }],
						publicationId: '77777777-7777-4777-8777-777777777777',
						scopeSequence: 2,
						publicationKind: 'run',
						runId: '66666666-6666-4666-8666-666666666666',
						committedAt: '2026-08-25T12:00:02Z'
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
	evidence = []
	evidenceFailure = null
	activeEvidence = null
	sourceContent = null
	sourceFailure = null
	viewMode = 'view'
	if (!artifactId) return
	envelopeLoading = true
	evidenceLoading = true
	envelopeFailure = null
	try {
		const [loaded, evidenceResource] = await Promise.all([
			isTauri()
				? invoke<Record<string, unknown>>('artifact_get', { artifactId })
				: Promise.resolve({
						artifactId,
						typeKey: 'core.file',
						typeVersion: 1,
						payload: {
							originalName: 'example.pdf',
							declaredMediaType: 'application/pdf',
							sourceKind: 'desktop-drop'
						},
						blob: { sha256: 'fixture', length: 1234 }
					}),
			isTauri()
				? invoke<EvidenceResource>('artifact_evidence_get', { artifactId }).catch((cause) => {
						if (selectedId === artifactId)
							evidenceFailure = cause instanceof Error ? cause.message : String(cause)
						return { artifactId, evidence: [] }
					})
				: Promise.resolve({ artifactId, evidence: [] })
		])
		if (selectedId === artifactId) {
			envelope = loaded
			evidence = Array.isArray(evidenceResource.evidence) ? evidenceResource.evidence : []
			if (loaded.blob) void loadContent(artifactId)
			const first = evidence[0]
			if (first) void chooseEvidence(first)
		}
	} catch (cause) {
		if (selectedId === artifactId) {
			envelopeFailure = cause instanceof Error ? cause.message : String(cause)
			evidenceFailure = cause instanceof Error ? cause.message : String(cause)
		}
	} finally {
		if (selectedId === artifactId) {
			envelopeLoading = false
			evidenceLoading = false
		}
	}
}

async function loadContent(artifactId: string): Promise<void> {
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

async function chooseEvidence(edge: ArtifactEvidence): Promise<void> {
	activeEvidence = edge
	const selectedArtifactId = selectedId
	const sourceArtifactId = edge.inputArtifactId
	sourceContent = null
	sourceLoading = true
	sourceFailure = null
	try {
		if (!isTauri()) throw new Error('Quellenvorschau ist in der Desktop-App verfügbar.')
		const loadedEnvelope = await invoke<Record<string, unknown>>('artifact_get', {
			artifactId: sourceArtifactId
		})
		const loadedContent = loadedEnvelope.blob
			? await invoke<ArtifactContent>('artifact_content_get', { artifactId: sourceArtifactId })
			: null
		if (selectedId === selectedArtifactId && activeEvidence?.ordinal === edge.ordinal) {
			sourceContent = loadedContent
		}
	} catch (cause) {
		if (selectedId === selectedArtifactId && activeEvidence?.ordinal === edge.ordinal) {
			sourceFailure = cause instanceof Error ? cause.message : String(cause)
		}
	} finally {
		if (selectedId === selectedArtifactId && activeEvidence?.ordinal === edge.ordinal) {
			sourceLoading = false
		}
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
		<div class="flex min-h-0 flex-1 flex-col gap-2 xl:flex-row">
			<section
				class="flex min-h-[20rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised xl:w-[62%]"
			>
				<div class="flex flex-wrap items-center gap-2 border-border border-b p-3">
					<input
						bind:value={query}
						placeholder="Typ, ID, Run, Input oder Local Key filtern"
						class="min-w-0 flex-1 rounded-xl border border-border bg-surface-soft px-3 py-2 text-xs outline-none focus:border-primary/50"
					>
					<div class="flex rounded-xl border border-border p-0.5 text-[0.625rem]">
						<button
							type="button"
							onclick={expandAll}
							class="rounded-lg px-2 py-1.5 text-foreground/55 hover:bg-surface-soft hover:text-foreground"
						>
							Alle öffnen
						</button>
						<button
							type="button"
							onclick={collapseAll}
							disabled={branchCount === 0}
							class="rounded-lg px-2 py-1.5 text-foreground/55 hover:bg-surface-soft hover:text-foreground disabled:opacity-35"
						>
							Zuklappen
						</button>
					</div>
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
				{:else if treeRows.length === 0}
					<p class="p-4 text-foreground/40 text-sm">Keine Artefakte gefunden.</p>
				{:else}
					<div class="min-h-0 flex-1 overflow-auto">
						<table
							aria-label="Artifact lineage"
							class="w-full min-w-[61rem] table-fixed text-left text-xs"
						>
							<colgroup>
								<col class="w-[17rem]">
								<col class="w-[13rem]">
								<col class="w-[8rem]">
								<col class="w-[8rem]">
								<col class="w-[5rem]">
								<col class="w-[5rem]">
								<col class="w-[10rem]">
								<col class="w-[7rem]">
							</colgroup>
							<thead
								class="sticky top-0 z-10 bg-surface-raised text-[0.5625rem] text-foreground/40 uppercase tracking-wide"
							>
								<tr class="border-border border-b">
									<th class="px-2 py-2.5 font-semibold">Artefakt</th>
									<th class="px-2 py-2.5 font-semibold">Typ</th>
									<th class="px-2 py-2.5 font-semibold">Local Key</th>
									<th class="px-2 py-2.5 font-semibold">Output</th>
									<th class="px-2 py-2.5 text-right font-semibold">Eltern</th>
									<th class="px-2 py-2.5 text-right font-semibold">Seq.</th>
									<th class="px-2 py-2.5 font-semibold">Committed</th>
									<th class="px-2 py-2.5 font-semibold">Run</th>
								</tr>
							</thead>
							<tbody>
								{#each treeRows as row (row.artifact.artifactId)}
									{@const artifact = row.artifact}
									<tr
										aria-level={row.depth + 1}
										aria-selected={selectedId === artifact.artifactId}
										class="border-border/70 border-b transition-colors {selectedId === artifact.artifactId ? 'bg-surface-card-selected' : 'hover:bg-surface-soft/70'}"
									>
										<td class="p-0">
											<div
												class="flex min-w-0 items-center"
												style:padding-left={`${row.depth * 16 + 6}px`}
											>
												{#if row.hasChildren}
													<button
														type="button"
														onclick={() => toggleBranch(artifact.artifactId)}
														aria-label={collapsedIds.has(artifact.artifactId) ? 'Zweig öffnen' : 'Zweig schließen'}
														aria-expanded={!collapsedIds.has(artifact.artifactId)}
														class="grid size-6 shrink-0 place-items-center rounded text-foreground/45 hover:bg-surface-soft hover:text-foreground"
													>
														<span
															class="transition-transform {collapsedIds.has(artifact.artifactId) ? '' : 'rotate-90'}"
															>›</span
														>
													</button>
												{:else}
													<span class="grid size-6 shrink-0 place-items-center text-foreground/20"
														>·</span
													>
												{/if}
												<button
													type="button"
													onclick={() => void selectArtifact(artifact.artifactId)}
													class="min-w-0 flex-1 py-2.5 pr-2 text-left"
													title={artifact.artifactId}
												>
													<span class="block truncate font-medium"
														>{artifactTypeLabel(artifact.typeKey)}</span
													>
													<span class="block truncate font-mono text-[0.5625rem] text-foreground/35"
														>{artifact.artifactId}</span
													>
												</button>
											</div>
										</td>
										<td
											class="truncate px-2 py-2 font-mono text-[0.625rem]"
											title={artifact.typeKey}
										>
											{artifact.typeKey}
											<span class="text-foreground/35">@{artifact.typeVersion}</span>
										</td>
										<td
											class="truncate px-2 py-2 font-mono text-[0.625rem] text-foreground/55"
											title={artifact.localKey}
										>
											{artifact.localKey}
										</td>
										<td class="truncate px-2 py-2 font-mono text-[0.625rem] text-foreground/55">
											{outputLabel(artifact.output)}
										</td>
										<td
											class="px-2 py-2 text-right font-mono text-[0.625rem]"
											title={artifact.inputs.map((input) => `${input.role}:${input.ordinal} → ${input.artifactId}`).join('\n')}
										>
											<span
												class={row.missingParentCount ? 'text-warning-ink' : 'text-foreground/55'}
											>
												{row.parentCount || '—'}
												{row.missingParentCount ? ` · ${row.missingParentCount}?` : ''}
											</span>
										</td>
										<td class="px-2 py-2 text-right font-mono text-[0.625rem] text-foreground/55">
											#{artifact.scopeSequence}
										</td>
										<td
											class="truncate px-2 py-2 text-[0.625rem] text-foreground/55"
											title={new Date(artifact.committedAt).toISOString()}
										>
											{new Date(artifact.committedAt).toLocaleString('de-DE')}
										</td>
										<td
											class="truncate px-2 py-2 font-mono text-[0.625rem] text-foreground/55"
											title={artifact.runId ?? 'Root publication'}
										>
											{shortId(artifact.runId)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
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
							{#if selected.inputs.length > 0}
								<span
									class="ml-auto rounded-md bg-surface-soft px-2 py-0.5 text-[0.625rem] text-foreground/50"
									title={selected.inputs.map((input) => `${input.role}:${input.ordinal} → ${input.artifactId}`).join('\n')}
								>
									{selected.inputs.length} {selected.inputs.length === 1 ? 'Input' : 'Inputs'}
								</span>
							{/if}
							<span
								class={selected.inputs.length ? 'text-foreground/40 text-xs' : 'ml-auto text-foreground/40 text-xs'}
								>#{selected.scopeSequence}</span
							>
						</div>
						<div class="mt-3 flex items-center gap-1">
							<button
								type="button"
								onclick={() => (viewMode = 'view')}
								class="rounded-lg px-2.5 py-1 text-xs {viewMode === 'view' ? 'bg-primary text-primary-foreground' : 'text-foreground/50 hover:bg-surface-soft'}"
							>
								Ansicht
							</button>
							<button
								type="button"
								onclick={() => (viewMode = 'raw')}
								class="rounded-lg px-2.5 py-1 text-xs {viewMode === 'raw' ? 'bg-primary text-primary-foreground' : 'text-foreground/50 hover:bg-surface-soft'}"
							>
								Raw
							</button>
							{#if evidenceLoading}
								<span class="ml-auto text-foreground/35 text-[0.625rem]"
									>Evidenz wird geladen …</span
								>
							{:else if evidence.length > 0}
								<span
									class="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 text-[0.625rem]"
									>▣ {evidence.length} Fundstellen</span
								>
							{/if}
						</div>
					</header>
					{#if envelopeLoading}
						<p class="p-4 text-foreground/40 text-sm">Envelope wird geladen …</p>
					{:else if envelopeFailure}
						<p class="p-4 text-error-strong text-sm">{envelopeFailure}</p>
					{:else if envelope}
						{#if viewMode === 'raw'}
							<div class="flex min-h-0 flex-1 flex-col">
								<div class="flex items-center justify-between border-border border-b px-4 py-2">
									<span
										class="font-semibold text-foreground/45 text-[0.625rem] uppercase tracking-wide"
										>Unverändertes Envelope</span
									><button
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
						{:else}
							<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
								<div
									class="flex min-h-[18rem] min-w-0 flex-1 flex-col {sourceContent || content || sourceLoading || contentLoading ? 'border-border lg:border-r' : ''}"
								>
									<ArtifactSemanticViewer
										typeKey={selected.typeKey}
										payload={envelope.payload}
										{evidence}
										{activeEvidence}
										onEvidence={(edge) => void chooseEvidence(edge)}
									/>
								</div>
								{#if sourceContent || content || sourceLoading || contentLoading || sourceFailure || contentFailure}
									<div class="flex min-h-[22rem] min-w-0 flex-1 flex-col bg-surface-soft/40">
										<div
											class="flex items-center justify-between border-border border-b bg-surface-raised px-4 py-2"
										>
											<div>
												<p
													class="font-semibold text-foreground/45 text-[0.625rem] uppercase tracking-wide"
												>
													{activeEvidence ? 'Belegquelle' : 'Vorschau'}
												</p>
												{#if activeEvidence}
													<p class="mt-0.5 font-mono text-foreground/35 text-[0.5625rem]">
														{activeEvidence.inputRole}:{activeEvidence.inputOrdinal}
														· {activeEvidence.inputArtifactId.slice(0, 8)}
													</p>
												{/if}
											</div>
											{#if activeEvidence?.outputLocator.kind === 'json-pointer'}
												<span
													class="rounded-md bg-amber-100 px-2 py-1 font-mono text-amber-800 text-[0.5625rem]"
													>{activeEvidence.outputLocator.pointer}</span
												>
											{/if}
										</div>
										{#if sourceLoading || (!sourceContent && contentLoading)}
											<p class="p-4 text-foreground/40 text-xs">Dokument wird gerendert …</p>
										{:else if sourceFailure || (!sourceContent && contentFailure)}
											<p class="p-4 text-error-strong text-xs">{sourceFailure ?? contentFailure}</p>
										{:else if sourceContent && activeEvidence}
											{#key `${activeEvidence.inputArtifactId}:${activeEvidence.ordinal}`}
												<ArtifactContentViewer
													{...sourceContent}
													locator={activeEvidence.inputLocator}
												/>
											{/key}
										{:else if content}
											{#key selected.artifactId}
												<ArtifactContentViewer {...content} />
											{/key}
										{/if}
									</div>
								{/if}
							</div>
							{#if evidenceFailure}
								<p class="border-border border-t px-4 py-2 text-warning-ink text-xs">
									Evidenz nicht verfügbar: {evidenceFailure}
								</p>
							{/if}
						{/if}
					{/if}
				{:else}
					<p class="m-auto text-foreground/40 text-sm">Wähle ein Artefakt aus.</p>
				{/if}
			</section>
		</div>
	{/if}
</div>
