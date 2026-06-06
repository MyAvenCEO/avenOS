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
		sparkReaderAdd,
		avenCeoAddMember,
		peerList,
		type PeerRow,
		type JazzSessionReply,
		type IdentitySubjectCaps,
		type IdentityGrant,
	} from '$lib/jazz/api'
	import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
	import { jazzStore } from '$lib/jazz/store.svelte'
	// Mesh snapshot kept ONLY for the copyable debug report (diagnostics), not for
	// any UI display — per-peer connection state is intentionally not shown.
	import { peerMeshSnapshot } from '$lib/peer/peer-mesh-store'
	import { peerDisplayLabel } from '$lib/peer/display-label'
	import { pairingLabelForSession } from '$lib/settings/active-vault-ui'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { vaultList } from '$lib/settings/vault'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { formatDebugReport, recentRustLogs } from '$lib/debug/console-capture'
	import { copyToClipboard } from '$lib/runtime/clipboard'
	import { t } from '$lib/i18n'

	let {
		identityId,
		wide = false,
		isAvenCeo = false,
	}: { identityId: string; wide?: boolean; isAvenCeo?: boolean } = $props()

	// Caps come from the backend (`identity_cap_report` → the identity biscuit). This
	// component defines NO cap vocabulary of its own — it labels whatever grant/cap
	// strings Rust returns. Single source of truth = the biscuit chain.
	function capLabel(key: string): string {
		return t(`identities.share.capabilities.${key}`)
	}
	// Human-readable "what this cap does under the hood" — H2 transparency. The caps
	// themselves (incl. a relay's quota + rate_limit) come from `identity_cap_report` in
	// Rust — the single biscuit-derived source — so this panel synthesizes NOTHING.
	function capDescription(key: string): string {
		return t(`identities.share.capDesc.${key}`)
	}
	// Role/grant label (Owner/Member/Relay) — distinct from cap labels so a relay
	// shows "Relay" (grant) + "Replicate" (cap), not two "Replicate" badges.
	function grantLabel(grant: IdentityGrant): string {
		return t(`identities.share.grants.${grant}`)
	}
	/// Display order for the Capabilities tab; any unknown cap falls in after these.
	const CAP_ORDER = ['read', 'write', 'delete', 'admit', 'rotate_dek', 'replicate', 'quota', 'rate_limit']

	// Distinct effective caps across all access holders (incl. synthesized SYNC policy
	// caps), ordered — drives the "how these permissions work" legend (H2).
	const capsInUse = $derived.by((): string[] => {
		const set = new Set<string>()
		for (const e of accessEntries) for (const c of e.capabilities) set.add(c)
		return [
			...CAP_ORDER.filter((c) => set.has(c)),
			...[...set].filter((c) => !CAP_ORDER.includes(c)),
		]
	})

	type MembersTab = 'members' | 'caps'
	let activeTab = $state<MembersTab>('members')

	// Unified "Give access": one DID + a grant kind. The biscuit model has three
	// grant bundles (owns/reads/replicate); the actual caps each confers come from
	// the backend and show on the resulting member card (no caps hardcoded here).
	const GRANT_KINDS: IdentityGrant[] = ['owns', 'reads', 'replicate']
	let grantKind = $state<IdentityGrant>('owns')
	function grantDescKey(grant: IdentityGrant): string {
		return grant === 'owns'
			? 'identities.share.grantDescOwns'
			: grant === 'reads'
				? 'identities.share.grantDescReads'
				: 'identities.share.grantDescReplicate'
	}

	const LOCAL_IPC_BUDGET_MS = 12_000

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let busy = $state(false)
	let adminDids = $state<string[]>([])
	let replicaDids = $state<string[]>([])
	// THE caps source for the UI: every subject + grant + effective caps, from the
	// biscuit (`identity_cap_report`). Both tabs derive from this; nothing is hardcoded.
	let subjects = $state<IdentitySubjectCaps[]>([])
	let adminErr = $state<string | undefined>()
	let adminBusy = $state(false)
	let addAdminDid = $state('')
	let addNote = $state<string | undefined>()
	let revokeBusyDid = $state<string | undefined>(undefined)
	let revokeErr = $state<string | undefined>()
	let revokeNote = $state<string | undefined>()
	let localPairingLabel = $state<string | undefined>(undefined)
	let debugCopied = $state(false)
	let debugCopyFailed = $state(false)
	let didCopied = $state(false)

	const sessionKind = $derived($deviceSession.kind)
	const unlocked = $derived(sessionKind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	// The admin roster lives inside the identity's biscuit (`genesis_b64`). That field
	// rides the reactive `identities` table store, so a remote admin grant (e.g. the AI
	// adds an admin on another device) lands here in realtime over TCP sync. We watch
	// it below and re-read the admin list whenever it changes — without it, the panel
	// only refreshed on local add/revoke and on a fresh mount (app restart).
	const identitiesStore = jazzStore('identities')
	const sparkBiscuit = $derived.by<string | undefined>(() => {
		const sid = identityId.trim().toLowerCase()
		if (!sid) return undefined
		const row = identitiesStore.rows.find(
			(r) => String(r.owner ?? '').trim().toLowerCase() === sid,
		)
		return typeof row?.genesis_b64 === 'string' ? row.genesis_b64 : undefined
	})

	let knownPeers = $state<PeerRow[]>([])
	const peersAllow = $derived<PeerRow[]>(
		!tauri || !unlocked || !identityId.trim() ? [] : knownPeers,
	)

	function peerAccessLabel(
		peerDid: string,
		storedLabel: string | undefined,
		isThisDevice: boolean,
	): string {
		if (isThisDevice) return t('common.thisDevice')
		return peerDisplayLabel(peerDid, storedLabel, localPairingLabel)
	}

	type IdentityAccessEntry = {
		did: string
		label: string
		isThisDevice: boolean
		grant: IdentityGrant
		capabilities: string[]
	}

	// Member-centric view: each subject from the biscuit (`subjects`), enriched with
	// the peer label. Caps are whatever Rust reported — never re-derived here.
	// (Per-peer connection state is intentionally NOT shown — it didn't reflect the
	// real sync logic; revisit with proper transport state later.)
	const accessEntries = $derived.by((): IdentityAccessEntry[] => {
		const peersByDid = new Map(
			peersAllow.map((p) => [p.peerDid.trim().toLowerCase(), p] as const),
		)
		const localDid = session?.peerDid?.trim().toLowerCase() ?? ''
		return subjects.map((s): IdentityAccessEntry => {
			const norm = s.did.trim().toLowerCase()
			const peer = peersByDid.get(norm)
			const isThisDevice = localDid !== '' && norm === localDid
			const fallback = s.grant === 'replicate' ? t('identities.share.addReplica') : undefined
			const label = peerAccessLabel(s.did, peer?.deviceLabel ?? fallback, isThisDevice)
			return { did: s.did, label, isThisDevice, grant: s.grant, capabilities: s.caps }
		})
	})

	// Cap-centric view (Tab 2): invert subjects → for each actual cap, who holds it.
	// Pure projection of the same single source — guarantees the two tabs agree.
	type CapHolders = { cap: string; holders: IdentityAccessEntry[] }
	const capabilityRows = $derived.by((): CapHolders[] => {
		const map = new Map<string, IdentityAccessEntry[]>()
		for (const e of accessEntries)
			for (const cap of e.capabilities) {
				const list = map.get(cap) ?? []
				list.push(e)
				map.set(cap, list)
			}
		const ordered = [...CAP_ORDER.filter((c) => map.has(c)), ...[...map.keys()].filter((c) => !CAP_ORDER.includes(c))]
		return ordered.map((cap) => ({ cap, holders: map.get(cap) ?? [] }))
	})

	let adminLoadGen = 0

	async function loadSessionAndAdmins(): Promise<void> {
		if (!tauri || !unlocked) {
			session = undefined
			adminDids = []
			return
		}
		const sid = identityId.trim()
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
						replicaDids = a.replicaDids ?? []
						subjects = a.subjects ?? []
					} else {
						adminDids = []
						replicaDids = []
						subjects = []
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
	// identity biscuit changes under us via sync. Session is already loaded by the main
	// effect, so we skip the heavier readiness checks done in loadSessionAndAdmins().
	async function refreshAdminList(): Promise<void> {
		const sid = identityId.trim()
		if (!tauri || !unlocked || !sid) return
		const gen = ++adminLoadGen
		try {
			const peers = (await peerList()).filter((p) => p.status === 'active')
			if (gen !== adminLoadGen) return
			knownPeers = peers
			const a = await sparkAdminList(sid)
			if (gen !== adminLoadGen) return
			adminDids = a.adminDids
			replicaDids = a.replicaDids ?? []
			subjects = a.subjects ?? []
			adminErr = undefined
		} catch (e) {
			if (gen !== adminLoadGen) return
			adminErr = e instanceof Error ? e.message : String(e)
		}
	}

	// Unified grant: one DID + one grant kind (owns/reads/replicate) → the matching
	// biscuit minter. `opts` lets a quick-action (e.g. the connected relay) grant
	// without touching the shared input. Each kind maps to its own IPC:
	//   owns → admin (full)   reads → read-only member   replicate → blind backup.
	async function grantAccess(opts?: { did?: string; kind?: IdentityGrant }): Promise<void> {
		const did = (opts?.did ?? addAdminDid).trim()
		const kind = opts?.kind ?? grantKind
		const sid = identityId.trim()
		if (!did || !sid) return
		const gen = adminLoadGen
		adminBusy = true
		adminErr = undefined
		addNote = undefined
		try {
			if (kind === 'owns') await sparkAdminAdd({ identityId: sid, peerDid: did })
			else if (kind === 'reads')
				// On avenCEO, "Member" is the full membership bundle (reads + keyshare +
				// row-scoped self-publish write); elsewhere it's a plain read grant.
				if (isAvenCeo) await avenCeoAddMember(did)
				else await sparkReaderAdd({ identityId: sid, peerDid: did })
			else await sparkReplicateAdd({ identityId: sid, peerDid: did })
			if (gen !== adminLoadGen) return
			if (!opts?.did) addAdminDid = ''
			addNote = t('identities.share.accessGrantedNote')
			const a = await sparkAdminList(sid)
			if (gen !== adminLoadGen) return
			adminDids = a.adminDids
			replicaDids = a.replicaDids ?? []
			subjects = a.subjects ?? []
		} catch (e) {
			if (gen !== adminLoadGen) return
			adminErr = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === adminLoadGen) adminBusy = false
		}
	}

	// §7 honest-design: revoke stops *future* changes; it never claws back what a
	// peer already holds. Wording and confirm copy say exactly that — never "remove access".
	// Single-click stop-sharing. Revoke is not destructive of what a peer already
	// holds (it only stops *future* changes), so no confirm step — see revokedNote.
	async function revokeAdmin(did: string, label: string): Promise<void> {
		const sid = identityId.trim()
		if (!did || !sid) return
		if (revokeBusyDid) return
		const gen = adminLoadGen
		revokeBusyDid = did
		revokeErr = undefined
		revokeNote = undefined
		addNote = undefined
		try {
			await sparkAdminRevoke({ identityId: sid, peerDid: did })
			if (gen !== adminLoadGen) return
			revokeNote = t('identities.share.revokedNote', { label })
			const a = await sparkAdminList(sid)
			if (gen !== adminLoadGen) return
			adminDids = a.adminDids
			replicaDids = a.replicaDids ?? []
			subjects = a.subjects ?? []
		} catch (e) {
			if (gen !== adminLoadGen) return
			revokeErr = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === adminLoadGen) revokeBusyDid = undefined
		}
	}

	$effect(() => {
		sessionKind
		void identityId
		void unlocked
		void tauri
		adminDids = []
		subjects = []
		addAdminDid = ''
		void loadSessionAndAdmins()
	})

	// Realtime reactivity: when the current identity's biscuit changes *without* a
	// identity/session switch — i.e. a remote peer (or the AI) granted/revoked admin and
	// it synced in over TCP — re-read the roster. We baseline-skip the first sighting
	// and any identity switch (the main effect above owns those) so this fires only on a
	// genuine in-place biscuit change, and never clobbers what the user is typing.
	let adminWatchSpark: string | undefined = undefined
	let adminWatchBiscuit: string | undefined = undefined
	$effect(() => {
		const sid = identityId.trim()
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
	// peer registration), the identity's admin roster, and live peer/mesh state — so
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
				identityId,
				ownDid: session?.peerDid ?? '',
				adminDids,
				replicaDids,
				peerRows,
				meshSnapshot: $peerMeshSnapshot,
			},
			rustLogs,
		)
		// `navigator.clipboard` silently fails in the macOS app sandbox — use the
		// Tauri clipboard plugin (with navigator fallback). Surface success/failure.
		debugCopyFailed = false
		const ok = await copyToClipboard(report)
		if (ok) {
			debugCopied = true
			setTimeout(() => (debugCopied = false), 1500)
		} else {
			debugCopyFailed = true
			setTimeout(() => (debugCopyFailed = false), 2500)
		}
	}

	async function copyOwnDid(): Promise<void> {
		const did = session?.peerDid
		if (!browser || !did) return
		if (await copyToClipboard(did)) {
			didCopied = true
			setTimeout(() => (didCopied = false), 1500)
		}
	}
