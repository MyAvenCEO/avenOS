<script lang="ts">
import { t } from '$lib/i18n'
import { levelLadder } from '$lib/leveling'
import { formatEur, founderStatus } from './dashboard-data'

const s = founderStatus()
const nextLevel = s.level.level + 1
const progressPct = Math.round(s.level.progress * 100)

// Full level history: cleared rungs behind, current, next, and locked ahead.
const ladder = levelLadder(s.perHour, { direction: 'up', lookahead: 5 })
const cleared = ladder.filter((c) => c.state === 'cleared').length
const chip = (v: number) => `€${v}`
</script>

<section class="border-input flex flex-col gap-6 rounded-xl border bg-card/40 p-6">
	<!-- The one number: cashflow per hour worked -->
	<div>
		<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
			{t('avens.dashboard.ratio')}
		</p>
		<p class="mt-1 flex items-baseline gap-1.5">
			<span class="text-5xl font-semibold tabular-nums">{formatEur(s.perHour)}</span>
			<span class="text-muted-foreground text-base"
				>{t('avens.dashboard.founder.perHourUnit')}</span
			>
		</p>
	</div>

	<!-- Progress toward the next rung -->
	<div class="space-y-1.5">
		<div class="flex items-baseline justify-between text-xs">
			<span class="font-semibold">{t('avens.dashboard.founder.lvlShort')} {s.level.level}</span>
			<span class="text-muted-foreground tabular-nums">
				{t('avens.dashboard.founder.toNext', { pct: progressPct, n: nextLevel })}
				· {formatEur(s.next.rate)}{t('avens.dashboard.founder.perHourUnit')}
			</span>
		</div>
		<div class="bg-muted h-2 overflow-hidden rounded-full">
			<div class="h-full rounded-full bg-emerald-500" style="width: {progressPct}%"></div>
		</div>
	</div>

	<!-- The climb: cleared / now / next / locked at a glance -->
	<div class="border-t border-border/50 pt-4">
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-semibold tracking-tight">{t('avens.dashboard.ladderTitle')}</h2>
			<span class="text-muted-foreground text-xs tabular-nums"
				>{t('avens.dashboard.ladderCleared', { count: cleared })}</span
			>
		</div>
		<div
			class="mt-3 grid gap-2"
			style="grid-template-columns: repeat(auto-fill, minmax(3.75rem, 1fr))"
		>
			{#each ladder as cell (cell.level)}
				<div
					class="flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-2 text-center
						{cell.state === 'cleared'
						? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
						: cell.state === 'current'
							? 'border-emerald-600 bg-emerald-500 text-white shadow-sm ring-2 ring-emerald-500/30'
							: cell.state === 'next'
								? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400'
								: 'border-border/50 bg-muted/30 text-muted-foreground/60'}"
					title={`L${cell.level} · ${chip(cell.value)}`}
				>
					<span class="text-[9px] font-semibold tracking-wide uppercase opacity-80"
						>L{cell.level}</span
					>
					<span class="text-xs font-semibold tabular-nums leading-none">{chip(cell.value)}</span>
					<span
						class="flex h-4 items-center justify-center text-[8px] font-semibold uppercase tracking-wide leading-none"
					>
						{#if cell.state === 'cleared'}
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="h-3.5 w-3.5"
								aria-hidden="true"
							>
								<path d="M5 13l4 4L19 7" />
							</svg>
						{:else if cell.state === 'current'}
							{t('avens.dashboard.founder.now')}
						{:else if cell.state === 'next'}
							{t('avens.dashboard.founder.next')}
						{:else}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								class="h-4 w-4"
								aria-hidden="true"
							>
								<g fill="none">
									<path
										fill="currentColor"
										fill-opacity=".25"
										d="M4 12c0-.943 0-1.414.293-1.707S5.057 10 6 10h12c.943 0 1.414 0 1.707.293S20 11.057 20 12v6.038c0 .38 0 .571-.029.74a2 2 0 0 1-1.164 1.49c-.156.07-.341.116-.71.208c-1.238.31-1.857.464-2.476.578c-2.394.44-4.848.44-7.243 0c-.618-.114-1.237-.269-2.474-.578c-.37-.092-.555-.139-.71-.207a2 2 0 0 1-1.165-1.492C4 18.61 4 18.42 4 18.037z"
									/>
									<path stroke="currentColor" d="M16.5 10V9a4.5 4.5 0 1 0-9 0v1" />
									<circle cx="12" cy="15" r="2" fill="currentColor" />
									<path stroke="currentColor" stroke-linecap="round" d="M12 16v2.5" />
								</g>
							</svg>
						{/if}
					</span>
				</div>
			{/each}
		</div>
	</div>
</section>
