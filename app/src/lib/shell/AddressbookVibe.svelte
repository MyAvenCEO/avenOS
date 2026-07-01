<script lang="ts">
import { type Contact, contactDisplayName } from '@avenos/aven-vibes'
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

// board 0097 — the detail viewer is a purpose-built layout (no DocCompare projection): the contact's
// fields grouped into Kontakt / Bank / Steuer / Anschrift / Register, each row shown only when present.
type Field = [label: string, value: string | null | undefined]
const fieldGroups = $derived.by((): { title: string; rows: Field[] }[] => {
	const c = selected?.data
	if (!c) return []
	const groups: { title: string; rows: Field[] }[] = [
		{ title: 'Kontakt', rows: [['E-Mail', c.email], ['Telefon', c.phone]] },
		{ title: 'Bank', rows: [['IBAN', c.iban], ['BIC', c.bic], ['Bank', c.bank_name]] },
		{ title: 'Steuer', rows: [['USt-IdNr', c.vat_id], ['Steuernummer', c.tax_number]] },
		{ title: 'Anschrift', rows: [['Adresse', c.street]] },
		{
			title: 'Register',
			rows: [
				['Registergericht', c.register_court],
				['Registernummer', c.register_number],
				['Geschäftsführer', c.managing_director]
			]
		}
	]
	return groups
		.map((g) => ({ title: g.title, rows: g.rows.filter(([, v]) => v) as Field[] }))
		.filter((g) => g.rows.length > 0)
})
// the company's Ansprechpartner — persons that `represents` this company.
const ansprechpartner = $derived(
	selected?.data.type === 'company'
		? rows.filter((r) => r.data.type === 'person' && r.data.represents === selected.id)
		: []
)

// Belege: outgoing invoices by contact short_id; incoming invoices by the billed_by company ref.
const outgoing = $derived(
	selected
		? (invoiceDocsQuery.data ?? []).filter(
				(i) => i.data.contact_short_id === selected.data.short_id
			)
		: []
)
const incoming = $derived(
	selected
		? (invoicesQuery.data ?? []).filter((i) => i.data.billed_by === selected.id)
		: []
)

function selectContact(id: string): void {
	selectedId = id
	tab = 'stammdaten'
}
</script>

<div
	class="bg-card flex min-h-[320px] w-full gap-3 rounded-[var(--radius-lg)] p-3"
	data-container={containerName}
>
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
				{#if tab === 'stammdaten'}
					<div class="flex flex-col gap-4">
						<header class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<h3 class="text-foreground truncate text-lg font-semibold">
									{selected.data.name || '—'}
								</h3>
								<div class="mt-1 flex flex-wrap items-center gap-1.5">
									<span
										class="bg-primary/10 text-foreground rounded-full px-2 py-0.5 text-[11px] font-medium"
									>
										{selected.data.type === 'company'
											? t('mainnet.addressbook.company')
											: t('mainnet.addressbook.person')}
									</span>
									{#if selected.data.legal_form}
										<span class="text-muted-foreground text-[11px]">{selected.data.legal_form}</span>
									{/if}
									{#if selected.data.is_self}
										<span class="text-[11px] font-medium text-green-600">★ Eigenes Unternehmen</span>
									{/if}
								</div>
							</div>
							<span class="text-muted-foreground shrink-0 font-mono text-[10px]"
								>{selected.data.short_id}</span
							>
						</header>

						{#if fieldGroups.length === 0}
							<p class="text-muted-foreground text-xs">Keine weiteren Stammdaten erfasst.</p>
						{:else}
							{#each fieldGroups as g (g.title)}
								<section>
									<p
										class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase"
									>
										{g.title}
									</p>
									<dl
										class="border-border/60 divide-border/60 divide-y rounded-[var(--radius-md)] border"
									>
										{#each g.rows as [label, value] (label)}
											<div class="flex items-baseline justify-between gap-3 px-3 py-1.5">
												<dt class="text-muted-foreground shrink-0 text-xs">{label}</dt>
												<dd class="text-foreground text-right text-[13px] font-medium break-all">
													{value}
												</dd>
											</div>
										{/each}
									</dl>
								</section>
							{/each}
						{/if}

						{#if ansprechpartner.length > 0}
							<section>
								<p
									class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase"
								>
									Ansprechpartner
								</p>
								<div
									class="border-border/60 divide-border/60 divide-y rounded-[var(--radius-md)] border"
								>
									{#each ansprechpartner as p (p.id)}
										<div class="flex items-center justify-between gap-3 px-3 py-1.5">
											<span class="text-foreground text-[13px] font-medium">{p.data.name}</span>
											{#if p.data.email}
												<span class="text-muted-foreground text-xs break-all">{p.data.email}</span>
											{/if}
										</div>
									{/each}
								</div>
							</section>
						{/if}
					</div>
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
										<span class="truncate">{i.data.number ?? '—'}</span>
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
