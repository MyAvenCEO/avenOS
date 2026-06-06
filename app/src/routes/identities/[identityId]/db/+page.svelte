<script lang="ts">
	import { page } from '$app/state'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import {
		jazzExplorerList,
		jazzExplorerSubscribe,
		jazzStatus,
		type JazzExplorerListReply,
	} from '$lib/jazz/api'
	import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
	import { withTimeoutMs } from '$lib/async-timeout'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'

	// Identity-scoped DB viewer: the global explorer, narrowed to THIS identity's rows.
	// Because every row provably belongs to exactly one identity (the signed owner
	// binding, gate-enforced), "show only this identity's data" is trustworthy — you
	// cannot see rows you don't hold a read cap for anyway.
	const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
	const decodedIdentityId = $derived(decodeURIComponent(identityParam))

	// Tables that carry an owning-identity column (manifest-aligned). Device-local,
	// non-identity tables (e.g. `humans`) never appear in a identity's data view.
	const SPARK_SCOPED_TABLES = ['identities', 'messages', 'todos', 'files', 'peers', 'keyshares']

	let tables = $state<string[]>([])
	let selectedTable = $state<string | null>(null)
	let allRows = $state<Record<string, unknown>[]>([])
	let skippedUnauthorizedRows = $state(0)
	let bootstrapErr = $state<string | undefined>()
	let explorerErr = $state<string | undefined>()
	let refreshBusy = $state(false)

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())
	const DB_IPC_BUDGET_MS = 12_000

	function idsMatch(a: unknown, b: string): boolean {
		return typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	// Only this identity's rows. The `identities` table matches on its own identity; every
	// other table matches on its owning-identity column (both are named `owner`).
	const explorerRows = $derived(allRows.filter((r) => idsMatch(r.owner, decodedIdentityId)))

	function buildColumns(rows: Record<string, unknown>[]): string[] {
		const s = new Set<string>()
		for (const row of rows) Object.keys(row).forEach((k) => s.add(k))
		const rest = [...s]
			.filter((k) => k !== 'id' && k !== '_encryptedColumns')
			.sort((a, b) => a.localeCompare(b))
		const out: string[] = []
		if (s.has('id')) out.push('id')
		out.push(...rest)
		if (s.has('_encryptedColumns')) out.push('_encryptedColumns')
		return out
	}
	const columns = $derived(buildColumns(explorerRows))

	const cellPreviewMax = 200

	function formatCell(
		column: string,
		value: unknown,
		row: Record<string, unknown>,
	): { text: string; title?: string } {
		if (column === 'content' && typeof value === 'string' && value.length > 0) {
			const n = value.length
			const sizeBytes = typeof row.size_bytes === 'number' ? row.size_bytes : undefined
			const hint = sizeBytes != null ? t('db.explorer.originalSize', { bytes: sizeBytes }) : ''
			return {
				text: t('db.explorer.sealedPayload', { chars: n, sizeHint: hint }),
				title: `${value.slice(0, 120)}…`,
			}
		}
		if (value === null || value === undefined) return { text: '' }
		if (typeof value === 'boolean') return { text: value ? t('common.true') : t('common.false') }
		if (typeof value === 'number') return { text: String(value) }
		if (typeof value === 'string') {
			const trimmed = value.length > cellPreviewMax ? `${value.slice(0, cellPreviewMax)}…` : value
			return value.length > cellPreviewMax ? { text: trimmed, title: value } : { text: trimmed }
		}
		try {
			const raw = JSON.stringify(value)
			const trimmed = raw.length > cellPreviewMax ? `${raw.slice(0, cellPreviewMax)}…` : raw
			return raw.length > cellPreviewMax ? { text: trimmed, title: raw } : { text: trimmed }
		} catch {
			return { text: String(value) }
		}
	}

	$effect(() => {
		if (!tauri || !unlocked) {
			tables = []
			selectedTable = null
			bootstrapErr = undefined
			return
		}
		let cancelled = false
		void (async () => {
			try {
				bootstrapErr = undefined
				await withTimeoutMs(
					waitForGrooveSessionReady(),
					DB_IPC_BUDGET_MS,
					t('errors.dbGrooveSessionStalled'),
				)
				if (cancelled) return
				const status = await withTimeoutMs(jazzStatus(), DB_IPC_BUDGET_MS, t('errors.dbJazzStatusStalled'))
				if (cancelled) return
				tables = (status.tables ?? []).filter((tbl) => SPARK_SCOPED_TABLES.includes(tbl))
				if (!status.ready) bootstrapErr = t('db.explorer.shellNotReady')
			} catch (e) {
				if (!cancelled) {
					bootstrapErr = e instanceof Error ? e.message : String(e)
					tables = []
				}
			}
		})()
		return () => {
			cancelled = true
		}
	})

	$effect(() => {
		if (tables.length === 0) {
			selectedTable = null
			return
		}
		if (selectedTable !== null && tables.includes(selectedTable)) return
		selectedTable = tables[0] ?? null
	})

	$effect(() => {
		const table = selectedTable
		if (!tauri || !unlocked || !table) {
			allRows = []
			skippedUnauthorizedRows = 0
			explorerErr = undefined
			return
		}
		let cancelled = false
		let unlisten: (() => void) | undefined
		void (async () => {
			try {
				explorerErr = undefined
				const reply: JazzExplorerListReply = await jazzExplorerList(table)
				if (cancelled) return
				allRows = reply.rows
				skippedUnauthorizedRows = reply.skippedUnauthorizedRows
			} catch (e) {
				if (!cancelled) explorerErr = e instanceof Error ? e.message : String(e)
			}
			unlisten?.()
			unlisten = await jazzExplorerSubscribe(table, (next) => {
				if (!cancelled) allRows = next
			})
			if (cancelled) unlisten?.()
		})()
		return () => {
			cancelled = true
			unlisten?.()
		}
	})

	async function refreshExplorer(): Promise<void> {
		if (!selectedTable || !tauri || !unlocked) return
		refreshBusy = true
		explorerErr = undefined
		try {
			const reply = await jazzExplorerList(selectedTable)
			allRows = reply.rows
			skippedUnauthorizedRows = reply.skippedUnauthorizedRows
		} catch (e) {
			explorerErr = e instanceof Error ? e.message : String(e)
		} finally {
			refreshBusy = false
		}
	}
</script>

<div class="flex min-h-0 w-full flex-1 flex-col gap-3">
	<header class="shrink-0 space-y-1">
		<h1 class="text-lg font-semibold tracking-tight">{t('nav.db')}</h1>
		<p class="text-muted-foreground text-xs leading-relaxed">
			{t('db.explorer.subtitle')}
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('db.explorer.needsDesktop')}</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">{t('db.explorer.unlockToLoad')}</p>
	{:else}
		{#if bootstrapErr}
			<p
				class="text-destructive border-destructive/40 bg-destructive/10 shrink-0 rounded-lg border px-3 py-2 text-sm leading-snug"
				role="alert"
			>
				{bootstrapErr}
			</p>
		{/if}

		<div class="flex shrink-0 flex-wrap items-center gap-1.5">
			{#each tables as tableName (tableName)}
				<button
					type="button"
					class="rounded-md border px-2.5 py-1 font-mono text-xs font-medium transition-colors {selectedTable ===
					tableName
						? 'border-foreground/30 bg-foreground/10 text-foreground'
						: 'border-border bg-background text-muted-foreground hover:text-foreground'}"
					onclick={() => (selectedTable = tableName)}
				>
					{tableName}
				</button>
			{/each}
		</div>

		<div
			class="flex min-h-[min(50dvh,24rem)] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background"
		>
			<div
				class="border-border/60 flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 sm:px-4"
			>
				{#if selectedTable}
					<h2 class="font-mono text-sm font-semibold tracking-tight">{selectedTable}</h2>
					<span class="text-muted-foreground text-xs">
						{explorerRows.length === 1
							? t('common.rowCount', { count: explorerRows.length })
							: t('common.rowCountPlural', { count: explorerRows.length })}
					</span>
					{#if skippedUnauthorizedRows > 0}
						<span
							class="text-amber-600 dark:text-amber-500 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium"
							title={t('db.explorer.gatedHiddenTitle')}
						>
							{t('common.gatedHidden', { count: skippedUnauthorizedRows })}
						</span>
					{/if}
				{/if}
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground ml-auto inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50"
					disabled={!selectedTable || refreshBusy}
					onclick={() => void refreshExplorer()}
				>
					{refreshBusy ? t('common.refreshing') : t('db.explorer.refreshExplorer')}
				</button>
			</div>

			{#if explorerErr}
				<p
					class="text-destructive border-destructive/40 bg-destructive/10 m-4 shrink-0 rounded-lg border px-3 py-2 text-sm"
					role="alert"
				>
					{explorerErr}
				</p>
			{/if}

			<div class="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
				{#if selectedTable === null || tables.length === 0}
					<p class="text-muted-foreground text-sm">{t('db.explorer.pickTable')}</p>
				{:else if explorerRows.length === 0}
					<p class="text-muted-foreground text-sm">{t('db.explorer.noReadableRows')}</p>
				{:else}
					<div class="rounded-lg border border-border/60 shadow-sm">
						<table class="w-max min-w-full border-collapse font-mono text-xs">
							<thead class="sticky top-0 z-[1] bg-muted/95 backdrop-blur">
								<tr>
									{#each columns as col (col)}
										<th
											class="text-muted-foreground border-border/70 max-w-[20rem] border-b px-2 py-2 text-left align-bottom font-semibold whitespace-nowrap uppercase tracking-wide"
											scope="col"
										>
											{col}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each explorerRows as row, ix (typeof row.id === 'string' ? row.id : ix)}
									<tr
										class="border-border/60 odd:bg-muted/40 hover:bg-muted/60 transition-colors border-b align-top"
									>
										{#each columns as col (col)}
											{@const c = formatCell(col, row[col], row as Record<string, unknown>)}
											<td
												class="max-w-xl border-border/40 px-2 py-1.5 text-[11px] leading-snug break-all"
												title={c.title}
											>
												{c.text}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
