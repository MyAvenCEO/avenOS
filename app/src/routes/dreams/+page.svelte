<script lang="ts">
import IntentComposer from '$lib/intent-mock/IntentComposer.svelte'
import { t } from '$lib/i18n'
import {
	contentMaxWidthClass,
	mobileActionVeilClass,
	mobileMainBottomPadClass
} from '$lib/shell'

/**
 * A founder-customer wish: a feature, bug, idea or request, captured with a
 * measurable metric describing what it solves / optimizes / fixes.
 */
type Wish = {
	id: string
	title: string
	description: string
	/** The measurable outcome this wish solves, optimizes, or fixes. */
	metric: string
}

/** In-memory mock data — no persistence, resets on reload. */
const SEED_WISHLIST: Wish[] = [
	{
		id: 'w-1',
		title: 'Bulk-approve pending invoices',
		description:
			'Let me select several invoices and approve them in one action instead of opening each one.',
		metric: 'Cut invoice approval time from ~4 min to <30 s per batch of 10.'
	},
	{
		id: 'w-2',
		title: 'Voice capture drops the last word',
		description:
			'When dictating a quick note the final word is sometimes cut off before it lands.',
		metric: 'Reduce dictation transcription errors from ~8% to <1% of notes.'
	},
	{
		id: 'w-3',
		title: 'Weekly digest of open intents',
		description:
			'A Monday-morning summary of everything still waiting on me, grouped by status.',
		metric: 'Lift weekly intent follow-through from 62% to 85%.'
	}
]

const SEED_NEXT_UP: Wish[] = [
	{
		id: 'n-1',
		title: 'Dark-mode for the board',
		description: 'A low-glare theme for late-night triage sessions.',
		metric: 'Increase after-hours session length by 20% without eye-strain complaints.'
	},
	{
		id: 'n-2',
		title: 'Keyboard shortcuts for column moves',
		description: 'Promote a wish from Wishlist to Next Up without reaching for the mouse.',
		metric: 'Reduce triage clicks per wish from 3 to 1.'
	}
]

/** Dummy metric outcomes cycled through for newly submitted wishes. */
const MOCK_METRICS = [
	'Reduce time-to-resolution by an estimated 25%.',
	'Improve weekly active retention by ~10%.',
	'Cut manual steps from 5 to 2 per task.',
	'Lower support tickets on this flow by 30%.',
	'Raise task completion rate from 70% to 90%.'
]

let wishlist = $state<Wish[]>([...SEED_WISHLIST])
let nextUp = $state<Wish[]>([...SEED_NEXT_UP])

let seq = $state(0)
let metricCursor = $state(0)

let composerMode = $state<'collapsed' | 'listening' | 'typing' | 'preparing'>('collapsed')

/** Dummy-fill the Wishlist from a voice/text submission. */
function handleSubmit(text: string, _files: File[]): void {
	const trimmed = text.trim()
	if (!trimmed) return
	seq += 1
	// First line / sentence becomes the title; the rest seeds the description.
	const firstBreak = trimmed.search(/[.\n]/)
	const title = (firstBreak > 0 ? trimmed.slice(0, firstBreak) : trimmed).trim()
	const rest = firstBreak > 0 ? trimmed.slice(firstBreak + 1).trim() : ''
	const metric = MOCK_METRICS[metricCursor % MOCK_METRICS.length]
	metricCursor += 1
	const wish: Wish = {
		id: `w-new-${seq}`,
		title: title.length > 80 ? `${title.slice(0, 79)}…` : title,
		description: rest || 'Captured from the founder-customer — pending triage.',
		metric
	}
	wishlist = [wish, ...wishlist]
}
</script>

