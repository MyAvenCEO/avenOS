<script lang="ts">
import type { ArtifactProcessingLookup } from '@avenos/artifact-store'
import { invoke } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ArtifactContentViewer from '$lib/artifacts/ArtifactContentViewer.svelte'
import ArtifactSemanticViewer from '$lib/artifacts/ArtifactSemanticViewer.svelte'
import type { ArtifactLocator, EvidenceResource } from '$lib/artifacts/artifact-view'
import { clientDocumentProcessingStatus } from '$lib/artifacts/client-document-processing'
import PdfContentViewer from '$lib/artifacts/PdfContentViewer.svelte'
import {
	documentArtifactGroups,
	documentArtifactLabel,
	documentArtifactPreview,
	pageSourceLocator
} from './document-artifacts'
import type { MockArtifact } from './intents.svelte'

let {
	source,
	artifacts,
	read = invoke,
	lookup = clientDocumentProcessingStatus
}: {
	source: MockArtifact
	artifacts: MockArtifact[]
	read?: typeof invoke
	lookup?: (artifactId: string) => ArtifactProcessingLookup | null
} = $props()
let tab = $state<'original' | 'details'>('original')
let discovered = $state<MockArtifact[]>([])
let payloads = $state<Record<string, Record<string, unknown>>>({})
let failures = $state<Record<string, string>>({})
let pending = $state<Set<string>>(new Set())
let limits = $state<Record<string, number>>({})
let expanded = $state<Set<string>>(new Set())
let selected = $state<MockArtifact | null>(null)
let derivedContent = $state<Record<string, { mediaType: string; base64: string }>>({})
let pageLocations = $state<Record<string, ArtifactLocator>>({})
let content = $state<{ mediaType: string; base64: string } | null>(null)
let contentFailure = $state(''),
	discoveryFailure = $state('')
let contentLoading = $state(false),
	discoveryLoading = $state(false)
let alive = true
const groups = $derived(documentArtifactGroups([...artifacts, ...discovered], source.artifactId!))
const count = $derived(groups.reduce((sum, group) => sum + group.items.length, 0))
const textSections = $derived(
	Boolean(content && (content.mediaType.startsWith('text/') || content.mediaType.includes('json')))
)
function selectedLabel(artifact: MockArtifact) {
	if (artifact.typeKey !== 'docs.page') return documentArtifactLabel(artifact.typeKey ?? '')
	const ordinal = payloads[artifact.artifactId!]?.sourcePage
	return `${textSections ? 'Textabschnitt' : 'Seite'}${typeof ordinal === 'number' ? ` ${ordinal}` : ''}`
}

async function loadPayload(artifact: MockArtifact) {
	const id = artifact.artifactId!
	if (pending.has(id) || payloads[id]) return
	pending = new Set([...pending, id])
	delete failures[id]
	try {
		const envelope = await read<{ payload: Record<string, unknown> }>('artifact_get', {
			artifactId: id
		})
		if (alive) payloads[id] = envelope.payload
	} catch (error) {
		if (alive) failures[id] = String(error)
	} finally {
		if (alive) pending = new Set([...pending].filter((key) => key !== id))
	}
}
async function reveal(type: string, more = true) {
	const items = groups.find((group) => group.typeKey === type)?.items ?? []
	limits[type] = more ? (limits[type] ?? 0) + 6 : (limits[type] ?? 6)
	await Promise.all(items.slice(0, limits[type]).map(loadPayload))
}
async function openDerived(artifact: MockArtifact) {
	selected = artifact
	if (!['docs.page', 'docs.extracted-text'].includes(artifact.typeKey ?? '')) return
	const id = artifact.artifactId!,
		key = `content:${id}`
	if (derivedContent[id] || pageLocations[id] || pending.has(key)) return
	pending = new Set([...pending, key])
	delete failures[key]
	try {
		if (artifact.typeKey === 'docs.page') {
			// Logical pages have no blob. Only a recorded source edge establishes
			// which bytes/page to show; never guess from the display ordinal.
			const evidence = await read<EvidenceResource>('artifact_evidence_get', { artifactId: id })
			const locator = pageSourceLocator(evidence, id, source.artifactId!)
			if (!locator)
				throw Error('Für diesen Abschnitt ist keine eindeutige Fundstelle im Original gespeichert.')
			if (!content) await loadOriginal()
			if (!content) throw Error('Das Original konnte nicht geladen werden. Bitte erneut versuchen.')
			if (alive) pageLocations[id] = locator
		} else {
			const value = await read<{ mediaType: string; base64: string }>('artifact_content_get', {
				artifactId: id
			})
			if (alive) derivedContent[id] = value
		}
	} catch (error) {
		if (alive) failures[key] = String(error)
	} finally {
		if (alive) pending = new Set([...pending].filter((item) => item !== key))
	}
}
async function discover() {
	discoveryLoading = true
	discoveryFailure = ''
	try {
		const result = lookup(source.artifactId!)
		if (alive)
			discovered = (result?.presentation?.derivedArtifacts ?? []).map((item) => ({
				...item,
				kind: 'doc',
				title: documentArtifactLabel(item.typeKey),
				note: '',
				sourceArtifactIds: [source.artifactId!]
			}))
		if (alive) await Promise.all([...expanded].map((type) => reveal(type, false)))
	} catch (error) {
		if (alive) discoveryFailure = String(error)
	} finally {
		if (alive) discoveryLoading = false
	}
}
async function loadOriginal() {
	contentLoading = true
	contentFailure = ''
	try {
		const value = await read<{ mediaType: string; base64: string }>('artifact_content_get', {
			artifactId: source.artifactId
		})
		if (alive) content = value
	} catch (error) {
		// Authored structured artifacts may not have a file blob.
		if (source.typeKey !== 'core.file') await loadPayload(source)
		else if (alive) contentFailure = String(error)
	} finally {
		if (alive) contentLoading = false
	}
}
onMount(() => {
	void loadOriginal()
	void discover()
	return () => {
		alive = false
	}
})
</script>

