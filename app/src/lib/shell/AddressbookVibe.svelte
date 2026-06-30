<script lang="ts">
import {
	type Contact,
	contactDisplayName,
	createDocCompareShell,
	mapContactToView
} from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import { createQuery } from '@tanstack/svelte-query'
import { listContacts, listSchemas, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'
import { qk } from '$lib/query/client'

// board 0082 — the addressbook: a left contact list (alpha + person/company filter) and a right
// detail with two tabs — Stammdaten (the identity) and Belege (the contact's in/out invoices). Loaded
// in chat via the query_contacts tool ("show me contacts"); data-backed, re-fetches live.
let { containerName = 'aven-vibes-addressbook' }: { containerName?: string } = $props()

let invoiceSchemaId = $state<string | null>(null)
let invoiceDocSchemaId = $state<string | null>(null)
let selectedId = $state<string | null>(null)
const FILTERS = ['all', 'person', 'company'] as const
let filter = $state<(typeof FILTERS)[number]>('all')
let tab = $state<'stammdaten' | 'belege'>('stammdaten')
let started = false

$effect(() => {
	if (started) return
	started = true
	void (async () => {
		try {
			const schemas = await listSchemas()
			invoiceSchemaId = schemas.find((s) => s.name === 'invoice')?.id ?? null
			invoiceDocSchemaId = schemas.find((s) => s.name === 'invoice_doc')?.id ?? null
		} catch {
			/* ignore */
		}
	})()
})

// board 0096: the addressbook reads the ONTOLOGY (company + person), not the legacy `contact` schema —
// so the vendor company + Ansprechpartner enriched by the invoice flow appear here.
const contactsQuery = createQuery(() => ({
	queryKey: ['data', 'contacts'],
	queryFn: listContacts
}))
const invoicesQuery = createQuery(() => ({
	queryKey: invoiceSchemaId ? qk.values(invoiceSchemaId) : ['data', 'values', 'inv-in-pending'],
	queryFn: () => listValues<Record<string, unknown>>(invoiceSchemaId as string),
	enabled: !!invoiceSchemaId
}))
const invoiceDocsQuery = createQuery(() => ({
	queryKey: invoiceDocSchemaId
		? qk.values(invoiceDocSchemaId)
		: ['data', 'values', 'inv-out-pending'],
	queryFn: () => listValues<Record<string, unknown>>(invoiceDocSchemaId as string),
	enabled: !!invoiceDocSchemaId
}))

const rows = $derived<{ id: string; data: Contact }[]>(contactsQuery.data ?? [])
const filtered = $derived(
	rows
		.filter((r) => filter === 'all' || r.data.type === filter)
		.sort((a, b) => contactDisplayName(a.data).localeCompare(contactDisplayName(b.data)))
)
const selected = $derived(rows.find((r) => r.id === selectedId) ?? null)

const shell = createDocCompareShell('invoice', {})
const detailView = $derived(
	selected ? (mapContactToView(selected.data) as unknown as Record<string, unknown>) : null
)

// Belege: outgoing invoices by contact short_id; incoming invoices by vendor-name match (best-effort).
const outgoing = $derived(
	selected
		? (invoiceDocsQuery.data ?? []).filter(
				(i) => i.data.contact_short_id === selected.data.short_id
			)
		: []
)
const incoming = $derived.by(() => {
	if (!selected) return []
	const name = (selected.data.name ?? '').toLowerCase().trim()
	if (!name) return []
	return (invoicesQuery.data ?? []).filter((i) => {
		const vendor = String(
			((i.data.vendor as Record<string, unknown>) ?? {}).name ?? ''
		).toLowerCase()
		return vendor && (vendor.includes(name) || name.includes(vendor))
	})
})

function selectContact(id: string): void {
	selectedId = id
	tab = 'stammdaten'
}
</script>

<div class="flex min-h-[320px] w-full gap-3" data-container={containerName}>
	<!-- Left: contact list -->
	<aside class="border-border flex w-56 shrink-0 flex-col rounded-[var(--radius-lg)] border">
		<div class="border-border flex items-center justify-between gap-1 border-b p-2">
			<span class="text-foreground text-sm font-semibold">{t('mainnet.addressbook.title')}</span>
			<div class="flex gap-0.5">
				{#each FILTERS as f (f)}
					<button
						type="button"
						class="rounded px-1.5 py-0.5 text-[10px] {filter === f
							? 'bg-primary/10 text-foreground font-medium'
							: 'text-muted-foreground hover:bg-card'}"
						onclick={() => (filter = f)}
					>
						{t(`mainnet.addressbook.${f}`)}
					</button>
				{/each}
			</div>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto p-1">
			{#if filtered.length === 0}
				<p class="text-muted-foreground p-4 text-center text-xs">
					{t('mainnet.addressbook.empty')}
				</p>
			{:else}
				{#each filtered as r (r.id)}
					<button
						type="button"
						class="mb-0.5 block w-full truncate rounded px-2 py-1.5 text-left text-[13px] {r.id ===
						selectedId
							? 'bg-primary/10 text-foreground font-medium'
							: 'text-muted-foreground hover:bg-card'}"
						onclick={() => selectContact(r.id)}
					>
						{contactDisplayName(r.data)}
						{#if r.data.is_self}
							<span class="text-[9px] text-green-600">★</span>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</aside>

	<!-- Right: detail -->
	<div class="border-border min-h-0 flex-1 rounded-[var(--radius-lg)] border">
		{#if !selected}
			<p class="text-muted-foreground p-8 text-center text-sm">{t('mainnet.addressbook.pick')}</p>
		{:else}
			<div class="border-border flex gap-1 border-b p-2">
				<button
					type="button"
					class="rounded px-2 py-1 text-xs {tab === 'stammdaten'
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (tab = 'stammdaten')}
				>
					{t('mainnet.addressbook.stammdaten')}
				</button>
				<button
					type="button"
					class="rounded px-2 py-1 text-xs {tab === 'belege'
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (tab = 'belege')}
				>
					{t('mainnet.addressbook.belege')}
					({outgoing.length + incoming.length})
				</button>
			</div>
			<div class="max-h-[70vh] overflow-y-auto p-3">
				{#if tab === 'stammdaten' && detailView}
					<AvenVibeView
						{shell}
						source={detailView}
						onEvent={() => {}}
						containerName={`${containerName}-detail`}
						desktopHint="Loading…"
					/>
				{:else if tab === 'belege'}
					<div class="flex flex-col gap-3 text-xs">
						<div>
							<p
								class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase"
							>
								{t('mainnet.addressbook.outgoing')}
							</p>
							{#if outgoing.length === 0}
								<p class="text-muted-foreground">—</p>
							{:else}
								{#each outgoing as o (o.id)}
									<div class="border-border/60 flex justify-between border-b py-1">
										<span>{o.data.number}</span>
										<span class="text-muted-foreground">{o.data.state} · v{o.data.version}</span>
									</div>
								{/each}
							{/if}
						</div>
						<div>
							<p
								class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase"
							>
								{t('mainnet.addressbook.incoming')}
							</p>
							{#if incoming.length === 0}
								<p class="text-muted-foreground">—</p>
							{:else}
								{#each incoming as i (i.id)}
									<div class="border-border/60 flex justify-between border-b py-1">
										<span class="truncate"
											>{((i.data.header as Record<string, unknown>) ?? {}).invoice_number ?? '—'}</span
										>
										<span class="text-muted-foreground">Eingang</span>
									</div>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
