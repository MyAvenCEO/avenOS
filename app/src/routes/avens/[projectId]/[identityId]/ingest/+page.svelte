<script lang="ts">
import { t } from '$lib/i18n'
import ImportCsvButton from '$lib/ingestor/ImportCsvButton.svelte'
import { ordersFlow, type StageStatus } from '$lib/ingestor/orders-store.svelte'

function stageLabel(name: string): string {
	return t(`avens.ingest.stage.${name}`)
}

function statusClasses(status: StageStatus): string {
	switch (status) {
		case 'done':
			return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
		case 'running':
			return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 animate-pulse'
		case 'error':
			return 'bg-red-500/15 text-red-600 dark:text-red-400'
		default:
			return 'bg-muted text-muted-foreground'
	}
}

function dotClasses(status: StageStatus): string {
	switch (status) {
		case 'done':
			return 'bg-emerald-500 border-emerald-500'
		case 'running':
			return 'bg-sky-500 border-sky-500 animate-pulse'
		case 'error':
			return 'bg-red-500 border-red-500'
		default:
			return 'bg-card border-border'
	}
}

function fmtData(data: unknown): string {
	if (data === undefined) return ''
	try {
		const s = JSON.stringify(data)
		return s.length > 160 ? `${s.slice(0, 160)}…` : s
	} catch {
		return String(data)
	}
}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-1">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('nav.ingest')}</h1>
			<div class="ml-auto"><ImportCsvButton /></div>
		</div>
		<p class="text-muted-foreground text-sm">{t('avens.ingest.subtitle')}</p>
		{#if ordersFlow.fileName}
			<p class="text-muted-foreground text-xs">
				{t('avens.ingest.sourceFile')}: <span class="font-mono">{ordersFlow.fileName}</span>
			</p>
		{/if}
	</header>

	<!-- Flow: stages top → bottom -->
	<ol class="relative flex flex-col">
		{#each ordersFlow.stages as node, i (node.name)}
			<li class="relative flex gap-3 pb-5 last:pb-0">
				{#if i < ordersFlow.stages.length - 1}
					<span class="bg-border absolute top-6 left-[11px] h-full w-px"></span>
				{/if}
				<span
					class="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold {dotClasses(
						node.status
					)}"
				>
					{i + 1}
				</span>
				<div class="border-input flex-1 rounded-lg border bg-card/40 px-3 py-2">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-medium">{stageLabel(node.name)}</span>
						<span
							class="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase {statusClasses(
								node.status
							)}"
						>
							{t(`avens.ingest.status.${node.status}`)}
						</span>
						{#if node.durationMs !== undefined}
							<span class="text-muted-foreground ml-auto font-mono text-[11px]"
								>{node.durationMs}
								ms</span
							>
						{/if}
					</div>
					{#if node.detail}
						<p class="text-muted-foreground mt-1 text-[11px]">{node.detail}</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>

	{#if ordersFlow.error}
		<div
			class="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400"
		>
			{ordersFlow.error}
		</div>
	{/if}

	<!-- Report summary -->
	{#if ordersFlow.report}
		{@const rep = ordersFlow.report}
		<section class="border-input rounded-xl border bg-card/40 p-3">
			<h2 class="mb-2 text-sm font-semibold">{t('avens.ingest.result')}</h2>
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
				<dt class="text-muted-foreground">{t('avens.ingest.runId')}</dt>
				<dd class="font-mono">{rep.runId}</dd>
				<dt class="text-muted-foreground">{t('avens.ingest.fileId')}</dt>
				<dd class="font-mono break-all">{rep.fileId}</dd>
				<dt class="text-muted-foreground">{t('avens.ingest.hash')}</dt>
				<dd class="font-mono break-all">{rep.contentSha256.slice(0, 24)}…</dd>
				<dt class="text-muted-foreground">{t('avens.ingest.duplicate')}</dt>
				<dd>{rep.duplicateFile ? t('common.true') : t('common.false')}</dd>
			</dl>
			<div class="mt-3 flex flex-wrap gap-2">
				{#each ordersFlow.stats as s (s.target)}
					<span class="border-input rounded-lg border px-2 py-1 text-[11px]">
						<span class="font-medium">{s.target}</span>
						<span class="text-emerald-600 dark:text-emerald-400">+{s.added}</span>
						<span class="text-muted-foreground">/ ~{s.skipped}</span>
					</span>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Log stream -->
	<section class="flex min-h-0 flex-col">
		<h2 class="mb-2 text-sm font-semibold">{t('avens.ingest.logs')}</h2>
		{#if ordersFlow.logs.length === 0}
			<p class="text-muted-foreground/70 text-[11px]">{t('avens.ingest.noLogs')}</p>
		{:else}
			<ul
				class="border-input max-h-72 overflow-auto rounded-lg border bg-card/40 p-2 font-mono text-[11px] leading-relaxed"
			>
				{#each ordersFlow.logs as entry (entry.seq)}
					<li class="flex gap-2">
						<span class="text-muted-foreground/70 shrink-0">[{entry.stage}]</span>
						<span class="flex-1">{entry.message}</span>
						{#if entry.data !== undefined}
							<span class="text-muted-foreground/60 hidden shrink-0 sm:inline"
								>{fmtData(entry.data)}</span
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
