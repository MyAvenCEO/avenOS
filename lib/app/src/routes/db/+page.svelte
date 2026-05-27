<script lang="ts">
	import SlideAsideLayout from '$lib/ui/SlideAsideLayout.svelte'
	import MobileAsideNavLink from '$lib/ui/MobileAsideNavLink.svelte'
	import MobileAsideSectionLabel from '$lib/ui/MobileAsideSectionLabel.svelte'
	import { browser } from '$app/environment'
	import {
		jazzExplorerList,
		jazzExplorerSubscribe,
		jazzSession,
		jazzStatus,
		type JazzExplorerListReply,
		type JazzSessionReply,
	} from '$lib/jazz/api'
	import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
	import { withTimeoutMs } from '$lib/async-timeout'
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
	let tablesAsideOpen = $state(false)

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked',
	)
	const tauri = $derived(browser && isTauriRuntime())

	const DB_IPC_BUDGET_MS = 12_000

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

	function formatCell(
		column: string,
		value: unknown,
		row: Record<string, unknown>,
	): { text: string; title?: string } {
		if (column === 'content_b64' && typeof value === 'string' && value.length > 0) {
			const n = value.length
			const sizeBytes = typeof row.size_bytes === 'number' ? row.size_bytes : undefined
			const hint = sizeBytes != null ? ` · original ~${sizeBytes} B` : ''
			return {
				text: `[sealed payload, ${n} base64 chars${hint}]`,
				title: `${value.slice(0, 120)}…`,
			}
		}
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
				session = await withTimeoutMs(jazzSession(), DB_IPC_BUDGET_MS, 'DB: Jazz session')
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
				await withTimeoutMs(
					waitForGrooveSessionReady(),
					DB_IPC_BUDGET_MS,
					'DB: Groove session',
				)
				if (cancelled) return
				const status = await withTimeoutMs(
					jazzStatus(),
					DB_IPC_BUDGET_MS,
					'DB: Jazz status',
				)
				if (cancelled) return
				tables = status.tables ?? []
				if (!status.ready) {
					bootstrapErr =
						'Local Groove shell did not report ready — the listing may be incomplete. Retry or reload.'
				}
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

<div class="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,88rem)] flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-2 sm:px-6 md:overflow-hidden">
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

		<div
			class="flex min-h-[min(56dvh,28rem)] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background"
		>
			<SlideAsideLayout
				bind:open={tablesAsideOpen}
				asideLabel="Table names"
				desktopGridClass="md:grid-cols-[13rem_minmax(0,1fr)]"
				class="min-h-0 flex-1"
			>
				{#snippet aside()}
					<MobileAsideSectionLabel class="px-0 md:px-1">Tables</MobileAsideSectionLabel>
					<div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-1 md:justify-start">
						{#each tables as t (t)}
							<MobileAsideNavLink
								active={selectedTable === t}
								class="font-mono md:text-xs md:font-medium"
								aria-current={selectedTable === t ? 'page' : undefined}
								onclick={() => {
									selectedTable = t
									tablesAsideOpen = false
								}}
							>
								{t}
							</MobileAsideNavLink>
						{:else}
							{#if !bootstrapErr}
								<p class="text-muted-foreground px-2 py-4 text-sm md:text-xs">No tables loaded.</p>
							{/if}
						{/each}
					</div>
				{/snippet}

				<section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
						<div class="border-border/60 flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 sm:px-4">
							{#if selectedTable}
								<h2 class="font-mono text-sm font-semibold tracking-tight">{selectedTable}</h2>
								<span class="text-muted-foreground text-xs"
									>{explorerRows.length} row{explorerRows.length === 1 ? '' : 's'}</span
								>
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

						<div class="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
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
					</section>
			</SlideAsideLayout>
		</div>
	{/if}
</div>
