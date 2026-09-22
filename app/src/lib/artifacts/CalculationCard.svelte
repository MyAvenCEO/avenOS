<script lang="ts">
import { invoke } from '@tauri-apps/api/core'
import CopyMessage from '../chat/CopyMessage.svelte'
import { arrayValue, displayValue, objectValue, stringValue } from './artifact-view'

let { value, compact = false }: { value: unknown; compact?: boolean } = $props()
const data = $derived(objectValue(value))
const result = $derived(objectValue(data.result))
const operands = $derived(arrayValue(data.operands).map(objectValue))
const unit = $derived(stringValue(result.unit, '1'))
const unitLabel = $derived(unit === '1' ? '' : unit.replace(/^(currency|quantity):/, ''))
const sourceData = $state<Record<string, Record<string, unknown>>>({})
const sourceErrors = $state<Record<string, string>>({})
let loadingSources = $state<Set<string>>(new Set())
const operationLabel: Record<string, string> = {
	add: 'Summe',
	subtract: 'Differenz',
	multiply: 'Produkt',
	divide: 'Quotient',
	compare: 'Vergleich',
	round: 'Rundung'
}
async function loadSource(id: string) {
	if (sourceData[id] || loadingSources.has(id)) return
	loadingSources = new Set([...loadingSources, id])
	delete sourceErrors[id]
	try {
		const envelope = await invoke<Record<string, unknown>>('artifact_get', { artifactId: id })
		if (envelope.artifactId !== id)
			throw Error('Die Quelle konnte nicht eindeutig zugeordnet werden.')
		sourceData[id] = objectValue(envelope.payload)
	} catch (error) {
		sourceErrors[id] = String(error)
	} finally {
		loadingSources = new Set([...loadingSources].filter((key) => key !== id))
	}
}
function sourceValue(payload: Record<string, unknown>, pointer: unknown): string {
	if (typeof pointer !== 'string')
		return stringValue(payload.originalName, 'Quelle vorhanden · kein Datenfeld angegeben')
	let result: unknown = payload
	for (const key of pointer
		.split('/')
		.slice(1)
		.map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'))) {
		if (result === null || typeof result !== 'object' || !Object.hasOwn(result, key))
			return 'Das angegebene Datenfeld ist nicht vorhanden.'
		result = (result as Record<string, unknown>)[key]
	}
	if (Array.isArray(result)) return `${result.length} Einträge im Quelldatenfeld`
	if (result && typeof result === 'object')
		return 'Strukturierte Quelldaten · kein einzelner Zahlenwert'
	return displayValue(result).slice(0, 500)
}
</script>

<article class:compact aria-label="Calculation result" class="calculation-card">
	<header>
		<span title="Arithmetic on the supplied values; not independent verification of their sources."
			>{data.exact === true ? '= Exact' : '≈ Rounded'}</span
		>
		<CopyMessage text={stringValue(data.text, '')} />
	</header>
	<h3>{stringValue(data.purpose, operationLabel[String(data.operation)] ?? 'Berechnung')}</h3>
	<strong class="result">{stringValue(result.value)} <small>{unitLabel}</small></strong>
	<details>
		<summary>Calculation details · {operands.length} Eingaben</summary>
		<p class="trust">
			Arithmetik geprüft. Bedeutung, Vollständigkeit und Auswahl der Quellen sind damit nicht
			bestätigt.
		</p>
		<p>{stringValue(data.text)}</p>
		{#if data.rounding}
			<p>{stringValue(data.rounding)} · {String(data.decimal_places)} decimal places</p>
		{/if}
		<ol>
			{#each operands as operand, index}
				{@const source = objectValue(operand.source)}
				<li>
					<div class="input-row">
						<span class="meaning"
							>{stringValue(operand.label, `Eingabe ${index + 1} · Bedeutung nicht angegeben`)}</span
						>
						<strong
							>{stringValue(operand.value)}
							<small
								>{operand.unit === '1' ? 'ohne Einheit' : stringValue(operand.unit).replace(/^(currency|quantity):/, '')}</small
							></strong
						>
					</div>
					{#if source.label}
						<span class="source-label">{String(source.label)}</span>
					{/if}
					{#if typeof source.artifactId === 'string'}
						<details
							class="source"
							ontoggle={(event) => {if(event.currentTarget.open) void loadSource(String(source.artifactId))}}
						>
							<summary>Quelle ansehen</summary>
							{#if loadingSources.has(source.artifactId)}
								<p role="status">Quelle wird geladen …</p>
							{:else if sourceErrors[source.artifactId]}
								<p role="alert">Quelle nicht verfügbar.</p>
								<button type="button" onclick={() => void loadSource(String(source.artifactId))}>
									Erneut laden
								</button>
							{:else if sourceData[source.artifactId]}
								<p>{sourceValue(sourceData[source.artifactId]!, source.pointer)}</p>
							{/if}
							<code>{source.artifactId}{source.pointer ? ` · ${source.pointer}` : ''}</code>
						</details>
					{:else}
						<span class="source-label"
							>{source.label ? 'Quellenangabe ohne gespeicherten Verweis' : 'Keine Quelle angegeben'}</span
						>
					{/if}
				</li>
			{/each}
		</ol>
	</details>
</article>

<style>
.calculation-card {
	width: 100%;
	min-width: 0;
	max-width: 48rem;
	margin-inline: auto;
	padding: 1.25rem;
	border: 1px solid var(--color-border);
	border-radius: 14px;
	background: var(--color-surface-raised);
	color: var(--color-foreground);
}
.compact {
	padding: 0.65rem 0.85rem;
}
header,
.input-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}
h3 {
	font-size: 0.85rem;
	font-weight: 500;
	margin: 10px 0 0;
	overflow-wrap: anywhere;
}
.input-row {
	align-items: flex-start;
}
.input-row strong {
	text-align: right;
	font-variant-numeric: tabular-nums;
	min-width: 0;
	overflow-wrap: anywhere;
}
.input-row small {
	display: block;
}
.meaning {
	flex: 1;
	min-width: 0;
}
.source-label {
	display: block;
	font-size: 0.7rem;
	color: var(--color-muted-foreground);
	margin-top: 3px;
}
.source {
	margin-top: 6px;
}
.source summary {
	font-size: 0.7rem;
}
code {
	font-size: 0.65rem;
	overflow-wrap: anywhere;
}
.trust {
	color: var(--color-muted-foreground);
	font-size: 0.7rem;
}
header,
summary {
	font-size: 0.75rem;
}
.result {
	display: block;
	margin: 0.5rem 0;
	font-size: clamp(1.1rem, 2.5vw, 1.75rem);
	font-variant-numeric: tabular-nums;
	overflow-wrap: anywhere;
}
small {
	font-size: 0.7em;
	font-weight: normal;
}
summary {
	cursor: pointer;
}
summary:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: 3px;
}
p,
ol {
	font-size: 0.8rem;
	overflow-wrap: anywhere;
}
ol {
	max-height: 14rem;
	overflow: auto;
	padding: 0;
	list-style: none;
}
li {
	padding: 0.35rem 0;
	border-top: 1px solid var(--color-border);
}
li span {
	min-width: 0;
	overflow-wrap: anywhere;
}
</style>
