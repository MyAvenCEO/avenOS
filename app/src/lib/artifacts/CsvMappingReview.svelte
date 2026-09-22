<script lang="ts">
import { moneyFromMinor } from '@avenos/actors'
import type { CsvDetection } from '@avenos/document-ingest/csv'
import { confirmCsvStatement, readCsvConfirmation } from '@avenos/document-ingest/csv-confirmation'
import { type CsvMapping, readCsvMapping } from '@avenos/document-ingest/csv-mapping'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import { publicationGateway } from './client-document-processing'

let {
	artifactId,
	detection,
	initialMapping = null
}: {
	artifactId?: string | null
	detection: CsvDetection
	/** A retained producer snapshot for non-native previews. Native views load the saved run. */
	initialMapping?: CsvMapping | null
} = $props()
let mapping = $state<CsvMapping | null>(null)
let busy = $state(false),
	failure = $state(''),
	confirmationId = $state('')
let reviewed = $state(false),
	rejected = $state(false)
let alive = false
const mapped = $derived(detection.profile === 'explicit-column-mapping')
const settings = $derived(mapping ?? (!isTauri() ? initialMapping : null))
const rows = $derived((detection.statement?.transactions ?? []) as Record<string, unknown>[])
const currency = $derived(String(detection.statement?.currency ?? ''))
const fields: [keyof CsvMapping, string][] = [
	['bookingDate', 'Buchungstag'],
	['valueDate', 'Wertstellung'],
	['description', 'Beschreibung'],
	['amount', 'Betrag'],
	['currency', 'Währung'],
	['transactionId', 'Transaktions-ID'],
	['counterpartyName', 'Gegenpartei'],
	['counterpartyIban', 'IBAN der Gegenpartei'],
	['accountIban', 'Eigene IBAN']
]
const dateLabels = {
	'DD.MM.YYYY': 'TT.MM.JJJJ',
	'YYYY-MM-DD': 'JJJJ-MM-TT',
	'MM/DD/YYYY': 'MM/TT/JJJJ',
	'DD/MM/YYYY': 'TT/MM/JJJJ'
}

async function load() {
	if (!isTauri() || !artifactId || !detection.eligible) return
	busy = true
	failure = ''
	try {
		const previous = await readCsvConfirmation(
			publicationGateway,
			detection.sourceArtifactId,
			detection.sourceSha256,
			mapped ? artifactId : undefined
		)
		if (!alive) return
		rejected = previous?.payload.decision === 'rejected'
		confirmationId = previous && !rejected ? previous.artifactId : ''
		if (mapped) {
			const envelope = await invoke<{ publicationId: string }>('artifact_get', { artifactId })
			const saved = await readCsvMapping(publicationGateway, envelope.publicationId, artifactId)
			if (alive) mapping = saved
		}
	} catch (error) {
		if (alive) failure = error instanceof Error ? error.message : String(error)
	} finally {
		if (alive) busy = false
	}
}
onMount(() => {
	alive = true
	void load()
	return () => {
		alive = false
	}
})
async function confirm() {
	if (
		!artifactId ||
		!reviewed ||
		busy ||
		rejected ||
		confirmationId ||
		!detection.eligible ||
		(mapped && !settings)
	)
		return
	busy = true
	failure = ''
	try {
		const id = await confirmCsvStatement(publicationGateway, artifactId, detection, 'accepted')
		if (alive) confirmationId = id
	} catch (error) {
		if (alive) failure = error instanceof Error ? error.message : String(error)
	} finally {
		if (alive) busy = false
	}
}
</script>

