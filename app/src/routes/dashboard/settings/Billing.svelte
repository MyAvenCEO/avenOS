<script lang="ts">
import { euro, PLANS, type Plan } from '@avenos/aven-website/pricing'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { onDestroy, onMount } from 'svelte'
import { page } from '$app/state'

/**
 * Abrechnung — the member's whole Creem relationship, self-served in-app.
 *
 * Everything routes through the id service with the session token (the Creem
 * key never reaches this binary), and every call acts on the session's OWN
 * subscription — the pane never handles a subscription or customer id.
 *
 * The webhook is the only writer of state: after subscribe/change/cancel the
 * pane shows a pending note and polls `billing_me` until the event lands,
 * rather than pretending the change already happened.
 *
 * The ladder here is avenME and avenCEO only. avenID is a one-off the funnel
 * owns, and avenCOOP is not a Creem product at all — that relationship is
 * handled individually.
 */

interface Standing {
	tier: string
	status: string
	priceEurCents: number
	currentPeriodEnd: string | null
	cancelAtPeriodEnd: boolean
}

interface Invoice {
	id: string
	createdAt: string
	amountCents: number
	taxCents: number
	currency: string
	status: string
	periodStart: string | null
	periodEnd: string | null
}

const TIER_PLANS: Plan[] = PLANS.filter((p) => p.id === 'avenme' || p.id === 'avenceo')

let standing = $state<Standing | null>(null)
let invoices = $state<Invoice[]>([])
let loading = $state(true)
let busy = $state('')
let pending = $state('')
let failure = $state<string | null>(null)
/** Which action is asking "wirklich?" — one confirm at a time. */
let confirming = $state<'cancel' | `change:${string}` | null>(null)
let pollTimer: ReturnType<typeof setInterval> | undefined

const currentPlan = $derived(TIER_PLANS.find((p) => p.id === standing?.tier) ?? null)

// In the browser the pane renders from fixtures so every state is stylable
// without a paid account: ?billing=none|active|cancel (default active).
const fixtureScenario = $derived(page.url.searchParams.get('billing') ?? 'active')

function fixtures(scenario: string): { standing: Standing | null; invoices: Invoice[] } {
	if (scenario === 'none') return { standing: null, invoices: [] }
	const paid: Invoice[] = [
		{
			id: 'tx_demo_2',
			createdAt: '2026-08-14T09:12:00.000Z',
			amountCents: 4998,
			taxCents: 798,
			currency: 'EUR',
			status: 'paid',
			periodStart: '2026-08-14T09:12:00.000Z',
			periodEnd: '2026-09-14T09:12:00.000Z'
		},
		{
			id: 'tx_demo_1',
			createdAt: '2026-07-14T09:12:00.000Z',
			amountCents: 4998,
			taxCents: 798,
			currency: 'EUR',
			status: 'paid',
			periodStart: '2026-07-14T09:12:00.000Z',
			periodEnd: '2026-08-14T09:12:00.000Z'
		}
	]
	return {
		standing: {
			tier: 'avenme',
			status: scenario === 'cancel' ? 'scheduled_cancel' : 'active',
			priceEurCents: 4200,
			currentPeriodEnd: '2026-09-14T09:12:00.000Z',
			cancelAtPeriodEnd: scenario === 'cancel'
		},
		invoices: paid
	}
}

async function refresh() {
	if (!isTauri()) {
		const fixture = fixtures(fixtureScenario)
		standing = fixture.standing
		invoices = fixture.invoices
		return
	}
	const me = await invoke<{ subscription: Standing | null }>('billing_me')
	standing = me.subscription
	// History exists even without a subscription — the one-off avenID purchase
	// is a Creem transaction too, resolved via the session's own email.
	const history = await invoke<{ invoices: Invoice[] }>('billing_invoices')
	invoices = history.invoices
}

/** After an action: watch for the webhook to land, then stop announcing. */
function watch(until: (s: Standing | null) => boolean, note: string) {
	pending = note
	if (pollTimer) clearInterval(pollTimer)
	pollTimer = setInterval(async () => {
		try {
			await refresh()
			if (until(standing)) {
				pending = ''
				if (pollTimer) clearInterval(pollTimer)
			}
		} catch {
			// keep polling; transient failures resolve themselves
		}
	}, 5000)
}

