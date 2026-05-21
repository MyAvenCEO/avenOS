<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import type { SparksRow } from '@avenos/jazz-schema'
	import { withTimeoutMs } from '$lib/async-timeout'
	import {
		jazzSession,
		jazzStatus,
		sparkAdminAdd,
		sparkAdminList,
		type JazzSessionReply,
	} from '$lib/jazz/api'
	import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import type { PeerRowReply } from '$lib/peer/api'
	import { peerList } from '$lib/peer/api'
	import { peerDisplayLabel } from '$lib/peer/display-label'
	import PeerPickerSelect from '$lib/peer/PeerPickerSelect.svelte'
	import { pairingLabelForSession } from '$lib/self/active-vault-ui'
	import { deviceSession } from '$lib/self/device-session-store'
	import { vaultList } from '$lib/self/vault'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	const sparksStore = jazzStore('sparks')

	const LOCAL_IPC_BUDGET_MS = 12_000

	// Snapshot is reactive: peer-sync deltas refresh `sparksStore.rows` automatically,
	// so granting another device admin appears here without a manual reload.
	const sparks = $derived<SparksRow[]>(
		[...sparksStore.rows].sort((a, b) => a.name.localeCompare(b.name)),
	)
	const sparksErr = $derived(sparksStore.error)

	const sparkRaw = $derived(page.url.searchParams.get('spark')?.trim() ?? '')
	const sparkId = $derived(sparkRaw ? decodeURIComponent(sparkRaw) : '')

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let busy = $state(false)
	let peersAllow = $state<PeerRowReply[]>([])
	let adminDids = $state<string[]>([])
	let adminErr = $state<string | undefined>()
	let adminBusy = $state(false)
	let addAdminDid = $state('')
	let addNote = $state<string | undefined>()
	let localPairingLabel = $state<string | undefined>(undefined)

	const sessionKind = $derived($deviceSession.kind)
	const unlocked = $derived(
		sessionKind === 'unlocked',
	)
	const tauri = $derived(browser && isTauriRuntime())

	const selectedSpark = $derived.by(() => {
		if (!sparkId) return undefined
		return sparks.find((s) => s.spark_id.trim().toLowerCase() === sparkId.trim().toLowerCase())
	})

	function sparkUrn(row: SparksRow): string {
		return `spark:${row.spark_id.trim()}`
	}

	function peerAccessLabel(peerDid: string, storedLabel: string | undefined, isThisDevice: boolean): string {
		if (isThisDevice) return 'This device'
		return peerDisplayLabel(peerDid, storedLabel, localPairingLabel)
	}

	type SparkAccessEntry = {
		did: string
		label: string
		isThisDevice: boolean
		capabilities: string[]
	}

	const accessEntries = $derived.by((): SparkAccessEntry[] => {
		const peersByDid = new Map(
			peersAllow.map((p) => [p.peerDid.trim().toLowerCase(), p] as const),
		)
		const localDid = session?.peerDid?.trim().toLowerCase() ?? ''
		return adminDids.map((did) => {
			const norm = did.trim().toLowerCase()
			const peer = peersByDid.get(norm)
			const isThisDevice = localDid !== '' && norm === localDid
			const label = peerAccessLabel(did, peer?.deviceLabel, isThisDevice)
			const capabilities = isThisDevice
				? ['Owner', 'Read', 'Write', 'Delete', 'Share']
				: ['Admin', 'Read', 'Write', 'Delete']
			return { did, label, isThisDevice, capabilities }
		})
	})

	const selectablePeers = $derived.by(() => {
		const adminNorm = new Set(adminDids.map((d) => d.trim().toLowerCase()))
		return peersAllow.filter(
			(p) => p.status === 'active' && !adminNorm.has(p.peerDid.trim().toLowerCase()),
		)
	})

	const activeAllowlistPeers = $derived(peersAllow.filter((p) => p.status === 'active'))

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	function selectSpark(id: string): void {
		goto(`/self/workspaces?spark=${encodeURIComponent(id)}`)
	}

	// `sparks` is driven by `jazzStore('sparks')` above — no manual loader.

	async function loadSessionAndAdmins(): Promise<void> {
		if (!tauri || !unlocked) {
			session = undefined
			return
		}
		busy = true
		err = undefined
		try {
			await withTimeoutMs(
				(async () => {
					await waitForGrooveSessionReady()
					const status = await jazzStatus()
					if (!status.ready) {
						throw new Error('Local Groove shell is not ready yet.')
					}
					session = await jazzSession()

					const sid = sparkId.trim()
					if (sid) {
						peersAllow = await peerList()
						const a = await sparkAdminList(sid)
						adminDids = a.adminDids
					} else {
						peersAllow = []
						adminDids = []
					}
					addAdminDid = ''
					addNote = undefined
					adminErr = undefined
				})(),
				LOCAL_IPC_BUDGET_MS,
				'Share: loading session stalled',
			)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function addAdmin(): Promise<void> {
		const did = addAdminDid.trim()
		const sid = sparkId
		if (!did || !sid) return
		adminBusy = true
		adminErr = undefined
		addNote = undefined
		try {
			await sparkAdminAdd({ sparkId: sid, peerDid: did })
			addAdminDid = ''
			addNote = 'Access granted — it may take a moment to show on their device.'
			const a = await sparkAdminList(sid)
			adminDids = a.adminDids
		} catch (e) {
			adminErr = e instanceof Error ? e.message : String(e)
		} finally {
			adminBusy = false
		}
	}

	let defaultedUrl = $state(false)

	const hasSparkQuery = $derived(page.url.searchParams.has('spark'))

	$effect(() => {
		if (!browser || !tauri || !unlocked) return
		if (hasSparkQuery || defaultedUrl) return
		const urn = session?.defaultSparkUrn
		if (!urn || sparks.length === 0) return
		const id = urn.replace(/^spark:/i, '').trim()
		if (!id || !sparks.some((s) => idsMatch(s.spark_id, id))) return
		defaultedUrl = true
		goto(`/self/workspaces?spark=${encodeURIComponent(id)}`, { replaceState: true })
	})

	$effect(() => {
		sessionKind
		sparkId
		unlocked
		tauri
		void loadSessionAndAdmins()
	})

	$effect(() => {
		if (!browser || !tauri || !unlocked) {
			localPairingLabel = undefined
			return
		}
		void sessionKind
		void $deviceSession
		void (async () => {
			try {
				const sessionVaultRows = await vaultList()
				localPairingLabel = pairingLabelForSession(sessionVaultRows, $deviceSession)
			} catch {
				localPairingLabel = undefined
			}
		})()
	})
</script>

<svelte:head>
	<title>Share · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Share</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Choose who can access a spark. Pair a device under
			<a href="/self/peers" class="text-primary font-medium underline">Self → Peers</a>, then pick a spark and add them.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-xs">
			Sharing needs the AvenOS desktop app.
		</p>
	{:else if !unlocked}
		<p class="text-muted-foreground rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-xs leading-relaxed">
			Unlock to manage sparks and sharing.
		</p>
	{/if}

	{#if sparksErr}
		<p class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs select-text">{sparksErr}</p>
	{/if}

	{#if tauri && unlocked && sparksStore.loaded && busy && !session}
		<p class="text-muted-foreground rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-xs leading-relaxed">
			Still loading session details… If this lasts more than ~{LOCAL_IPC_BUDGET_MS / 1000}s, check logs or reload.
		</p>
	{/if}

	{#if err}
		<p class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs select-text">{err}</p>
	{/if}

	<section class="space-y-3">
		<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Sparks</h2>
		{#if tauri && unlocked && !sparksStore.loaded && !sparksErr}
			<p class="text-muted-foreground text-sm">Loading sparks…</p>
		{:else if tauri && unlocked && sparks.length === 0}
			<p class="text-muted-foreground text-sm">No sparks yet — bootstrap normally provisions one after unlock.</p>
		{:else if tauri && unlocked}
			<ul class="grid gap-3 sm:grid-cols-2">
				{#each sparks as row (row.spark_id)}
					<li>
						<button
							type="button"
							class="group border-input hover:bg-accent hover:text-accent-foreground hover:border-border flex w-full flex-col gap-1 rounded-xl border bg-card/40 px-4 py-4 text-left transition-colors
								{selectedSpark?.spark_id === row.spark_id ? 'ring-ring ring-2 ring-offset-2 ring-offset-background' : ''}"
							onclick={() => selectSpark(row.spark_id)}
						>
							<span
								class="text-[11px] font-semibold tracking-wider uppercase opacity-70 group-hover:text-accent-foreground/90"
								>Spark</span
							>
							<span class="text-base font-medium tracking-tight group-hover:text-accent-foreground">{row.name || 'Unnamed spark'}</span>
							<span class="text-muted-foreground break-all font-mono text-[11px] leading-snug group-hover:text-accent-foreground/85">{sparkUrn(row)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if tauri && unlocked && sparkId}
		{#if busy}
			<p class="text-muted-foreground text-sm">Loading admins…</p>
		{:else if !selectedSpark && sparks.length > 0}
			<p class="text-muted-foreground text-sm">That spark id is not in your ledger.</p>
		{:else if selectedSpark}
			<hr class="border-border/60" />

			<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Who has access</h2>
				<p class="text-muted-foreground text-[11px] leading-relaxed">
					Admins can read and change todos on this spark. Only this device can add or share access with others.
				</p>
				{#if accessEntries.length === 0}
					<p class="text-muted-foreground text-sm">No one listed yet.</p>
				{:else}
					<ul class="divide-border/60 divide-y overflow-hidden rounded-lg border border-border/50">
						{#each accessEntries as entry (entry.did)}
							<li class="flex flex-col gap-2 bg-background/40 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
								<div class="min-w-0 flex-1 space-y-0.5">
									<p class="text-sm font-medium">{entry.label}</p>
									{#if !entry.isThisDevice}
										<p class="text-muted-foreground break-all font-mono text-[10px] leading-snug select-text">{entry.did}</p>
									{/if}
								</div>
								<div class="flex flex-wrap gap-1.5 sm:max-w-[55%] sm:justify-end">
									{#each entry.capabilities as cap (cap)}
										<span
											class="rounded-md px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase
												{cap === 'Owner' || cap === 'Admin'
												? 'bg-primary/10 text-primary'
												: 'bg-muted text-muted-foreground'}">{cap}</span
										>
									{/each}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Give access</h2>
				{#if selectablePeers.length > 0}
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<PeerPickerSelect
							peers={selectablePeers}
							bind:value={addAdminDid}
							{localPairingLabel}
							disabled={adminBusy}
						/>
						<button
							type="button"
							class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
							disabled={adminBusy || !addAdminDid}
							onclick={() => void addAdmin()}
						>
							{adminBusy ? '…' : 'Add as admin'}
						</button>
					</div>
				{:else if activeAllowlistPeers.length === 0}
					<p class="text-muted-foreground text-sm">
						No paired peers yet — invite or accept under
						<a href="/self/peers" class="text-primary underline">Self → Peers</a>, then reload this page if needed.
					</p>
				{:else}
					<p class="text-muted-foreground text-sm leading-relaxed">
						<strong class="font-medium text-foreground">Nobody left to add:</strong>
						everyone you paired already has access to this spark. Pair another device if you want to add someone else.
					</p>
				{/if}
				{#if adminErr}
					<p class="text-destructive text-xs">{adminErr}</p>
				{/if}
				{#if addNote}
					<p class="text-muted-foreground text-xs">{addNote}</p>
				{/if}
			</section>

		{/if}
	{/if}
</div>
