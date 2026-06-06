<script lang="ts">
import { t } from '$lib/i18n'
import { levelLadder } from '$lib/leveling'
import { formatEur } from '../orders/orders-data'
import { founderStatus } from './dashboard-data'
import FounderLevers from './FounderLevers.svelte'

const s = founderStatus()
const nextLevel = s.level.level + 1
const progressPct = Math.round(s.level.progress * 100)

// Full level history: cleared levels behind, current, next, and locked ahead.
const ladder = levelLadder(s.perHour, { direction: 'up', lookahead: 5 })
const cleared = ladder.filter((c) => c.state === 'cleared').length
const chip = (v: number) => `€${v}`

// Progress-ring geometry.
const R = 26
const C = 2 * Math.PI * R
const dashOffset = C * (1 - s.level.progress)
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
	<header class="space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">{t('nav.dashboard')}</h1>
		<p class="text-muted-foreground text-sm">{t('avens.dashboard.subtitle')}</p>
	</header>

	<section class="border-input rounded-xl border bg-card/40 p-5">
		<!-- Score + level ring -->
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('avens.dashboard.founder.perHour')}</p>
				<p class="mt-1 flex items-baseline gap-1.5">
					<span class="text-4xl font-semibold tabular-nums">{formatEur(s.perHour)}</span>
					<span class="text-muted-foreground text-sm">{t('avens.dashboard.founder.perHourUnit')}</span>
				</p>
				<p class="text-muted-foreground mt-1.5 text-xs tabular-nums">
					{t('avens.dashboard.founder.toNext', { pct: progressPct, n: nextLevel })} · {formatEur(s.next.rate)}{t('avens.dashboard.founder.perHourUnit')}
				</p>
			</div>
			<div class="relative h-16 w-16 shrink-0">
				<svg viewBox="0 0 64 64" class="h-16 w-16 -rotate-90">
					<circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" stroke-width="6" class="text-border/50" />
					<circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" class="text-emerald-500" stroke-dasharray={C} stroke-dashoffset={dashOffset} />
				</svg>
				<span class="absolute inset-0 flex flex-col items-center justify-center leading-none">
					<span class="text-muted-foreground text-[8px] font-medium uppercase">{t('avens.dashboard.founder.lvlShort')}</span>
					<span class="text-lg font-semibold tabular-nums">{s.level.level}</span>
				</span>
			</div>
		</div>

		<!-- The two levers: current state + the move to the next level -->
		<div class="mt-4 border-t border-border/50 pt-3">
			<FounderLevers {s} />
		</div>
	</section>

	<!-- Level history: how far you've climbed, and what's ahead -->
	<section class="border-input rounded-xl border bg-card/40 p-4">
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			<h2 class="text-sm font-semibold tracking-tight">{t('avens.dashboard.ladderTitle')}</h2>
			<span class="text-muted-foreground text-xs tabular-nums">{t('avens.dashboard.ladderCleared', { count: cleared })}</span>
		</div>
		<div class="mt-3 grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(3.75rem, 1fr))">
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
					<span class="text-[9px] font-semibold tracking-wide uppercase opacity-80">L{cell.level}</span>
					<span class="text-xs font-semibold tabular-nums leading-none">{chip(cell.value)}</span>
					<span class="flex h-4 items-center justify-center text-[8px] font-semibold uppercase tracking-wide leading-none">
						{#if cell.state === 'cleared'}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5" aria-hidden="true">
								<path d="M5 13l4 4L19 7" />
							</svg>
						{:else if cell.state === 'current'}{t('avens.dashboard.founder.now')}
						{:else if cell.state === 'next'}{t('avens.dashboard.founder.next')}
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
								<g fill="none">
									<path fill="currentColor" fill-opacity=".25" d="M4 12c0-.943 0-1.414.293-1.707S5.057 10 6 10h12c.943 0 1.414 0 1.707.293S20 11.057 20 12v6.038c0 .38 0 .571-.029.74a2 2 0 0 1-1.164 1.49c-.156.07-.341.116-.71.208c-1.238.31-1.857.464-2.476.578c-2.394.44-4.848.44-7.243 0c-.618-.114-1.237-.269-2.474-.578c-.37-.092-.555-.139-.71-.207a2 2 0 0 1-1.165-1.492C4 18.61 4 18.42 4 18.037z" />
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
	</section>
</div>