async function act(label: string, run: () => Promise<void>) {
	busy = label
	failure = null
	confirming = null
	try {
		await run()
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
		pending = ''
	} finally {
		busy = ''
	}
}

async function subscribe(tier: string) {
	await act(`subscribe:${tier}`, async () => {
		const result = await invoke<{ checkoutUrl: string }>('billing_subscribe', { tier })
		await openUrl(result.checkoutUrl)
		watch(
			(s) => s !== null && !['canceled', 'expired'].includes(s.status),
			'Checkout im Browser geöffnet — sobald die Zahlung bestätigt ist, erscheint dein Plan hier.'
		)
	})
}

async function changeTo(tier: string) {
	await act(`change:${tier}`, async () => {
		await invoke('billing_upgrade', { tier })
		watch(
			(s) => s?.tier === tier,
			'Planwechsel angestoßen — die Bestätigung kommt in wenigen Momenten.'
		)
	})
}

async function cancel() {
	await act('cancel', async () => {
		await invoke('billing_cancel')
		watch(
			(s) => s?.cancelAtPeriodEnd === true || (s?.status ?? '') === 'canceled',
			'Kündigung angestoßen — gleich steht hier dein Enddatum.'
		)
	})
}

async function resume() {
	await act('resume', async () => {
		await invoke('billing_resume')
		watch(
			(s) => s?.cancelAtPeriodEnd === false,
			'Fortsetzung angestoßen — dein Plan läuft gleich wieder unbefristet.'
		)
	})
}

/** Which invoice row is expanded into its in-app rendered detail. */
let openInvoice = $state<string | null>(null)

/** Creem (merchant of record) issues the official invoice PDFs; its hosted
 * portal is the only place they exist — the API carries none. The command
 * mints the link server-side for the caller's own customer record and opens
 * it in a dedicated APP window, so the documents display inside avenOS. */
async function openPortal() {
	await act('portal', async () => {
		if (!isTauri()) return
		await invoke('billing_portal')
	})
}

const cents = (value: number) => (value / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })

const dateOf = (iso: string) =>
	new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

const STATUS_LABEL: Record<string, string> = {
	active: 'Aktiv',
	trialing: 'Testphase',
	paused: 'Pausiert',
	past_due: 'Zahlung offen',
	canceled: 'Gekündigt',
	expired: 'Abgelaufen',
	scheduled_cancel: 'Endet bald'
}

onMount(async () => {
	try {
		await refresh()
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		loading = false
	}
})

onDestroy(() => {
	if (pollTimer) clearInterval(pollTimer)
})
</script>

