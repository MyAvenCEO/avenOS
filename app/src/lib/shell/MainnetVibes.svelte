<script lang="ts">
import Composer from '$lib/composer/Composer.svelte'
import { t } from '$lib/i18n'
import BookingsVibe from '$lib/shell/BookingsVibe.svelte'
import BookkeepingVibe from '$lib/shell/BookkeepingVibe.svelte'
import DocCompareVibe from '$lib/shell/DocCompareVibe.svelte'
import FinanceVibe from '$lib/shell/FinanceVibe.svelte'
import InvoiceBookingVibe from '$lib/shell/InvoiceBookingVibe.svelte'
import InvoiceMatchVibe from '$lib/shell/InvoiceMatchVibe.svelte'
import TodosVibe from '$lib/shell/TodosVibe.svelte'
import TransactionsVibe from '$lib/shell/TransactionsVibe.svelte'

// Mainnet "Vibes" tab: a left "select vibe" rail + the selected vibe. Vibes are the dynamic
// aven-vibes views (TodosVibe, BookkeepingVibe, DocCompareVibe, InvoiceMatchVibe) plus the
// website Composer. board 0054/0055/0063/0064/0066.
const VIBES: { id: string; label: string }[] = [
	{ id: 'todos', label: t('mainnet.todos.title') },
	{ id: 'composer', label: t('mainnet.nav.composer') },
	{ id: 'bookkeeping', label: t('mainnet.bookkeeping.title') },
	{ id: 'doc-compare', label: t('mainnet.docCompare.title') },
	{ id: 'invoice-match', label: t('mainnet.invoiceMatch.title') },
	{ id: 'invoice-booking', label: t('mainnet.invoiceBooking.title') },
	{ id: 'tx', label: t('mainnet.transactions.title') },
	{ id: 'booking', label: t('mainnet.bookings.title') },
	{ id: 'bwa', label: t('mainnet.finance.title') }
]
let selectedVibe = $state('todos')
</script>

<div class="flex min-h-0 flex-1">
	<!-- Left: select vibe viewer -->
	<aside class="border-border hidden w-48 shrink-0 flex-col border-r pt-3 sm:flex">
		<p class="text-muted-foreground px-3 pb-2 text-[10px] font-bold tracking-[0.14em] uppercase">
			{t('mainnet.vibes.select')}
		</p>
		<div class="min-h-0 flex-1 overflow-y-auto px-2">
			{#each VIBES as v (v.id)}
				<button
					type="button"
					class="mb-0.5 block w-full truncate rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] transition-colors {v.id ===
					selectedVibe
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (selectedVibe = v.id)}
				>
					{v.label}
				</button>
			{/each}
		</div>
	</aside>

	<!-- Right: the selected vibe (Composer renders full-bleed — it has its own chrome) -->
	<div class="flex min-h-0 flex-1 flex-col">
		{#if selectedVibe === 'todos'}
			<div class="flex min-h-0 flex-1 flex-col p-4">
				<TodosVibe containerName="aven-vibes-tab-todos" />
			</div>
		{:else if selectedVibe === 'composer'}
			<Composer />
		{:else if selectedVibe === 'bookkeeping'}
			<div class="flex min-h-0 flex-1 flex-col p-4">
				<BookkeepingVibe containerName="aven-vibes-tab-bookkeeping" />
			</div>
		{:else if selectedVibe === 'doc-compare'}
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				<DocCompareVibe containerName="aven-vibes-tab-doc-compare" />
			</div>
		{:else if selectedVibe === 'invoice-match'}
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				<InvoiceMatchVibe containerName="aven-vibes-tab-invoice-match" />
			</div>
		{:else if selectedVibe === 'invoice-booking'}
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				<InvoiceBookingVibe containerName="aven-vibes-tab-invoice-booking" />
			</div>
		{:else if selectedVibe === 'tx'}
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				<TransactionsVibe containerName="aven-vibes-tab-tx" />
			</div>
		{:else if selectedVibe === 'booking'}
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				<BookingsVibe containerName="aven-vibes-tab-booking" />
			</div>
		{:else if selectedVibe === 'bwa'}
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				<FinanceVibe containerName="aven-vibes-tab-bwa" />
			</div>
		{/if}
	</div>
</div>
