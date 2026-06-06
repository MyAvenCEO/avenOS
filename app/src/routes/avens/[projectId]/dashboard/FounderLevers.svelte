<script lang="ts">
import { t } from '$lib/i18n'
import { formatEur, type FounderStatus } from './dashboard-data'

let { s }: { s: FounderStatus } = $props()
const magPct = (v: number) => `${Math.abs(v * 100).toFixed(0)}%`
</script>

<div class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
	<!-- Work less -->
	<div>
		<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('avens.dashboard.founder.hours')}</p>
		<p class="mt-0.5 flex items-baseline gap-1.5">
			<span class="text-xl font-semibold tabular-nums">{s.hours}</span>
			<span class="text-muted-foreground text-xs">{t('avens.dashboard.founder.hoursUnit')}</span>
			<span class="text-emerald-600 text-xs font-semibold tabular-nums">↓{magPct(s.hoursDelta)}</span>
		</p>
		<p class="mt-1.5 text-sm font-semibold tabular-nums {s.next.easier === 'hours' ? 'text-emerald-600' : ''}">
			→ {s.next.hoursTarget.toFixed(1)} {t('avens.dashboard.founder.hoursUnit')}
		</p>
		<p class="text-muted-foreground text-[11px] tabular-nums">
			−{s.next.cutHours.toFixed(1)} h{#if s.next.easier === 'hours'} · <span class="font-semibold text-emerald-600">{t('avens.dashboard.founder.easiest')}</span>{/if}
		</p>
	</div>

	<!-- Pull more cash -->
	<div>
		<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('avens.dashboard.founder.draw')}</p>
		<p class="mt-0.5 flex items-baseline gap-1.5">
			<span class="text-xl font-semibold tabular-nums text-emerald-600">{formatEur(s.cashflow)}</span>
			<span class="text-emerald-600 text-xs font-semibold tabular-nums">↑{magPct(s.cashDelta)}</span>
		</p>
		<p class="mt-1.5 text-sm font-semibold tabular-nums {s.next.easier === 'cash' ? 'text-emerald-600' : ''}">
			→ {formatEur(s.next.cashTarget)}{t('avens.dashboard.perWeekSuffix')}
		</p>
		<p class="text-muted-foreground text-[11px] tabular-nums">
			+{formatEur(s.next.addCash)}{#if s.next.easier === 'cash'} · <span class="font-semibold text-emerald-600">{t('avens.dashboard.founder.easiest')}</span>{/if}
		</p>
	</div>
</div>