{#snippet planCard(p: Plan)}
	{@const isCurrent = standing?.tier === p.id}
	{@const delta = currentPlan ? p.eurPrice - currentPlan.eurPrice : 0}
	<article
		class="flex min-w-0 flex-1 flex-col gap-3 rounded-xl border px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)] {isCurrent
			? 'border-primary bg-surface-raised'
			: 'border-foreground/5 bg-surface-raised'}"
	>
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="text-sm font-medium">{p.name}</h3>
			{#if isCurrent}
				<span
					class="rounded-full bg-primary/10 px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.12em]"
				>
					Dein Plan
				</span>
			{/if}
		</div>
		<p class="text-xs opacity-60">{p.role}</p>
		<p class="text-lg font-semibold">
			{euro(p.eurPrice)}
			€<span class="pl-1 text-xs font-normal opacity-50">/Monat · zzgl. USt.</span>
		</p>
		<ul class="flex flex-col gap-1 text-xs opacity-70">
			{#each p.features.slice(0, 5) as feature, index (index)}
				<li class="flex gap-2">
					<span class="opacity-50">·</span>
					<span>{typeof feature === 'string' ? feature : feature.label}</span>
				</li>
			{/each}
		</ul>
		<div class="mt-auto pt-2">
			{#if !standing || ['canceled', 'expired'].includes(standing.status)}
				<button
					type="button"
					onclick={() => subscribe(p.id)}
					disabled={busy !== ''}
					class="w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
				>
					{busy === `subscribe:${p.id}` ? 'Einen Moment …' : 'Jetzt abonnieren'}
				</button>
			{:else if !isCurrent}
				{#if confirming === `change:${p.id}`}
					<div class="flex flex-col gap-2">
						<p class="text-xs opacity-70">
							{delta > 0
								? 'Die Preisdifferenz wird sofort anteilig berechnet.'
								: 'Der Wechsel wird mit deinem laufenden Zeitraum verrechnet.'}
						</p>
						<div class="flex gap-2">
							<button
								type="button"
								onclick={() => changeTo(p.id)}
								disabled={busy !== ''}
								class="flex-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
							>
								{busy === `change:${p.id}` ? 'Einen Moment …' : 'Wechsel bestätigen'}
							</button>
							<button
								type="button"
								onclick={() => (confirming = null)}
								class="rounded-full border border-border px-4 py-2 text-sm"
							>
								Abbrechen
							</button>
						</div>
					</div>
				{:else}
					<button
						type="button"
						onclick={() => (confirming = `change:${p.id}`)}
						disabled={busy !== ''}
						class="w-full rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
					>
						{delta > 0 ? `Upgrade · +${euro(delta)} €/Monat` : `Wechseln · −${euro(-delta)} €/Monat`}
					</button>
				{/if}
			{/if}
		</div>
	</article>
{/snippet}

<section class="flex flex-col gap-4">
	<h2 class="text-sm">Abrechnung</h2>

	{#if loading}
		<p
			class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-50 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			Deine Abrechnung wird geladen …
		</p>
	{:else}
		{#if standing && !['canceled', 'expired'].includes(standing.status)}
			<!-- Aktueller Plan -->
			<div
				class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Aktueller Plan</p>
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<p class="text-sm font-medium">{currentPlan?.name ?? standing.tier}</p>
					<span
						class="rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.12em] {standing.cancelAtPeriodEnd
							? 'bg-warning/15 text-warning-strong'
							: 'bg-success/15 text-success-strong'}"
					>
						{STATUS_LABEL[standing.status] ?? standing.status}
					</span>
				</div>
				<p class="text-xs opacity-60">
					{euro(Math.round(standing.priceEurCents / 100))}
					€ /Monat · zzgl. USt.
				</p>
				{#if standing.currentPeriodEnd}
					<p class="text-xs opacity-60">
						{standing.cancelAtPeriodEnd
							? `Endet am ${dateOf(standing.currentPeriodEnd)} — bis dahin läuft alles weiter.`
							: `Verlängert sich am ${dateOf(standing.currentPeriodEnd)}.`}
					</p>
				{/if}

				<!-- Kündigen / Fortsetzen: one obvious button, as easy as booking. -->
				<div class="pt-1">
					{#if standing.cancelAtPeriodEnd}
						<button
							type="button"
							onclick={resume}
							disabled={busy !== ''}
							class="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
						>
							{busy === 'resume' ? 'Einen Moment …' : 'Fortsetzen'}
						</button>
					{:else if confirming === 'cancel'}
						<div class="flex flex-col gap-2">
							<p class="text-xs opacity-70">
								Dein Plan endet zum Ablauf des bezahlten Zeitraums{standing.currentPeriodEnd
									? ` am ${dateOf(standing.currentPeriodEnd)}`
									: ''}. Bis dahin ändert sich nichts.
							</p>
							<div class="flex gap-2">
								<button
									type="button"
									onclick={cancel}
									disabled={busy !== ''}
									class="rounded-full bg-error px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
								>
									{busy === 'cancel' ? 'Einen Moment …' : 'Kündigung bestätigen'}
								</button>
								<button
									type="button"
									onclick={() => (confirming = null)}
									class="rounded-full border border-border px-4 py-2 text-sm"
								>
									Abbrechen
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (confirming = 'cancel')}
							disabled={busy !== ''}
							class="rounded-full border border-border px-4 py-2 text-sm font-medium opacity-70 transition-colors hover:bg-error/5 hover:opacity-100 disabled:opacity-40"
						>
							Kündigen
						</button>
					{/if}
				</div>
			</div>
		{/if}

		{#if pending}
			<p
				class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-70 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				{pending}
			</p>
		{/if}

		<!-- Plan wählen / ändern: the in-app pricing UI, from the same SSOT the
		     website renders — settings and website cannot disagree on a price. -->
		<div class="flex flex-col gap-2">
			<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">
				{standing && !['canceled', 'expired'].includes(standing.status)
					? 'Plan ändern'
					: 'Plan wählen'}
			</p>
			<div class="flex flex-col gap-3 sm:flex-row">
				{#each TIER_PLANS as p (p.id)}
					{@render planCard(p)}
				{/each}
			</div>
		</div>

		<!-- Rechnungen: the detail renders IN-APP from real transaction data
		     (net/USt./gross, period). The official document stays Creem's — as
		     merchant of record it issues the invoices; the portal button leads
		     there for downloads, Rechnungsadresse and USt.-Angaben. -->
		<div class="flex flex-col gap-2">
			<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Rechnungen</p>
			{#if invoices.length}
				<ul
					class="flex flex-col divide-y divide-foreground/5 rounded-xl border border-foreground/5 bg-surface-raised shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					{#each invoices as invoice (invoice.id)}
						<li class="flex flex-col">
							<button
								type="button"
								onclick={() => (openInvoice = openInvoice === invoice.id ? null : invoice.id)}
								class="flex items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-primary/5"
							>
								<span class="opacity-60">{dateOf(invoice.createdAt)}</span>
								<span class="font-medium">
									{cents(invoice.amountCents)}
									{invoice.currency === 'EUR' ? '€' : invoice.currency}
								</span>
								<span class="opacity-50"
									>{invoice.status === 'paid' ? 'Bezahlt' : invoice.status}</span
								>
								<span class="opacity-30">{openInvoice === invoice.id ? '▴' : '▾'}</span>
							</button>
							{#if openInvoice === invoice.id}
								<div
									class="flex flex-col gap-1.5 border-t border-foreground/5 bg-primary/[0.02] px-4 py-3 text-xs"
								>
									{#if invoice.periodStart && invoice.periodEnd}
										<div class="flex justify-between gap-4">
											<span class="opacity-40">Zeitraum</span>
											<span>{dateOf(invoice.periodStart)} – {dateOf(invoice.periodEnd)}</span>
										</div>
									{/if}
									<div class="flex justify-between gap-4">
										<span class="opacity-40">Netto</span>
										<span>{cents(invoice.amountCents - invoice.taxCents)} €</span>
									</div>
									<div class="flex justify-between gap-4">
										<span class="opacity-40">USt.</span>
										<span>{cents(invoice.taxCents)} €</span>
									</div>
									<div class="flex justify-between gap-4 font-medium">
										<span class="opacity-40">Gesamt</span>
										<span>{cents(invoice.amountCents)} €</span>
									</div>
									<div class="flex justify-between gap-4">
										<span class="opacity-40">Beleg-Nr.</span>
										<span class="font-mono opacity-60">{invoice.id}</span>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p
					class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-50 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					Noch keine Zahlungen — sobald du etwas buchst, steht hier deine Historie.
				</p>
			{/if}
			<div class="flex flex-col gap-1">
				<button
					type="button"
					onclick={openPortal}
					disabled={busy !== '' || !isTauri()}
					class="self-start rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
				>
					{busy === 'portal' ? 'Einen Moment …' : 'Offizielle Rechnungen (PDF) öffnen'}
				</button>
				<p class="text-[0.6875rem] opacity-40">
					Die offiziellen Rechnungsdokumente stellt Creem als Händler aus — Download,
					Rechnungsadresse und USt.-Angaben verwaltest du im Creem-Portal.
				</p>
			</div>
		</div>
	{/if}

	{#if failure}
		<p class="rounded-xl border border-error/30 bg-error-muted px-4 py-3 text-xs text-error-strong">
			{failure}
		</p>
	{/if}
</section>
