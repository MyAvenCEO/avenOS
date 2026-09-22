<script lang="ts">
import { arrayValue, formatMoney, labelForKey, objectValue } from './artifact-view'

let { value }: { value: unknown } = $props()
const result = $derived(objectValue(value))
const query = $derived(objectValue(result.query))
const data = $derived(objectValue(result.data))
const groups = $derived(arrayValue(data.groups).map(objectValue))
const items = $derived(arrayValue(data.items).map(objectValue))
const filters = $derived(arrayValue(query.where).map(objectValue))
const collectionLabel = $derived(
	(
		{
			documents: 'Dokumente',
			invoices: 'Rechnungsdatensätze',
			statements: 'Kontoauszugsdatensätze',
			transactions: 'Buchungen',
			'line-items': 'Positionen'
		} as Record<string, string>
	)[String(query.collection)] ?? 'Gespeicherte Einträge'
)
const summary = $derived(query.view === 'summary')
const purpose = $derived(typeof query.purpose === 'string' ? query.purpose : '')
const total = $derived(
	Array.isArray(data.groups) && groups.every((g) => /^\d+$/.test(String(g.count)))
		? groups
				.reduce((n, g) => (/^\d+$/.test(String(g.count)) ? n + BigInt(String(g.count)) : n), 0n)
				.toString()
		: null
)
</script>

<article class="knowledge-card" aria-label="Knowledge query result">
	<header>
		<strong
			>{summary ? `${collectionLabel} zählen${query.measure ? ' und summieren' : ''}` : `${collectionLabel} ansehen`}</strong
		>
		<span>{summary ? 'Bestandsabfrage' : 'Gespeicherte Angaben'}</span>
	</header>
	{#if purpose}
		<p class="purpose">Ziel: {purpose}</p>
	{/if}
	{#if query.measure}
		<p class="notice">Summe: {labelForKey(String(query.measure))}</p>
	{/if}
	{#if filters.length || query.search}
		<details class="selection">
			<summary>
				Welche Auswahl? · {filters.length} Filter{query.search ? ' · Suchbegriff' : ''}
			</summary>
			{#if query.search}
				<p>Suche: {String(query.search)}</p>
			{/if}
			{#each filters as filter}
				<p>
					{labelForKey(String(filter.field))}:
					{filter.op === 'present' ? 'Wert vorhanden' : filter.op === 'not-in' ? 'vorhanden, aber nicht' : 'gleich'}
					{arrayValue(filter.values).join(', ')}
				</p>
			{/each}
			<p>Alle Bedingungen müssen zutreffen. Fehlende Werte sind ausgeschlossen.</p>
		</details>
	{:else}
		<p class="notice">Auswahl: alle gespeicherten {collectionLabel} im Workspace</p>
	{/if}
	{#if query.view==='summary'}
		<p class="count">
			{total ?? 'Nicht erfasst'}
			<small>{total === null ? 'Anzahl fehlt' : collectionLabel}</small>
		</p>
		<p class="notice">
			{query.collection === 'documents' ? 'Gezählt wurden Dateien, nicht Fundstellen oder extrahierte Werte. Diese Abfrage liest keine Dokumentinhalte und belegt keine vollständige Suche darin.' : 'Gezählt wurden bereits gespeicherte Datensätze. Das ist kein Nachweis, dass alle Quelldokumente vollständig ausgewertet wurden.'}
		</p>
		{#if query.measure}
			<div class="table-scroll">
				<table>
					<thead>
						<tr>
							<th>Currency</th>
							<th>Reported total</th>
							<th>Missing amount</th>
						</tr>
					</thead>
					<tbody>
						{#each groups as group}
							<tr>
								<td>{group.currency??'Unknown'}</td>
								<td>
									{group.sumMinor == null ? 'Not established' : formatMoney(group.sumMinor, group.currency)}
								</td>
								<td>{group.unknownAmountCount}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="notice">Reported amounts, not a confirmed balance. No currency conversion.</p>
		{/if}
	{:else if query.view==='rows'}
		<p>{items.length} shown{data.nextAfter?' · more available':''}</p>
		<ul>
			{#each items.slice(0,5) as item}
				<li>
					{item.name??'Document'}
					<small
						>{item.status==='checked'?'Checked':item.status==='review'?'Needs review':'Unverified'}</small
					>
				</li>
			{/each}
		</ul>
		{#if items.length>5}
			<p class="notice">{items.length-5} more in the inspected result.</p>
		{/if}
	{/if}
	{#if data.snapshotSequence!==undefined}
		<details class="selection">
			<summary>Datenstand und Abfrage</summary>
			<p>
				Snapshot {data.snapshotSequence} · {collectionLabel} ·
				{summary ? 'Zusammenfassung' : 'Einträge'}
			</p>
		</details>
	{/if}
</article>

<style>
.knowledge-card {
	min-width: 0;
	width: 100%;
	border: 1px solid var(--color-border);
	border-radius: 14px;
	padding: 12px 14px;
	background: var(--color-surface-raised);
	font-size: 13px;
	overflow-wrap: anywhere;
}
.selection {
	font-size: 11px;
	margin: 8px 0;
}
.selection summary {
	cursor: pointer;
}
header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
}
header span,
small,
.notice {
	opacity: 0.65;
	font-size: 11px;
}
.count {
	font-size: 24px;
	margin: 8px 0;
}
.count small {
	font-size: 12px;
}
.table-scroll {
	max-width: 100%;
	overflow: auto;
}
table {
	width: 100%;
	border-collapse: collapse;
	font-variant-numeric: tabular-nums;
}
th,
td {
	padding: 7px 8px;
	text-align: left;
	border-bottom: 1px solid var(--color-border);
	font-weight: normal;
}
th {
	font-size: 11px;
	opacity: 0.65;
}
.notice {
	margin-top: 8px;
}
ul {
	padding: 0;
	list-style: none;
}
li {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	padding: 5px 0;
}
li small {
	flex-shrink: 0;
}
</style>
