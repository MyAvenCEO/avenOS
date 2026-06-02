<script lang="ts">
	import { browser } from '$app/environment'
	import { withTimeoutMs } from '$lib/async-timeout'
	import {
		jazzSession,
		jazzStatus,
		sparkAdminAdd,
		sparkAdminList,
		sparkAdminRevoke,
		sparkReplicateAdd,
		peerList,
		type PeerRow,
		type JazzSessionReply,
	} from '$lib/jazz/api'
	import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { peerMeshSnapshot } from '$lib/peer/peer-mesh-store'
	import {
		meshPeerPhase,
		peerMeshPhaseUserLabel,
		peerMeshDotClass,
		peerMeshTextClass,
		type PeerMeshPhase,
	} from '$lib/peer/mesh-state'
	import { peerDisplayLabel } from '$lib/peer/display-label'
	import { pairingLabelForSession } from '$lib/settings/active-vault-ui'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { vaultList } from '$lib/settings/vault'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { formatDebugReport, recentRustLogs } from '$lib/debug/console-capture'
	import { t } from '$lib/i18n'

	let { sparkId, wide = false }: { sparkId: string; wide?: boolean } = $props()

	type SparkCapKey = 'owner' | 'admin' | 'read' | 'write' | 'delete' | 'share'

	function sparkCapLabel(key: SparkCapKey): string {
		return t(`sparks.share.capabilities.${key}`)
	}

	const LOCAL_IPC_BUDGET_MS = 12_000

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let busy = $state(false)
	let adminDids = $state<string[]>([])
	let adminErr = $state<string | undefined>()
	let adminBusy = $state(false)
	let addAdminDid = $state('')
	let addNote = $state<string | undefined>()
	let addReplicateDid = $state('')
	let replicateBusy = $state(false)
	let replicateErr = $state<string | undefined>()
	let replicateNote = $state<string | undefined>()
	let revokeBusyDid = $state<string | undefined>(undefined)
	let confirmRevokeDid = $state<string | undefined>(undefined)
	let revokeErr = $state<string | undefined>()
	let revokeNote = $state<string | undefined>()
	let localPairingLabel = $state<string | undefined>(undefined)
	let debugCopied = $state(false)

	const sessionKind = $derived($deviceSession.kind)
	const unlocked = $derived(sessionKind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	// The admin roster lives inside the spark's biscuit (`genesis_b64`). That field
	// rides the reactive `sparks` table store, so a remote admin grant (e.g. the AI
	// adds an admin on another device) lands here in realtime over TCP sync. We watch
	// it below and re-read the admin list whenever it changes — without it, the panel
	// only refreshed on local add/revoke and on a fresh mount (app restart).
	const sparksStore = jazzStore('sparks')
	const sparkBiscuit = $derived.by<string | undefined>(() => {
		const sid = sparkId.trim().toLowerCase()
		if (!sid) return undefined
		const row = sparksStore.rows.find(
			(r) => String(r.spark_id ?? '').trim().toLowerCase() === sid,
		)
		return typeof row?.genesis_b64 === 'string' ? row.genesis_b64 : undefined
	})

	let knownPeers = $state<PeerRow[]>([])
	const peersAllow = $derived<PeerRow[]>(
		!tauri || !unlocked || !sparkId.trim() ? [] : knownPeers,
	)

	function peerAccessLabel(
		peerDid: string,
		storedLabel: string | undefined,
		isThisDevice: boolean,
	): string {
		if (isThisDevice) return t('common.thisDevice')
		return peerDisplayLabel(peerDid, storedLabel, localPairingLabel)
	}

	type SparkAccessEntry = {
		did: string
		label: string
		isThisDevice: boolean
		capabilities: SparkCapKey[]
		phase: PeerMeshPhase
	}

	const accessEntries = $derived.by((): SparkAccessEntry[] => {
		const peersByDid = new Map(
			peersAllow.map((p) => [p.peerDid.trim().toLowerCase(), p] as const),
		)
		const localDid = session?.peerDid?.trim().toLowerCase() ?? ''
		const snapshot = $peerMeshSnapshot
		return adminDids.map((did) => {
			const norm = did.trim().toLowerCase()
			const peer = peersByDid.get(norm)
			const isThisDevice = localDid !== '' && norm === localDid
			const label = peerAccessLabel(did, peer?.deviceLabel, isThisDevice)
			const capabilities: SparkCapKey[] = isThisDevice
				? ['owner', 'read', 'write', 'delete', 'share']
				: ['admin', 'read', 'write', 'delete']
			// Sync chip (§7 V3): this device is always settled; remote members read
			// their live phase from the mesh snapshot (never re-derived).
			const phase: PeerMeshPhase = isThisDevice
				? 'ready'
				: meshPeerPhase(snapshot, did, peer?.status)
			return { did, label, isThisDevice, capabilities, phase }
		})
	})

	// §7 V3 — calm global status: "everyone up to date" vs "N still syncing".
	const remoteEntries = $derived(accessEntries.filter((e) => !e.isThisDevice))
	const pendingCount = $derived(remoteEntries.filter((e) => e.phase !== 'ready').length)
	const allSynced = $derived(remoteEntries.length > 0 && pendingCount === 0)


	let adminLoadGen = 0

	async function loadSessionAndAdmins(): Promise<void> {
		if (!tauri || !unlocked) {
			session = undefined
			adminDids = []
			return
		}
		const sid = sparkId.trim()
		const gen = ++adminLoadGen
		busy = true
		err = undefined
		try {
			await withTimeoutMs(
				(async () => {
					await waitForGrooveSessionReady()
					const status = await jazzStatus()
					if (!status.ready) {
						throw new Error(t('errors.grooveShellNotReady'))
					}
					const nextSession = await jazzSession()
					if (gen !== adminLoadGen) return
					session = nextSession

					knownPeers = (await peerList()).filter((p) => p.status === 'active')
					if (gen !== adminLoadGen) return

					if (sid) {
						const a = await sparkAdminList(sid)
						if (gen !== adminLoadGen) return
						adminDids = a.adminDids
					} else {
						adminDids = []
					}
					addAdminDid = ''
					addNote = undefined
					adminErr = undefined
				})(),
				LOCAL_IPC_BUDGET_MS,
				t('errors.shareLoadingStalled'),
			)
		} catch (e) {
			if (gen !== adminLoadGen) return
			err = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === adminLoadGen) busy = false
		}
	}

	// Lightweight re-read of just the admin roster (+ peer labels) — used when the
	// spark biscuit changes under us via sync. Session is already loaded by the main
	// effect, so we skip the heavier readiness checks done in loadSessionAndAdmins().
	async function refreshAdminList(): Promise<void> {
		const sid = sparkId.trim()
		if (!tauri || !unlocked || !sid) return
		const gen = ++adminLoadGen
		try {
			const peers = (await peerList()).filter((p) => p.status === 'active')
			if (gen !== adminLoadGen) return
			knownPeers = peers
			const a = await sparkAdminList(sid)
			if (gen !== adminLoadGen) return
			adminDids = a.adminDids
			adminErr = undefined
		} catch (e) {
			if (gen !== adminLoadGen) return
			adminErr = e instanceof Error ? e.message : String(e)
		}
	}

	async function addAdmin(): Promise<void> {
		const did = addAdminDid.trim()
		const sid = sparkId.trim()
		if (!did || !sid) return
		const gen = adminLoadGen
		adminBusy = true
		adminErr = undefined
		addNote = undefined
		try {
			await sparkAdminAdd({ sparkId: sid, peerDid: did })
			if (gen !== adminLoadGen) return
			addAdminDid = ''
			addNote = t('sparks.share.accessGrantedNote')
			const a = await sparkAdminList(sid)
			if (gen !== adminLoadGen) return
			adminDids = a.adminDids
		} catch (e) {
			if (gen !== adminLoadGen) return
			adminErr = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === adminLoadGen) adminBusy = false
		}
	}

	// Grant a server aven a blind `replicate` cap (store-and-forward + durable
	// backup). NOT membership: no keyshare is issued, so it carries ciphertext it
	// cannot decrypt. The server's DID is printed in its logs / shown by the relay.
	async function addReplicate(didArg?: string): Promise<void> {
		const did = (didArg ?? addReplicateDid).trim()
		const sid = sparkId.trim()
		if (!did || !sid) return
		replicateBusy = true
		replicateErr = undefined
		replicateNote = undefined
		try {
			await sparkReplicateAdd({ sparkId: sid, peerDid: did })
			addReplicateDid = ''
			replicateNote = t('sparks.share.replicateGrantedNote')
		} catch (e) {
			replicateErr = e instanceof Error ? e.message : String(e)
		} finally {
			replicateBusy = false
		}
	}

	// §7 honest-design: revoke stops *future* changes; it never claws back what a
	// peer already holds. Wording and confirm copy say exactly that — never "remove access".
	async function revokeAdmin(did: string, label: string): Promise<void> {
		const sid = sparkId.trim()
		if (!did || !sid) return
		if (revokeBusyDid) return
		// Inline two-step confirm — native confirm() no-ops in the Tauri webview.
		if (confirmRevokeDid !== did) {
			confirmRevokeDid = did
			setTimeout(() => {
				if (confirmRevokeDid === did) confirmRevokeDid = undefined
			}, 4000)
			return
		}
		confirmRevokeDid = undefined
		const gen = adminLoadGen
		revokeBusyDid = did
		revokeErr = undefined
		revokeNote = undefined
		addNote = undefined
		try {
			await sparkAdminRevoke({ sparkId: sid, peerDid: did })
			if (gen !== adminLoadGen) return
			revokeNote = t('sparks.share.revokedNote', { label })
			const a = await sparkAdminList(sid)
			if (gen !== adminLoadGen) return
			adminDids = a.adminDids
		} catch (e) {
			if (gen !== adminLoadGen) return
			revokeErr = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === adminLoadGen) revokeBusyDid = undefined
		}
	}

	$effect(() => {
		sessionKind
		void sparkId
		void unlocked
		void tauri
		adminDids = []
		addAdminDid = ''
		void loadSessionAndAdmins()
	})

	// Realtime reactivity: when the current spark's biscuit changes *without* a
	// spark/session switch — i.e. a remote peer (or the AI) granted/revoked admin and
	// it synced in over TCP — re-read the roster. We baseline-skip the first sighting
	// and any spark switch (the main effect above owns those) so this fires only on a
	// genuine in-place biscuit change, and never clobbers what the user is typing.
	let adminWatchSpark: string | undefined = undefined
	let adminWatchBiscuit: string | undefined = undefined
	$effect(() => {
		const sid = sparkId.trim()
		const biscuit = sparkBiscuit
		void unlocked
		void tauri
		if (!tauri || !unlocked || !sid || adminWatchSpark !== sid) {
			adminWatchSpark = sid
			adminWatchBiscuit = biscuit
			return
		}
		if (adminWatchBiscuit === biscuit) return
		adminWatchBiscuit = biscuit
		void refreshAdminList()
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

	// Copy a debug report — the device's recent Rust sync log (forwarding gate +
	// peer registration), the spark's admin roster, and live peer/mesh state — so
	// sync problems between peers (incl. whether the server/replication peer
	// received and forwarded a batch) can be pasted back when reporting an issue.
	async function copyDebug(): Promise<void> {
		if (!browser) return
		let peerRows: PeerRow[] = []
		try {
			peerRows = await peerList()
		} catch {
			/* best-effort: state block still useful without the roster */
		}
		const rustLogs = await recentRustLogs()
		const report = formatDebugReport(
			{
				sparkId,
				ownDid: session?.peerDid ?? '',
				adminDids,
				peerRows,
				meshSnapshot: $peerMeshSnapshot,
			},
			rustLogs,
		)
		try {
			await navigator.clipboard.writeText(report)
			debugCopied = true
			setTimeout(() => (debugCopied = false), 1500)
		} catch {
			/* clipboard blocked */
		}
	}
</script>

{#if wide}
	<!-- Main-area / full-width layout -->
	{#if !tauri || !unlocked}
		<p class="text-muted-foreground text-sm">{t('sparks.needsDesktop')}</p>
	{:else if !sparkId.trim()}
		<p class="text-muted-foreground text-sm">{t('sparks.share.noOneListed')}</p>
	{:else}
		<div class="flex flex-col gap-8">
			<!-- Who has access -->
			<section class="flex flex-col gap-4">
				<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">
					{t('sparks.share.whoHasAccess')}
				</h2>
				{#if err}
					<p class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm select-text">{err}</p>
				{:else if busy && adminDids.length === 0}
					<p class="text-muted-foreground text-sm">{t('common.loadingAdmins')}</p>
				{:else if accessEntries.length === 0}
					<p class="text-muted-foreground text-sm">{t('sparks.share.noOneListed')}</p>
				{:else}
					{#if remoteEntries.length > 0}
						<p class="flex items-center gap-2 text-xs">
							<span class="h-2 w-2 rounded-full {allSynced ? peerMeshDotClass('ready') : peerMeshDotClass('syncing')}"></span>
							<span class="text-muted-foreground">{allSynced ? t('sparks.share.allSynced') : t('sparks.share.pending', { count: pendingCount })}</span>
						</p>
					{/if}
					<ul class="flex flex-col gap-2">
						{#each accessEntries as entry (entry.did)}
							<li class="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
								<div class="flex items-start justify-between gap-3">
									<p class="min-w-0 text-sm font-semibold" title={entry.label}>{entry.label}</p>
									<span class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
										<span class="h-2 w-2 rounded-full {peerMeshDotClass(entry.phase)}"></span>
										<span class={peerMeshTextClass(entry.phase)}>{entry.isThisDevice ? t('sparks.share.syncLabelThisDevice') : peerMeshPhaseUserLabel(entry.phase)}</span>
									</span>
								</div>
								{#if !entry.isThisDevice}
									<p class="text-muted-foreground mt-0.5 font-mono text-[11px] leading-snug select-text break-all" title={entry.did}>{entry.did}</p>
								{/if}
								<div class="mt-2 flex flex-wrap items-center gap-1.5">
									{#each entry.capabilities as cap (cap)}
										<span
											class="rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase
												{cap === 'owner' || cap === 'admin'
												? 'bg-primary/10 text-primary'
												: 'bg-muted text-muted-foreground'}">{sparkCapLabel(cap)}</span
										>
									{/each}
									{#if !entry.isThisDevice}
										<button
											type="button"
											class="text-destructive hover:bg-destructive/10 ml-auto rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
											disabled={revokeBusyDid !== undefined}
											onclick={() => void revokeAdmin(entry.did, entry.label)}
											>{revokeBusyDid === entry.did
												? t('sparks.share.revoking')
												: confirmRevokeDid === entry.did
													? t('sparks.share.revokeConfirmInline')
													: t('sparks.share.revoke')}</button
										>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					{#if revokeErr}
						<p class="text-destructive text-sm">{t('sparks.share.revokeFailed')}: {revokeErr}</p>
					{/if}
					{#if revokeNote}
						<p class="text-muted-foreground text-sm">{revokeNote}</p>
					{/if}
				{/if}
			</section>

			<!-- Give access -->
			<section class="flex flex-col gap-4">
				<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">
					{t('sparks.share.giveAccess')}
				</h2>
				<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
					<input
						class="border-border/60 bg-background/40 min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-[12px]"
						placeholder={t('sparks.share.didPlaceholder')}
						bind:value={addAdminDid}
						disabled={adminBusy}
					/>
					<button
						type="button"
						class="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
						disabled={adminBusy || !addAdminDid.trim()}
						onclick={() => void addAdmin()}
					>
						{adminBusy ? '…' : t('sparks.share.addAsAdmin')}
					</button>
				</div>
				<p class="text-muted-foreground text-xs leading-relaxed">{t('sparks.share.giveAccessHint')}</p>
				{#if adminErr}
					<p class="text-destructive text-sm">{adminErr}</p>
				{/if}
				{#if addNote}
					<p class="text-muted-foreground text-sm">{addNote}</p>
				{/if}
			</section>

			<!-- Replication server: grant a server aven a blind store-and-forward cap (no keyshare) -->
			<section class="flex flex-col gap-4">
				<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">
					{t('sparks.share.addReplica')}
				</h2>
				{#if session?.relayDid}
					<!-- One-click: the relay this device is synced through is already
					     authenticated — grant it without copying a DID from logs. -->
					<div class="border-border/50 bg-background/40 flex flex-col gap-2 rounded-xl border px-4 py-3">
						<p class="text-xs font-medium">{t('sparks.share.connectedRelay')}</p>
						<code class="text-muted-foreground font-mono text-[11px] break-all select-text" title={session.relayDid}>{session.relayDid}</code>
						<button
							type="button"
							class="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 self-start rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
							disabled={replicateBusy}
							onclick={() => void addReplicate(session?.relayDid ?? undefined)}
						>
							{replicateBusy ? '…' : t('sparks.share.replicateToConnected')}
						</button>
					</div>
				{/if}
				<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
					<input
						class="border-border/60 bg-background/40 min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-[12px]"
						placeholder={t('sparks.share.replicaDidPlaceholder')}
						bind:value={addReplicateDid}
						disabled={replicateBusy}
					/>
					<button
						type="button"
						class="bg-muted hover:bg-muted/70 shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
						disabled={replicateBusy || !addReplicateDid.trim()}
						onclick={() => void addReplicate()}
					>
						{replicateBusy ? '…' : t('sparks.share.addReplicaButton')}
					</button>
				</div>
				<p class="text-muted-foreground text-xs leading-relaxed">{t('sparks.share.replicaHint')}</p>
				{#if replicateErr}
					<p class="text-destructive text-sm">{replicateErr}</p>
				{/if}
				{#if replicateNote}
					<p class="text-muted-foreground text-sm">{replicateNote}</p>
				{/if}
			</section>

			<!-- Debug: copy the sync log (forwarding gate + peer/mesh state) to report issues -->
			<section class="border-border/40 flex items-center justify-between gap-3 border-t pt-4">
				<p class="text-muted-foreground text-xs leading-relaxed">{t('peers.copyDebugHint')}</p>
				<button
					type="button"
					class="bg-muted hover:bg-muted/70 shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium"
					onclick={() => void copyDebug()}>{debugCopied ? t('peers.copied') : t('peers.copyDebug')}</button
				>
			</section>
		</div>
	{/if}
{:else if tauri && unlocked && sparkId.trim()}
	<!-- Compact aside layout (kept for any future reuse) -->
	<section class="flex flex-col gap-2 px-0 md:px-2">
		<h3 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">
			{t('sparks.share.whoHasAccess')}
		</h3>

		{#if err}
			<p class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] select-text">{err}</p>
		{:else if busy && adminDids.length === 0}
			<p class="text-muted-foreground text-xs">{t('common.loadingAdmins')}</p>
		{:else if accessEntries.length === 0}
			<p class="text-muted-foreground text-xs">{t('sparks.share.noOneListed')}</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each accessEntries as entry (entry.did)}
					<li class="rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
						<p class="truncate text-sm font-medium" title={entry.label}>{entry.label}</p>
						{#if !entry.isThisDevice}
							<p class="text-muted-foreground truncate font-mono text-[10px] leading-snug select-text" title={entry.did}>{entry.did}</p>
						{/if}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each entry.capabilities as cap (cap)}
								<span
									class="rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase
										{cap === 'owner' || cap === 'admin'
										? 'bg-primary/10 text-primary'
										: 'bg-muted text-muted-foreground'}">{sparkCapLabel(cap)}</span
								>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-1 flex flex-col gap-1.5">
			<h3 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">
				{t('sparks.share.giveAccess')}
			</h3>
			<input
				class="border-border/60 bg-background/40 w-full rounded-md border px-2.5 py-1.5 font-mono text-[11px]"
				placeholder={t('sparks.share.didPlaceholder')}
				bind:value={addAdminDid}
				disabled={adminBusy}
			/>
			<button
				type="button"
				class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
				disabled={adminBusy || !addAdminDid.trim()}
				onclick={() => void addAdmin()}
			>
				{adminBusy ? '…' : t('sparks.share.addAsAdmin')}
			</button>
			{#if adminErr}
				<p class="text-destructive text-[11px]">{adminErr}</p>
			{/if}
			{#if addNote}
				<p class="text-muted-foreground text-[11px]">{addNote}</p>
			{/if}
		</div>
	</section>
{/if}
