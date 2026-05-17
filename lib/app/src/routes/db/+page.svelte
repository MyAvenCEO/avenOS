<script lang="ts">
	import { browser } from '$app/environment'
	import {
		jazzBootstrap,
		jazzExplorerList,
		jazzExplorerSubscribe,
		jazzSession,
		type JazzExplorerListReply,
		type JazzSessionReply,
	} from '$lib/jazz/api'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'

	let session = $state<JazzSessionReply | undefined>()
	let tables = $state<string[]>([])
	let selectedTable = $state<string | null>(null)
	let explorerRows = $state<Record<string, unknown>[]>([])
	let skippedUnauthorizedRows = $state(0)
	let refreshBusy = $state(false)

	let bootstrapErr = $state<string | undefined>()
	let explorerErr = $state<string | undefined>()

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked' || $deviceSession.kind === 'dev_bypass',
	)
	const tauri = $derived(browser && isTauriRuntime())

	function buildColumns(rows: Record<string, unknown>[]): string[] {
		const s = new Set<string>()
		for (const row of rows) {
			Object.keys(row).forEach((k) => s.add(k))
		}
		const rest = [...s].filter((k) => k !== 'id' && k !== '_encryptedColumns').sort((a, b) =>
			a.localeCompare(b),
		)
		const out: string[] = []
		if (s.has('id')) out.push('id')
		out.push(...rest)
		if (s.has('_encryptedColumns')) out.push('_encryptedColumns')
		return out
	}

	const columns = $derived(buildColumns(explorerRows))

	const cellPreviewMax = 200

	function formatCell(value: unknown): { text: string; title?: string } {
		if (value === null) return { text: '' }
		if (value === undefined) return { text: '' }
		if (typeof value === 'boolean') return { text: value ? 'true' : 'false' }
		if (typeof value === 'number') return { text: String(value) }
		if (typeof value === 'string') {
			const trimmed = value.length > cellPreviewMax ? `${value.slice(0, cellPreviewMax)}…` : value
			return value.length > cellPreviewMax ? { text: trimmed, title: value } : { text: trimmed }
		}
		try {
			const raw = JSON.stringify(value)
			const trimmed =
				raw.length > cellPreviewMax ? `${raw.slice(0, cellPreviewMax)}…` : raw
			return raw.length > cellPreviewMax ? { text: trimmed, title: raw } : { text: trimmed }
		} catch {
			return { text: String(value) }
		}
	}

	$effect(() => {
		if (!tauri || !unlocked) {
			session = undefined
			tables = []
			selectedTable = null
			bootstrapErr = undefined
			return
		}
		let cancelled = false
		void (async () => {
			try {
				session = await jazzSession().catch(() => undefined)
			} catch {
				if (!cancelled) session = undefined
			}
		})()
		return () => {
			cancelled = true
		}
	})

	$effect(() => {
		if (!tauri || !unlocked) return
		let cancelled = false
		void (async () => {
			try {
				bootstrapErr = undefined
				const boot = await jazzBootstrap()
				if (cancelled) return
				tables = boot.tables ?? []
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
			explorerRows = []
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
				explorerRows = reply.rows
				skippedUnauthorizedRows = reply.skippedUnauthorizedRows
			} catch (e) {
				if (!cancelled) explorerErr = e instanceof Error ? e.message : String(e)
			}

			unlisten?.()
			unlisten = await jazzExplorerSubscribe(table, (next) => {
				if (!cancelled) explorerRows = next
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
			explorerRows = reply.rows
			skippedUnauthorizedRows = reply.skippedUnauthorizedRows
		} catch (e) {
			explorerErr = e instanceof Error ? e.message : String(e)
		} finally {
			refreshBusy = false
		}
	}
</script>

<svelte:head>
	<title>Database · AvenOS</title>
</svelte:head>

<div class="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,88rem)] flex-1 flex-col gap-4 px-4 pb-6 pt-2 sm:px-6">
	<header class="shrink-0 space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Local database</h1>
		<p class="text-muted-foreground max-w-xl text-sm leading-relaxed">
			Grove-backed rows for this device identity via the Rust shell — read-only explorer.
		</p>
		{#if session}
			<p class="text-muted-foreground font-mono text-xs leading-snug">
				{session.peerDidShort}<span class="mx-2 text-border">·</span><span>{session.defaultSparkUrn}</span>
			</p>
		{/if}
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app to inspect local Groove rows.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock with Touch ID to load your local database.</p>
	{:else}
		{#if bootstrapErr}
			<p
				class="text-destructive border-destructive/40 bg-destructive/10 shrink-0 rounded-lg border px-3 py-2 text-sm leading-snug"
				role="alert"
			>
				{bootstrapErr}
			</p>
		{/if}

		<div class="flex min-h-0 min-w-0 flex-1 gap-4 overflow-hidden rounded-xl border border-border/60 bg-background">
			<aside
				class="border-border/60 flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r px-3 py-3"
				aria-label="Table names"
			>
				<p class="text-muted-foreground mb-1 px-1 text-[10px] font-bold uppercase tracking-wider">
					Tables
				</p>
				{#each tables as t (t)}
					<button
						type="button"
						class="rounded-md px-2 py-2 text-left text-xs font-medium transition-colors {selectedTable === t
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
						aria-current={selectedTable === t ? 'page' : undefined}
						onclick={() => {
							selectedTable = t
						}}
					>
						{t}
					</button>
				{:else}
					{#if !bootstrapErr}
						<p class="text-muted-foreground px-2 py-4 text-xs">No tables loaded.</p>
					{/if}
				{/each}
			</aside>

			<section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<div class="border-border/60 flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
					{#if selectedTable}
						<h2 class="font-mono text-sm font-semibold tracking-tight">{selectedTable}</h2>
						<span class="text-muted-foreground text-xs"
							>{explorerRows.length} row{explorerRows.length === 1 ? '' : 's'}</span>
						{#if skippedUnauthorizedRows > 0}
							<span
								class="text-amber-600 dark:text-amber-500 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium"
								title="Rows skipped due to biscuit / spark gates (shown only until the next explorer fetch)"
							>
								{skippedUnauthorizedRows} gated (hidden)
							</span>
						{/if}
					{/if}
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground ml-auto inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50"
						disabled={!selectedTable || refreshBusy}
						onclick={() => void refreshExplorer()}
					>
						{refreshBusy ? 'Refreshing…' : 'Refresh explorer'}
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

				<div class="min-h-0 flex-1 overflow-auto p-4">
					{#if selectedTable === null || tables.length === 0}
						<p class="text-muted-foreground text-sm">
							Pick a table from the list to inspect rows.
						</p>
					{:else if explorerRows.length === 0}
						<p class="text-muted-foreground text-sm">No readable rows for this table.</p>
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
										<tr class="border-border/60 odd:bg-muted/40 hover:bg-muted/60 transition-colors border-b align-top">
											{#each columns as col (col)}
												{@const c = formatCell(row[col])}
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
			</section>
		</div>
	{/if}
</div>
