<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import type { SparksRow } from '@avenos/jazz-schema'
	import {
		jazzBootstrap,
		jazzSession,
		jazzStatus,
		sparkAdminAdd,
		sparkAdminList,
		type JazzSessionReply,
	} from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import type { PeerRowReply } from '$lib/peer/api'
	import { peerList } from '$lib/peer/api'
	import { deviceSession } from '$lib/self/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	const sparksStore = jazzStore('sparks')

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
	let copySpark = $state(false)

	let peersAllow = $state<PeerRowReply[]>([])
	let adminDids = $state<string[]>([])
	let adminErr = $state<string | undefined>()
	let adminBusy = $state(false)
	let addAdminDid = $state('')
	let addNote = $state<string | undefined>()

	const sessionKind = $derived($deviceSession.kind)
	const unlocked = $derived(
		sessionKind === 'unlocked' || sessionKind === 'dev_bypass',
	)
	const tauri = $derived(browser && isTauriRuntime())

	const selectedSpark = $derived.by(() => {
		if (!sparkId) return undefined
		return sparks.find((s) => s.spark_id.trim().toLowerCase() === sparkId.trim().toLowerCase())
	})

	const defaultSettingsHref = $derived.by(() => {
		if (!session?.defaultSparkUrn) return '/self/workspaces'
		const id = session.defaultSparkUrn.replace(/^spark:/i, '').trim()
		return `/self/workspaces?spark=${encodeURIComponent(id)}`
	})

	function sparkSubtitle(row: SparksRow): string {
		const id = row.spark_id
		return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
	}

	const selectablePeers = $derived.by(() => {
		const adminNorm = new Set(adminDids.map((d) => d.trim().toLowerCase()))
		return peersAllow.filter(
			(p) => p.status === 'active' && !adminNorm.has(p.peerDid.trim().toLowerCase()),
		)
	})

	const activeAllowlistPeers = $derived(peersAllow.filter((p) => p.status === 'active'))

	async function copyUrn(urn: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(urn)
			copySpark = true
			setTimeout(() => {
				copySpark = false
			}, 1200)
		} catch {
			copySpark = false
		}
	}

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
			const status = await jazzStatus()
			if (!status.ready) await jazzBootstrap()
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
			addNote = 'Admin grant saved — biscuit + DEK keyshare will sync to that peer.'
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
</script>

<svelte:head>
	<title>Workspace sharing · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Workspace sharing</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Biscuit admins and encrypted key material sync only to peers you allow. Pair Macs first under
			<a href="/self/network" class="text-primary font-medium underline">Self → Peers &amp; anchor</a>, then pick a spark here to grant admin.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-xs">
			Spark tools need the AvenOS desktop shell (Tauri + Groove).
		</p>
	{:else if !unlocked}
		<p class="text-muted-foreground rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-xs leading-relaxed">
			Unlock so Groove can read sparks and biscuit policy while the vault is open.
		</p>
	{/if}

	{#if sparksErr}
		<p class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs select-text">{sparksErr}</p>
	{/if}

	{#if tauri && unlocked && session && !err}
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-5">
			<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Default spark</h2>
			<p class="text-muted-foreground text-[11px] leading-relaxed">
				Created locally on first Jazz bootstrap — todos default to this spark unless you choose another workspace.
			</p>
			<div class="space-y-1.5">
				<span class="text-muted-foreground text-[10px] uppercase tracking-wider">URN</span>
				<pre
					class="break-all overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{session.defaultSparkUrn}</pre>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class="border-input hover:bg-accent hover:text-accent-foreground w-fit rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
						onclick={() => {
							if (!session) return
							void copyUrn(session.defaultSparkUrn)
						}}
					>
						{copySpark ? 'Copied URN' : 'Copy URN'}
					</button>
					<a
						href={defaultSettingsHref}
						class="border-input hover:bg-accent inline-flex items-center rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
					>
						Open in sharing
					</a>
					<a
						href={session.defaultSparkUrn.replace(/^spark:/i, '').trim()
							? `/sparks/${encodeURIComponent(session.defaultSparkUrn.replace(/^spark:/i, '').trim())}`
							: '/sparks'}
						class="border-input hover:bg-accent inline-flex items-center rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
					>
						Open todos
					</a>
				</div>
			</div>

			<hr class="border-border/60" />

			<div class="space-y-1.5">
				<h3 class="text-[10px] font-semibold uppercase tracking-wider opacity-70">This device DID</h3>
				<pre
					class="break-all rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{session.peerDid}</pre>
				{#if session.peerDidShort}
					<span class="text-muted-foreground text-[10px]">{session.peerDidShort}</span>
				{/if}
			</div>
		</section>
	{:else if tauri && unlocked && busy && !session}
		<p class="text-muted-foreground text-xs">Loading session…</p>
	{/if}

	{#if err}
		<p class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs select-text">{err}</p>
	{/if}

	<section class="space-y-3">
		<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Workspaces</h2>
		{#if tauri && unlocked && !sparksStore.loaded && !sparksErr}
			<p class="text-muted-foreground text-sm">Loading workspaces…</p>
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
								>Workspace</span
							>
							<span class="text-base font-medium tracking-tight group-hover:text-accent-foreground">{row.name || 'Unnamed spark'}</span>
							<span class="text-muted-foreground font-mono text-[11px] group-hover:text-accent-foreground/85">{sparkSubtitle(row)}</span>
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
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">{selectedSpark.name || 'Spark'} — URN</h2>
				<pre
					class="break-all font-mono text-[11px] leading-snug select-text">spark:{selectedSpark.spark_id}</pre>
			</section>

			<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Admin DIDs</h2>
				{#if adminDids.length === 0}
					<p class="text-muted-foreground text-sm">No admins listed yet (unexpected — you should be an owner).</p>
				{:else}
					<ul class="space-y-1 font-mono text-xs">
						{#each adminDids as d (d)}
							<li class="break-all">{d}</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Grant admin</h2>
				{#if selectablePeers.length > 0}
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<select class="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm" bind:value={addAdminDid}>
							<option value="">Select a paired peer…</option>
							{#each selectablePeers as p (p.id)}
								<option value={p.peerDid}>{p.label || p.peerDid.slice(0, 24)}…</option>
							{/each}
						</select>
						<button
							type="button"
							class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
							disabled={adminBusy || !addAdminDid}
							onclick={() => void addAdmin()}
						>
							{adminBusy ? '…' : 'Add admin'}
						</button>
					</div>
				{:else if activeAllowlistPeers.length === 0}
					<p class="text-muted-foreground text-sm">
						No paired peers yet — invite or accept under
						<a href="/self/network" class="text-primary underline">Self → Peers &amp; anchor</a>, then reload this page if needed.
					</p>
				{:else}
					<p class="text-muted-foreground text-sm leading-relaxed">
						<strong class="font-medium text-foreground">Nobody left to add:</strong>
						every peer in your allowlist is already an admin on this workspace (only non-admins show in the picker). Pair another device if you want to grant admin to someone else.
					</p>
				{/if}
				{#if adminErr}
					<p class="text-destructive text-xs">{adminErr}</p>
				{/if}
				{#if addNote}
					<p class="text-muted-foreground text-xs">{addNote}</p>
				{/if}
			</section>

			<p class="text-muted-foreground text-xs">
				<strong class="text-foreground font-medium">Todos:</strong>
				<a href="/sparks/{encodeURIComponent(sparkId)}" class="text-primary underline">open this workspace</a>
			</p>
		{/if}
	{/if}
</div>
