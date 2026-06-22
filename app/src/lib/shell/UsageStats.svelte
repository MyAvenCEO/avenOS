<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import { fmtMindsExact } from '$lib/billing/minds'
import { getLocale, t } from '$lib/i18n'
import { qk } from '$lib/query/client'
import { fetchRecentUsage, fetchUsage } from '$lib/query/usage'

// Usage section (board 0055): the signed-in user's token usage (this week + all time) and what
// each AI request roundtrip cost in MINDS. Both read live via TanStack Query — the SSE 'usage'
// event (published after every completion) invalidates the `usage` prefix, so this updates with
// no manual refresh.
const usageQuery = createQuery(() => ({ queryKey: qk.usage, queryFn: fetchUsage }))
const recentQuery = createQuery(() => ({ queryKey: qk.usageRecent, queryFn: fetchRecentUsage }))
const stats = $derived(usageQuery.data ?? null)
const recent = $derived(recentQuery.data ?? [])
const loading = $derived(usageQuery.isLoading || recentQuery.isLoading)

function fmtNum(n: number): string {
	return n.toLocaleString(getLocale())
}
function fmtTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString(getLocale(), {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		})
	} catch {
		return iso
	}
}
// Drop any provider prefix (e.g. "tinfoil/llama-3.3-70b" → "llama-3.3-70b") for a tidy label.
function shortModel(model: string): string {
	return model.split('/').pop() ?? model
}
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
	<header class="flex flex-col gap-1">
		<h2 class="text-foreground text-base font-semibold">{t('mainnet.usage.title')}</h2>
		<p class="text-muted-foreground text-[13px] leading-relaxed">{t('mainnet.usage.subtitle')}</p>
	</header>

	<div class="grid grid-cols-2 gap-3">
		<div class="border-border bg-card flex flex-col gap-1 rounded-[var(--radius-lg)] border p-4">
			<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
				{t('mainnet.usage.week')}
			</span>
			<span class="text-foreground text-xl font-semibold tabular-nums">
				{fmtMindsExact(stats?.week.costUsd ?? 0, getLocale())}
			</span>
			<span class="text-muted-foreground text-[12px] tabular-nums">
				{fmtNum(stats?.week.tokens ?? 0)} {t('mainnet.usage.tokens')}
			</span>
		</div>
		<div class="border-border bg-card flex flex-col gap-1 rounded-[var(--radius-lg)] border p-4">
			<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
				{t('mainnet.usage.allTime')}
			</span>
			<span class="text-foreground text-xl font-semibold tabular-nums">
				{fmtMindsExact(stats?.total.costUsd ?? 0, getLocale())}
			</span>
			<span class="text-muted-foreground text-[12px] tabular-nums">
				{fmtNum(stats?.total.tokens ?? 0)} {t('mainnet.usage.tokens')}
			</span>
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
			{t('mainnet.usage.requests')}
		</span>
		{#if loading}
			<p class="text-muted-foreground text-[13px]">{t('mainnet.usage.loading')}</p>
		{:else if recent.length === 0}
			<p
				class="border-border text-muted-foreground rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center text-[13px]"
			>
				{t('mainnet.usage.empty')}
			</p>
		{:else}
			<div
				class="border-border divide-border/60 divide-y overflow-hidden rounded-[var(--radius-lg)] border"
			>
				{#each recent as r (r.id)}
					<div class="flex items-center justify-between gap-3 px-3 py-2.5">
						<div class="min-w-0">
							<div class="text-foreground truncate text-[13px] font-medium">
								{shortModel(r.model)}
							</div>
							<div class="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
								{fmtTime(r.createdAt)}
								· {fmtNum(r.promptTokens)}
								{t('mainnet.usage.in')}
								/ {fmtNum(r.completionTokens)}
								{t('mainnet.usage.out')}
							</div>
						</div>
						<span class="text-foreground shrink-0 text-[13px] font-semibold tabular-nums">
							{fmtMindsExact(r.costUsd, getLocale())}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