<section class="document-detail" aria-label="Dokumentansicht">
	<nav aria-label="Dokumentansicht wählen">
		<button
			type="button"
			aria-pressed={tab === 'original'}
			onclick={() => {tab='original'; selected=null}}
		>
			Original
		</button>
		<button
			type="button"
			aria-pressed={tab === 'details'}
			onclick={() => {tab='details'; selected=null}}
		>
			Erkannte Angaben <span>{count}</span>
		</button>
	</nav>
	{#if tab === 'original'}
		{#if contentLoading}
			<p role="status">Dokument wird geladen …</p>
		{:else if contentFailure}
			<p role="alert">{contentFailure}</p>
			<button type="button" onclick={loadOriginal}>Erneut laden</button>
		{:else if content}
			{#if content.mediaType === 'application/pdf'}
				<PdfContentViewer base64={content.base64} />
			{:else}
				<ArtifactContentViewer {...content} />
			{/if}
		{:else if payloads[source.artifactId!]}
			<ArtifactSemanticViewer
				artifactId={source.artifactId}
				showTypeKey={false}
				displayTitle={source.title}
				typeKey={source.typeKey ?? ''}
				payload={payloads[source.artifactId!]}
			/>
		{:else if failures[source.artifactId!]}
			<p role="alert">{failures[source.artifactId!]}</p>
			<button type="button" onclick={loadOriginal}>Erneut laden</button>
		{/if}
	{:else if selected}
		<button class="back" type="button" onclick={() => selected=null}>
			← Alle Angaben zu diesem Dokument
		</button>
		<h3>{selectedLabel(selected)}</h3>
		{#if payloads[selected.artifactId!]}
			{#if pending.has(`content:${selected.artifactId}`)}
				<p role="status">Inhalt wird geladen …</p>
			{/if}
			{#if pageLocations[selected.artifactId!] && content}
				<p>Fundstelle im Original · {source.title}</p>
				{#if content.mediaType === 'application/pdf'}
					<PdfContentViewer base64={content.base64} locator={pageLocations[selected.artifactId!]} />
				{:else}
					<ArtifactContentViewer
						{...content}
						locator={pageLocations[selected.artifactId!]}
						focusRange
					/>
				{/if}
			{:else if derivedContent[selected.artifactId!]}
				{@const rendered = derivedContent[selected.artifactId!]!}
				{#if rendered.mediaType === 'application/pdf'}
					<PdfContentViewer base64={rendered.base64} />
				{:else}
					<ArtifactContentViewer {...rendered} />
				{/if}
			{:else}
				<ArtifactSemanticViewer
					artifactId={selected.artifactId}
					showTypeKey={false}
					displayTitle={documentArtifactLabel(selected.typeKey ?? '')}
					typeKey={selected.typeKey ?? ''}
					payload={payloads[selected.artifactId!]}
				/>
			{/if}
			{#if failures[`content:${selected.artifactId}`]}
				<p role="alert">{failures[`content:${selected.artifactId}`]}</p>
				<button type="button" onclick={() => selected && void openDerived(selected)}>
					Erneut laden
				</button>
			{/if}
			<details class="technical">
				<summary>Technische Details</summary>
				<p>{selected.artifactId}</p>
				<p>{selected.typeKey}</p>
				<pre>{JSON.stringify(payloads[selected.artifactId!], null, 2)}</pre>
			</details>
		{/if}
	{:else}
		<header>
			<h3>Aus diesem Dokument</h3>
			<button type="button" disabled={discoveryLoading} onclick={discover}>Aktualisieren</button>
		</header>
		{#if discoveryLoading}
			<p role="status">Angaben werden geladen …</p>
		{/if}
		{#if discoveryFailure}
			<p role="alert">Weitere Angaben konnten nicht geladen werden.</p>
			<button type="button" onclick={discover}>Erneut versuchen</button>
		{/if}
		{#if !groups.length && !discoveryLoading}
			<p>Noch keine abgeleiteten Angaben. Das Original bleibt verfügbar.</p>
		{/if}
		{#each groups as group (group.typeKey)}
			<details
				class="group"
				ontoggle={(event) => {
					if (event.currentTarget.open) {
						expanded = new Set([...expanded, group.typeKey])
						void reveal(group.typeKey, false)
					} else expanded = new Set([...expanded].filter(type => type !== group.typeKey))
				}}
			>
				<summary>
					{group.typeKey === 'docs.page' && textSections ? 'Textabschnitte' : group.label}
					<span>{group.items.length}</span>
				</summary>
				<div class="items">
					{#each group.items.slice(0, limits[group.typeKey] ?? 0) as item, index (item.artifactId)}
						<div class="item">
							{#if failures[item.artifactId!]}
								<p role="alert">Vorschau nicht verfügbar.</p>
								<button type="button" onclick={() => void loadPayload(item)}>Erneut laden</button>
							{:else}
								<button
									type="button"
									class="preview"
									disabled={!payloads[item.artifactId!]}
									onclick={() => void openDerived(item)}
								>
									<span class="number">{index + 1}</span
									><span class="snippet"
										>{payloads[item.artifactId!] ? item.typeKey === 'docs.page' ? selectedLabel(item) : documentArtifactPreview(payloads[item.artifactId!]) : 'Vorschau wird geladen …'}</span
									><span aria-hidden="true">→</span>
								</button>
							{/if}
						</div>
					{/each}
				</div>
				{#if (limits[group.typeKey] ?? 0) < group.items.length}
					<button class="more" type="button" onclick={() => void reveal(group.typeKey)}>
						Weitere anzeigen · {group.items.length - (limits[group.typeKey] ?? 0)}
					</button>
				{/if}
			</details>
		{/each}
	{/if}
</section>

<style>
.document-detail {
	min-width: 0;
	width: 100%;
	font-size: 14px;
}
nav {
	display: flex;
	gap: 8px;
	margin-bottom: 18px;
	flex-wrap: wrap;
}
button {
	border: 1px solid var(--color-border);
	padding: 7px 12px;
	border-radius: 10px;
	font-size: 12px;
	cursor: pointer;
}
button[aria-pressed="true"] {
	background: var(--color-primary);
	color: var(--color-primary-foreground);
}
button:disabled {
	opacity: 0.55;
	cursor: default;
}
nav span,
summary span {
	margin-left: 8px;
	font-size: 12px;
	opacity: 0.65;
}
header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 12px;
}
h3 {
	font-size: 15px;
	font-weight: 600;
	margin: 10px 0;
}
p {
	font-size: 13px;
	color: var(--color-muted-foreground);
	margin: 12px 0;
	overflow-wrap: anywhere;
}
.group {
	border: 1px solid var(--color-border);
	border-radius: 12px;
	margin-bottom: 8px;
	background: var(--color-surface-raised);
}
summary {
	padding: 14px;
	cursor: pointer;
	font-weight: 500;
}
summary span {
	float: right;
}
.items {
	padding: 0 12px 6px;
}
.item + .item {
	border-top: 1px solid var(--color-border);
}
.preview {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	text-align: left;
	border: 0;
	padding: 12px 4px;
}
.preview:hover {
	background: var(--color-surface-page);
}
.number {
	font-size: 11px;
	opacity: 0.5;
	flex-shrink: 0;
}
.snippet {
	flex: 1;
	min-width: 0;
	overflow-wrap: anywhere;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.more {
	margin: 0 12px 12px;
}
.back {
	margin-bottom: 12px;
}
.technical {
	margin-top: 20px;
	border-top: 1px solid var(--color-border);
}
pre {
	max-height: 300px;
	overflow: auto;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font-size: 11px;
}
</style>