<section class="csv-review" aria-label="CSV mapping review" aria-busy={busy}>
	<header>
		<div>
			<h3>CSV → Transaktionen</h3>
			<p>{rows.length} Buchungen{currency ? ` · ${currency}` : ''}</p>
		</div>
		<span class:confirmed={!!confirmationId} class="status"
			>{confirmationId ? '✓ Bestätigt' : rejected ? 'Abgelehnt' : detection.eligible ? 'Prüfen' : 'Nicht zugeordnet'}</span
		>
	</header>
	{#if detection.eligible}
		<!-- Keyboard users need to focus this bounded region to scroll all transactions. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="preview" tabindex="0" role="region" aria-label="Transaktionsvorschau">
			<table>
				<thead>
					<tr>
						<th>Buchung</th>
						<th class="amount">Betrag · {currency}</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row}
						<tr>
							<td>
								<span class="description">{String(row.description ?? 'Ohne Beschreibung')}</span>
								<small
									>{String(row.bookingDate ?? row.valueDate ?? 'Datum unbekannt')}
									· Zeile {String(row.sourceRow)}</small
								>
							</td>
							<td class="amount" class:credit={Number(row.amountMinor) > 0}>
								{Number(row.amountMinor) > 0 ? '+' : ''}
								{moneyFromMinor(row.amountMinor, currency)?.value ?? 'Unbekannt'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if settings}
			<details>
				<summary>
					Spaltenzuordnung <span>{fields.filter(([key]) => settings?.[key]).length} Spalten</span>
				</summary>
				<div class="mapping-list">
					{#each fields as [key, label]}
						{#if settings[key]}
							<div class="mapping-row">
								<span>{String(settings[key])}</span><span aria-hidden="true">→</span
								><strong>{label}</strong>
							</div>
						{/if}
					{/each}
				</div>
				<div class="conventions">
					<div><small>Datum</small><strong>{dateLabels[settings.dateFormat]}</strong></div>
					<div>
						<small>Zahlenformat</small
						><strong>1{settings.groupSeparator ?? ''}234{settings.decimalSeparator}56</strong>
					</div>
					<div>
						<small>Vorzeichen</small
						><strong
							>{settings.amountSign === 'expense-positive' ? 'Umgekehrt (+ ↔ −)' : 'Unverändert'}</strong
						>
					</div>
				</div>
				{#if settings.ignoredColumns.length}
					<details class="ignored">
						<summary>
							Nicht übernommen <span>{settings.ignoredColumns.length} Spalten</span>
						</summary>
						<div class="chips">
							{#each settings.ignoredColumns as column}
								<span>{column}</span>
							{/each}
						</div>
					</details>
				{/if}
			</details>
		{:else if mapped}
			<p class="notice">
				{busy ? 'Spaltenzuordnung wird geladen …' : 'Spaltenzuordnung noch nicht verfügbar.'}
			</p>
		{/if}
		<details>
			<summary>Herkunft & Grenzen</summary>
			<dl>
				<div>
					<dt>Original</dt>
					<dd>Unverändert</dd>
				</div>
				<div>
					<dt>Eigene IBAN</dt>
					<dd>{String(detection.statement?.accountIban ?? 'Nicht angegeben')}</dd>
				</div>
				<div>
					<dt>Vollständiger Zeitraum</dt>
					<dd>Nicht nachgewiesen</dd>
				</div>
				<div>
					<dt>Bankherkunft</dt>
					<dd>Nicht geprüft</dd>
				</div>
				<div>
					<dt>Rechnungsabgleich</dt>
					<dd>Separater Schritt</dd>
				</div>
			</dl>
			{#if confirmationId}
				<details>
					<summary>Bestätigungs-ID</summary>
					<code>{confirmationId}</code>
				</details>
			{/if}
		</details>
		{#if confirmationId}
			<p class="notice" role="status">Bereit für die Weiterverarbeitung.</p>
		{:else if rejected}
			<p class="notice">Passe die Zuordnung im Skill an und prüfe das neue Ergebnis.</p>
		{:else if artifactId}
			<footer>
				<label
					><input
						type="checkbox"
						bind:checked={reviewed}
						disabled={busy || (mapped && !settings)}
					>Mein Konto · Zuordnung und Werte geprüft</label
				>
				<button
					class="approve"
					type="button"
					disabled={busy || !reviewed || (mapped && !settings)}
					onclick={confirm}
				>
					{busy ? 'Bitte warten …' : 'Zuordnung bestätigen'}
				</button>
			</footer>
		{/if}
	{:else}
		<p class="notice">{detection.reason}</p>
		<p class="notice">
			Keine Transaktionen übernommen. Passe die Zuordnung im Skill an und teste erneut.
		</p>
	{/if}
	{#if failure}
		<div class="failure" role="alert">
			<p>{failure}</p>
			<button type="button" disabled={busy} onclick={load}>Erneut laden</button>
		</div>
	{/if}
</section>

<style>
.csv-review {
	max-width: 760px;
	margin: 0 auto;
	padding: 20px;
	border: 1px solid var(--color-border);
	border-radius: 20px;
	background: var(--color-surface-raised);
	font-size: 14px;
	line-height: 1.5;
}
header {
	display: flex;
	justify-content: space-between;
	align-items: start;
	gap: 12px;
	margin-bottom: 16px;
}
h3 {
	margin: 0;
	font-size: 17px;
	font-weight: 600;
}
header p {
	margin: 3px 0 0;
	color: var(--color-muted-foreground);
	font-size: 12px;
}
.status {
	flex-shrink: 0;
	border: 1px solid var(--color-border);
	padding: 3px 9px;
	border-radius: 20px;
	font-size: 12px;
}
.confirmed,
.credit {
	color: #28776e;
}
.preview {
	max-height: 300px;
	overflow: auto;
	border: 1px solid var(--color-border);
	border-radius: 12px;
}
table {
	width: 100%;
	border-collapse: collapse;
	table-layout: fixed;
}
th {
	font-size: 12px;
	font-weight: 500;
	color: var(--color-muted-foreground);
	text-align: left;
	position: sticky;
	top: 0;
	background: var(--color-surface-raised);
}
th,
td {
	padding: 10px 12px;
}
td {
	border-top: 1px solid var(--color-border);
	vertical-align: top;
}
.description {
	overflow-wrap: anywhere;
}
small {
	display: block;
	color: var(--color-muted-foreground);
	font-size: 12px;
	font-weight: 400;
}
.amount {
	width: 120px;
	text-align: right;
	font-variant-numeric: tabular-nums;
	overflow-wrap: anywhere;
}
details {
	border-top: 1px solid var(--color-border);
	margin-top: 14px;
	padding-top: 12px;
}
summary {
	cursor: pointer;
	font-weight: 500;
}
summary > span {
	float: right;
	color: var(--color-muted-foreground);
	font-size: 12px;
	font-weight: 400;
}
.mapping-list {
	margin-top: 12px;
}
.mapping-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr);
	gap: 8px;
	padding: 5px 0;
	overflow-wrap: anywhere;
}
.mapping-row > span {
	color: var(--color-muted-foreground);
}
strong {
	font-weight: 500;
}
.conventions {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 6px;
	margin-top: 12px;
}
.conventions > div {
	padding: 8px;
	background: var(--color-surface-page);
	border-radius: 8px;
	overflow-wrap: anywhere;
}
.conventions strong {
	display: block;
	font-size: 12px;
}
.ignored {
	font-size: 12px;
}
.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 10px;
}
.chips span {
	padding: 3px 8px;
	background: var(--color-surface-page);
	border-radius: 6px;
	overflow-wrap: anywhere;
}
dl {
	margin: 12px 0 0;
}
dl > div {
	display: flex;
	justify-content: space-between;
	gap: 16px;
	padding: 5px 0;
	font-size: 12px;
}
dt {
	color: var(--color-muted-foreground);
}
dd {
	margin: 0;
	text-align: right;
	overflow-wrap: anywhere;
	min-width: 0;
}
code {
	display: block;
	overflow-wrap: anywhere;
	font-size: 12px;
	margin-top: 8px;
}
footer {
	margin-top: 16px;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 14px;
}
label {
	display: flex;
	align-items: start;
	gap: 8px;
	font-size: 12px;
	cursor: pointer;
}
input {
	margin-top: 3px;
}
button {
	border: 1px solid var(--color-border);
	border-radius: 10px;
	padding: 9px 12px;
	font-size: 12px;
	cursor: pointer;
}
.approve {
	background: var(--color-primary);
	color: var(--color-primary-foreground);
}
button:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
.notice {
	font-size: 12px;
	margin: 14px 0 0;
	color: var(--color-muted-foreground);
}
.failure {
	color: var(--color-error-ink);
	font-size: 12px;
	overflow-wrap: anywhere;
	margin-top: 12px;
}
.failure p {
	margin-bottom: 8px;
}
@media (max-width: 480px) {
	.csv-review {
		padding: 16px;
		border-radius: 14px;
	}
	footer .approve {
		width: 100%;
	}
	.amount {
		width: 100px;
	}
}
</style>
