<script lang="ts">
import { type Rechnung, rechnungen, summe } from './mock-data'

/**
 * The FiBu explorer: incoming invoices on the left, the selected one as
 * master-detail on the right — positions above, the derived Buchungssatz
 * below. Read-only by design (board 0139): this view exists to *see* the
 * lowest primitive, Rechnungsposition → 1..n Buchungszeilen, before any
 * engine is built.
 *
 * The one interaction is the n:m relation itself: hovering a position
 * lights up every Buchungszeile derived from it — the 70/30 split lights
 * twice, the liability line always.
 */

let selected = $state<Rechnung>(rechnungen[0])
let hovered = $state<string | null>(null)

const soll = $derived(summe(selected, 'soll'))
const haben = $derived(summe(selected, 'haben'))

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

function money(cents: number): string {
	return eur.format(cents / 100)
}

function lit(z: { positionIds: string[] }): boolean {
	return hovered !== null && z.positionIds.includes(hovered)
}
</script>

<div class="flex min-h-0 flex-1">
	<!-- Invoice list: a mail-inbox aside — flat rows, divider lines, the
	     selected one tinted. Full height, own scroll. -->
	<nav
		class="flex w-80 shrink-0 flex-col overflow-y-auto rounded-l-2xl border border-border bg-surface-card/50"
	>
		<h3
			class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
		>
			Eingangsrechnungen
		</h3>
		{#each rechnungen as r (r.id)}
			<button
				type="button"
				onclick={() => {
					selected = r
					hovered = null
				}}
				class="border-border/50 border-b px-4 py-3 text-left transition-colors {selected.id === r.id
					? 'bg-surface-cream'
					: 'hover:bg-surface-card'}"
			>
				<div class="flex items-baseline justify-between gap-2">
					<span class="truncate font-semibold text-sm">{r.lieferant}</span>
					<span class="shrink-0 font-mono text-sm">{money(r.brutto)}</span>
				</div>
				<div class="flex justify-between pt-1 text-foreground/50 text-xs">
					<span>{datum.format(new Date(r.belegdatum))}</span>
					<span>
						{r.positionen.length}
						{r.positionen.length === 1 ? 'Position' : 'Positionen'}
						→ {r.buchungszeilen.length} Zeilen
					</span>
				</div>
			</button>
		{/each}
	</nav>

	<!-- The selected invoice: positions, then the Buchungssatz they derive. -->
	<div
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-r-2xl border border-border border-l-0 bg-surface-card/30 p-5"
	>
		<header class="flex items-baseline gap-3">
			<h2 class="font-display font-semibold text-lg">{selected.lieferant}</h2>
			<span class="font-mono text-foreground/40 text-xs">{selected.id}</span>
			<span class="text-foreground/50 text-xs">{datum.format(new Date(selected.belegdatum))}</span>
			{#if selected.skontoHinweis}
				<span class="ml-auto rounded-full bg-surface-cream px-3 py-1 text-xs">
					{selected.skontoHinweis}
				</span>
			{/if}
		</header>

		<section class="rounded-2xl border border-border bg-surface-card">
			<h3 class="px-4 pt-3 pb-1 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
				Rechnungspositionen
			</h3>
			<table class="w-full text-sm">
				<thead>
					<tr class="border-border border-b text-left text-foreground/40 text-xs">
						<th class="px-4 py-2 font-normal">Bezeichnung</th>
						<th class="px-4 py-2 font-normal">Kategorie</th>
						<th class="px-4 py-2 text-right font-normal">Netto</th>
						<th class="px-4 py-2 text-right font-normal">Satz</th>
						<th class="px-4 py-2 text-right font-normal">USt</th>
					</tr>
				</thead>
				<tbody>
					{#each selected.positionen as p (p.id)}
						<tr
							onmouseenter={() => {
								hovered = p.id
							}}
							onmouseleave={() => {
								hovered = null
							}}
							class="border-border/50 border-b transition-colors last:border-0 {hovered === p.id
								? 'bg-surface-cream'
								: ''}"
						>
							<td class="px-4 py-2">{p.bezeichnung}</td>
							<td class="px-4 py-2">
								<span class="rounded-full bg-surface-soft px-2 py-0.5 text-xs">{p.kategorie}</span>
							</td>
							<td class="px-4 py-2 text-right font-mono">{money(p.netto)}</td>
							<td class="px-4 py-2 text-right font-mono text-foreground/60">{p.ustSatz} %</td>
							<td class="px-4 py-2 text-right font-mono">{money(p.ust)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="rounded-2xl border border-border bg-surface-card">
			<h3 class="px-4 pt-3 pb-1 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
				Buchungssatz
			</h3>
			<table class="w-full text-sm">
				<thead>
					<tr class="border-border border-b text-left text-foreground/40 text-xs">
						<th class="w-14 px-4 py-2 font-normal">Seite</th>
						<th class="px-4 py-2 font-normal">Konto</th>
						<th class="px-4 py-2 text-right font-normal">Betrag</th>
						<th class="px-4 py-2 font-normal">Begründung</th>
					</tr>
				</thead>
				<tbody>
					{#each selected.buchungszeilen as z, i (i)}
						<tr
							class="border-border/50 border-b transition-colors last:border-0 {lit(z)
								? 'bg-surface-cream'
								: hovered !== null
									? 'opacity-40'
									: ''}"
						>
							<td class="px-4 py-2">
								<span
									class="font-mono text-xs uppercase {z.seite === 'haben'
										? 'text-primary'
										: 'text-foreground/50'}"
								>
									{z.seite}
								</span>
							</td>
							<td class="whitespace-nowrap px-4 py-2">
								{z.konto}
								{#if z.vorsteuer}
									<span class="pl-1 text-[0.625rem] text-foreground/40">Kz 66</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-right font-mono">{money(z.betrag)}</td>
							<td class="px-4 py-2 text-foreground/60 text-xs leading-relaxed">{z.begruendung}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-border border-t font-mono text-xs">
						<td class="px-4 py-2 text-foreground/40" colspan="2">
							Soll {money(soll)} · Haben {money(haben)}
						</td>
						<td class="px-4 py-2 text-right" colspan="2">
							{#if soll === haben}
								<span class="text-status-success">Soll = Haben ✓</span>
							{:else}
								<span class="text-status-error">Differenz {money(soll - haben)}</span>
							{/if}
						</td>
					</tr>
				</tfoot>
			</table>
		</section>
	</div>
</div>
