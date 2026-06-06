<script lang="ts">
import { t } from '$lib/i18n'
import { formatEur, founderStatus } from './dashboard-data'

const s = founderStatus()
const nextLevel = s.level.level + 1
const progressPct = Math.round(s.level.progress * 100)

// The single easiest move to raise the ratio: cut hours OR pull more payout.
const move = $derived(
	s.next.easier === 'hours'
		? `−${s.next.cutHours.toFixed(1)} ${t('avens.dashboard.founder.hoursUnit')}`
		: `+${formatEur(s.next.addCash)}${t('avens.dashboard.perWeekSuffix')}`
)
const target = $derived(`${formatEur(s.next.rate)}${t('avens.dashboard.founder.perHourUnit')}`)
</script>

<section class="border-input flex flex-col gap-6 rounded-xl border bg-card/40 p-6">
	<!-- The one number: cashflow per hour worked -->
	<div>
		<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
			{t('avens.dashboard.ratio')}
		</p>
		<p class="mt-1 flex items-baseline gap-1.5">
			<span class="text-5xl font-semibold tabular-nums">{formatEur(s.perHour)}</span>
			<span class="text-muted-foreground text-base">{t('avens.dashboard.founder.perHourUnit')}</span>
		</p>
	</div>

	<!-- Progress toward the next rung -->
	<div class="space-y-1.5">
		<div class="flex items-baseline justify-between text-xs">
			<span class="font-semibold">{t('avens.dashboard.founder.lvlShort')} {s.level.level}</span>
			<span class="text-muted-foreground tabular-nums">
				{t('avens.dashboard.founder.toNext', { pct: progressPct, n: nextLevel })} · {target}
			</span>
		</div>
		<div class="bg-muted h-2 overflow-hidden rounded-full">
			<div class="h-full rounded-full bg-emerald-500" style="width: {progressPct}%"></div>
		</div>
	</div>

	<!-- Single CTA: the one move that raises the ratio -->
	<button
		type="button"
		class="group flex items-center justify-between gap-4 rounded-xl bg-emerald-500 px-5 py-4 text-left text-white transition-colors hover:bg-emerald-600"
	>
		<span class="flex min-w-0 flex-col">
			<span class="text-[11px] font-semibold tracking-wide text-white/80 uppercase">
				{t('avens.dashboard.ctaLabel')}
			</span>
			<span class="text-lg font-semibold tabular-nums">{move} → {target}</span>
		</span>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5"
			aria-hidden="true"
		>
			<path d="M5 12h14M13 6l6 6-6 6" />
		</svg>
	</button>
</section>
