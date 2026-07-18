<script lang="ts">
// board 0084 — Offene-Posten vibe: a Beleg (open item) ↔ Transaktion reconciliation, 50/50. Renders
// either a MATCH (open item settled by a tx) or an UNMATCHED tx (parked, awaiting a receipt).
let { data }: { containerName?: string; data?: Record<string, unknown> } = $props()

function rec(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function money(n: unknown, cur?: string): string {
	if (typeof n !== 'number') return '—'
	return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`
}

const match = $derived(rec(data?.match))
const invoice = $derived(rec(match.invoice))
const tx = $derived(rec(match.tx))
const reasons = $derived(Array.isArray(match.reasons) ? (match.reasons as string[]) : [])
const unmatched = $derived(rec(data?.unmatchedTx))
const hasMatch = $derived(Object.keys(match).length > 0)

const STATUS_CHIP: Record<string, string> = {
	offen: 'bg-amber-500/15 text-amber-700',
	teilbezahlt: 'bg-blue-500/15 text-blue-700',
	bezahlt: 'bg-green-600/15 text-green-700'
}
</script>

<div
	class="border-border bg-card mx-auto w-full max-w-2xl rounded-[var(--radius-lg)] border text-sm"
>
	{#if hasMatch}
		<div class="grid grid-cols-2 divide-x divide-[var(--border)]">
			<!-- Left: the open item (Beleg) -->
			<div class="flex flex-col gap-1 p-3">
				<div class="flex items-center justify-between gap-2">
					<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
						Offener Posten
					</p>
					{#if invoice.status}
						<span
							class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold {STATUS_CHIP[
								String(invoice.status)
							] ?? 'bg-muted text-muted-foreground'}"
							>{invoice.status}</span
						>
					{/if}
				</div>
				<p class="text-foreground truncate font-semibold">{invoice.vendor ?? '—'}</p>
				<p class="text-muted-foreground text-xs">Rechnung {invoice.number ?? '—'}</p>
				<p class="text-foreground mt-auto pt-2 text-base font-semibold tabular-nums">
					{money(invoice.amount, String(invoice.currency ?? ''))}
				</p>
			</div>
			<!-- Right: the settling transaction -->
			<div class="flex flex-col gap-1 p-3">
				<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
					Zahlung
				</p>
				<p class="text-foreground truncate font-semibold">{tx.counterparty ?? '—'}</p>
				<p class="text-muted-foreground text-xs">{tx.date ?? '—'}</p>
				<p
					class="mt-auto pt-2 text-base font-semibold tabular-nums {typeof tx.amount === 'number' && tx.amount < 0 ? 'text-destructive' : 'text-foreground'}"
				>
					{money(tx.amount, String(tx.currency ?? ''))}
				</p>
			</div>
		</div>
		{#if reasons.length}
			<div class="border-border/60 border-t px-3 py-2">
				<div class="flex flex-wrap gap-1">
					{#each reasons as r (r)}
						<span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
							>{r}</span
						>
					{/each}
				</div>
			</div>
		{/if}
	{:else}
		<!-- Unmatched: a transaction with no Beleg → parked -->
		<div class="flex flex-col gap-2 p-4">
			<div class="flex items-center justify-between gap-2">
				<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
					Transaktion ohne Beleg
				</p>
				<span
					class="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-700"
					>geparkt</span
				>
			</div>
			<p class="text-foreground font-semibold">{unmatched.counterparty ?? '—'}</p>
			<p class="text-muted-foreground text-xs">
				{unmatched.date ?? '—'}
				{#if unmatched.description}
					· {unmatched.description}
				{/if}
			</p>
			<p
				class="text-base font-semibold tabular-nums {typeof unmatched.amount === 'number' && unmatched.amount < 0 ? 'text-destructive' : 'text-foreground'}"
			>
				{money(unmatched.amount, String(unmatched.currency ?? ''))}
			</p>
			<p class="text-muted-foreground border-border mt-1 rounded border border-dashed p-2 text-xs">
				Kein offener Posten gefunden — wartet auf den Beleg (Beleg nachreichen, dann automatischer
				Abgleich).
			</p>
		</div>
	{/if}
</div>