</script>

{#if wide}
	<!-- Main-area / full-width layout -->
	{#if !tauri || !unlocked}
		<p class="text-muted-foreground text-sm">{t('identities.needsDesktop')}</p>
	{:else if !identityId.trim()}
		<p class="text-muted-foreground text-sm">{t('identities.share.noOneListed')}</p>
	{:else}
		<div class="flex flex-col gap-8">

			{#if activeTab === 'members'}
			<!-- Give access (unified: DID + grant kind), placed ABOVE the member list -->
			<section class="border-border/50 bg-background/40 flex flex-col gap-3 rounded-xl border p-4">
				<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">
					{t('identities.share.giveAccess')}
				</h2>
				<input
					class="border-border/60 bg-background/40 w-full rounded-lg border px-3 py-2 font-mono text-[12px]"
					placeholder={t('identities.share.didPlaceholder')}
					bind:value={addAdminDid}
					disabled={adminBusy}
				/>
				<!-- Grant kind: the biscuit's three bundles (owns/reads/replicate). The
				     actual caps each confers show on the member card after granting. -->
				<div class="flex flex-col gap-1.5">
					<span class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('identities.share.accessLevel')}</span>
					<div class="flex flex-wrap gap-2">
						{#each GRANT_KINDS as gk (gk)}
							<button
								type="button"
								class="rounded-lg border px-3 py-1.5 text-sm font-medium {grantKind === gk
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border/60 text-muted-foreground hover:text-foreground'}"
								onclick={() => (grantKind = gk)}>{grantLabel(gk)}</button
							>
						{/each}
					</div>
					<p class="text-muted-foreground text-xs leading-relaxed">{t(grantDescKey(grantKind))}</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
						disabled={adminBusy || !addAdminDid.trim()}
						onclick={() => void grantAccess()}
					>
						{adminBusy ? '…' : t('identities.share.grantAccess')}
					</button>
					{#if session?.relayDid}
						<!-- Quick action: grant the already-connected relay a blind replicate cap -->
						<button
							type="button"
							class="bg-muted hover:bg-muted/70 ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
							title={session.relayDid}
							disabled={adminBusy}
							onclick={() => void grantAccess({ did: session?.relayDid ?? undefined, kind: 'replicate' })}
						>⚡ {t('identities.share.quickRelay')}</button
						>
					{/if}
				</div>
				{#if adminErr}
					<p class="text-destructive text-sm">{adminErr}</p>
				{/if}
				{#if addNote}
					<p class="text-muted-foreground text-sm">{addNote}</p>
				{/if}
				<p class="text-muted-foreground text-xs leading-relaxed">{t('identities.share.giveAccessHint')}</p>
			</section>

			<!-- Who has access -->
			<section class="flex flex-col gap-4">
				<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">
					{t('identities.share.whoHasAccess')}
				</h2>
				{#if err}
					<p class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm select-text">{err}</p>
				{:else if busy && adminDids.length === 0}
					<p class="text-muted-foreground text-sm">{t('common.loadingAdmins')}</p>
				{:else if accessEntries.length === 0}
					<p class="text-muted-foreground text-sm">{t('identities.share.noOneListed')}</p>
				{:else}
					<ul class="flex flex-col gap-2">
						{#each accessEntries as entry (entry.did)}
							<li class="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
								<p class="min-w-0 text-sm font-semibold" title={entry.label}>{entry.label}</p>
								{#if !entry.isThisDevice}
									<p class="text-muted-foreground mt-0.5 font-mono text-[11px] leading-snug select-text break-all" title={entry.did}>{entry.did}</p>
								{/if}
								<div class="mt-2 flex flex-wrap items-center gap-1.5">
									<!-- Grant kind (owns/reads/replicate) — primary; effective caps — muted. Biscuit caps + synthesized SYNC policy caps (10 MB / rate). Hover/legend = description. -->
									<span class="bg-primary/10 text-primary rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">{grantLabel(entry.grant)}</span>
									{#each entry.capabilities as cap (cap)}
										<span class="bg-muted text-muted-foreground rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase" title={capDescription(cap)}>{capLabel(cap)}</span>
									{/each}
									{#if entry.isThisDevice}
										<button
											type="button"
											class="bg-muted hover:bg-muted/70 ml-auto rounded-md px-2.5 py-1 text-[11px] font-medium"
											onclick={() => void copyOwnDid()}>{didCopied ? t('peers.copied') : t('common.copyDid')}</button
										>
									{:else}
										<button
											type="button"
											class="border-destructive/40 text-destructive hover:bg-destructive/10 ml-auto rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
											disabled={revokeBusyDid !== undefined}
											onclick={() => void revokeAdmin(entry.did, entry.label)}
											>{revokeBusyDid === entry.did ? t('identities.share.revoking') : t('identities.share.revoke')}</button
										>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					{#if revokeErr}
						<p class="text-destructive text-sm">{t('identities.share.revokeFailed')}: {revokeErr}</p>
					{/if}
					{#if revokeNote}
						<p class="text-muted-foreground text-sm">{revokeNote}</p>
					{/if}
					{#if capsInUse.length > 0}
						<details class="border-border/40 mt-1 rounded-lg border bg-background/30 px-3 py-2">
							<summary class="text-muted-foreground hover:text-foreground cursor-pointer text-[11px] font-medium select-none">{t('identities.share.capsLegendTitle')}</summary>
							<ul class="mt-2 flex flex-col gap-1.5">
								{#each capsInUse as cap (cap)}
									<li class="flex items-start gap-2">
										<span class="bg-muted text-muted-foreground mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase">{capLabel(cap)}</span>
										<span class="text-muted-foreground text-[11px] leading-snug">{capDescription(cap)}</span>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				{/if}
			</section>
			<!-- Debug: copy the sync log (forwarding gate + peer/mesh state) to report issues -->
			<section class="border-border/40 flex items-center justify-between gap-3 border-t pt-4">
				<p class="text-muted-foreground text-xs leading-relaxed">{t('peers.copyDebugHint')}</p>
				<button
					type="button"
					class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium {debugCopyFailed
						? 'bg-destructive/10 text-destructive'
						: 'bg-muted hover:bg-muted/70'}"
					onclick={() => void copyDebug()}
					>{debugCopyFailed
						? t('peers.copyFailed')
						: debugCopied
							? t('peers.copied')
							: t('peers.copyDebug')}</button
				>
			</section>
			{/if}

		</div>
	{/if}
{:else if tauri && unlocked && identityId.trim()}
	<!-- Compact aside layout (kept for any future reuse) -->
	<section class="flex flex-col gap-2 px-0 md:px-2">
		<h3 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">
			{t('identities.share.whoHasAccess')}
		</h3>

		{#if err}
			<p class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] select-text">{err}</p>
		{:else if busy && adminDids.length === 0}
			<p class="text-muted-foreground text-xs">{t('common.loadingAdmins')}</p>
		{:else if accessEntries.length === 0}
			<p class="text-muted-foreground text-xs">{t('identities.share.noOneListed')}</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each accessEntries as entry (entry.did)}
					<li class="rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
						<p class="truncate text-sm font-medium" title={entry.label}>{entry.label}</p>
						{#if !entry.isThisDevice}
							<p class="text-muted-foreground truncate font-mono text-[10px] leading-snug select-text" title={entry.did}>{entry.did}</p>
						{/if}
						<div class="mt-1 flex flex-wrap gap-1">
							<span class="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase">{grantLabel(entry.grant)}</span>
							{#each entry.capabilities as cap (cap)}
								<span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase" title={capDescription(cap)}>{capLabel(cap)}</span>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-1 flex flex-col gap-1.5">
			<h3 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">
				{t('identities.share.giveAccess')}
			</h3>
			<input
				class="border-border/60 bg-background/40 w-full rounded-md border px-2.5 py-1.5 font-mono text-[11px]"
				placeholder={t('identities.share.didPlaceholder')}
				bind:value={addAdminDid}
				disabled={adminBusy}
			/>
			<button
				type="button"
				class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
				disabled={adminBusy || !addAdminDid.trim()}
				onclick={() => void grantAccess()}
			>
				{adminBusy ? '…' : t('identities.share.addAsAdmin')}
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