<svelte:head>
	<title>{t('dreams.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<main
	class={`${contentMaxWidthClass} flex min-h-0 flex-1 flex-col overflow-y-auto px-3 ${mobileMainBottomPadClass} sm:px-5 sm:pb-28`}
>
	<div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 py-6 sm:py-8">
		<header class="space-y-1.5 px-1">
			<h1 class="text-2xl font-semibold tracking-tight">{t('dreams.title')}</h1>
			<p class="text-muted-foreground text-sm">{t('dreams.subtitle')}</p>
		</header>

		<div
			class="border-border bg-card grid flex-1 grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border sm:grid-cols-2"
		>
			<!-- Left column: Wishlist (filled by voice / text submissions) -->
			<section class="bg-card flex min-w-0 flex-col">
				<div class="border-border/60 border-b px-4 py-3">
					<h2 class="text-sm font-semibold tracking-tight">{t('dreams.wishlist')}</h2>
					<p class="text-muted-foreground text-[12px]">{t('dreams.wishlistHint')}</p>
				</div>
				<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
					{#if wishlist.length === 0}
						<p class="text-muted-foreground px-1 py-6 text-center text-sm">
							{t('dreams.empty')}
						</p>
					{:else}
						{#each wishlist as wish (wish.id)}
							<article
								class="border-border/70 bg-background/40 rounded-[var(--radius-md)] border border-l-[4px] border-l-primary/70 p-3"
							>
								<h3 class="text-sm font-semibold leading-snug">{wish.title}</h3>
								<p class="text-muted-foreground mt-1 text-[13px] leading-relaxed">
									{wish.description}
								</p>
								<p class="mt-2 text-[12px] font-medium leading-relaxed text-primary/90">
									<span class="text-muted-foreground/80 uppercase tracking-wider text-[10px]"
										>{t('dreams.metricLabel')}</span
									><br />
									{wish.metric}
								</p>
							</article>
						{/each}
					{/if}
				</div>
			</section>

			<!-- Right column: Next Up -->
			<section class="bg-card flex min-w-0 flex-col">
				<div class="border-border/60 border-b px-4 py-3">
					<h2 class="text-sm font-semibold tracking-tight">{t('dreams.nextUp')}</h2>
					<p class="text-muted-foreground text-[12px]">{t('dreams.nextUpHint')}</p>
				</div>
				<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
					{#if nextUp.length === 0}
						<p class="text-muted-foreground px-1 py-6 text-center text-sm">
							{t('dreams.empty')}
						</p>
					{:else}
						{#each nextUp as wish (wish.id)}
							<article
								class="border-border/70 bg-background/40 rounded-[var(--radius-md)] border border-l-[4px] border-l-status-working p-3"
							>
								<h3 class="text-sm font-semibold leading-snug">{wish.title}</h3>
								<p class="text-muted-foreground mt-1 text-[13px] leading-relaxed">
									{wish.description}
								</p>
								<p class="mt-2 text-[12px] font-medium leading-relaxed text-status-working">
									<span class="text-muted-foreground/80 uppercase tracking-wider text-[10px]"
										>{t('dreams.metricLabel')}</span
									><br />
									{wish.metric}
								</p>
							</article>
						{/each}
					{/if}
				</div>
			</section>
		</div>
	</div>
</main>

<!-- Bottom intent composer area — same cluster the Intents & Talk screens use -->
<div
	class={`pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex justify-center bg-gradient-to-t from-background via-background/88 to-transparent px-3 ${mobileActionVeilClass} sm:from-55% sm:px-5 sm:pt-3 sm:pb-5`}
>
	<div
		class={`pointer-events-auto relative flex w-full items-center ${contentMaxWidthClass} sm:pl-0 sm:pr-0 ${composerMode === 'typing' ? 'max-sm:px-1' : 'max-sm:px-3'}`}
	>
		<div class="flex min-w-0 flex-1 items-center justify-center gap-2 sm:gap-3">
			<IntentComposer
				onSubmitMessage={handleSubmit}
				placeholder={t('dreams.composerPlaceholder')}
				onModeChange={(m) => {
					composerMode = m
				}}
			/>
		</div>
	</div>
</div>
