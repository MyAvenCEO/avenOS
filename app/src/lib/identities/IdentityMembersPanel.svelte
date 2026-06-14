<script lang="ts">
import { browser } from '$app/environment'
import { withTimeoutMs } from '$lib/async-timeout'
import {
	type AvenDbRow,
	type AvenDbSessionReply,
	avenCeoAddMember,
	avenCeoMembership,
	avenDbStatus,
	avendbSession,
	type IdentityGrant,
	type IdentitySubjectCaps,
	type PeerRow,
	peerList,
	sparkAdminAdd,
	sparkAdminList,
	sparkAdminRevoke,
	sparkReaderAdd,
	sparkReplicateAdd
} from '$lib/avendb/api'
import { avenDbStore } from '$lib/avendb/store.svelte'
import { formatDebugReport, recentRustLogs } from '$lib/debug/console-capture'
import { t } from '$lib/i18n'
import { peerDisplayLabel } from '$lib/peer/display-label'
// Mesh snapshot kept ONLY for the copyable debug report (diagnostics), not for
// any UI display — per-peer connection state is intentionally not shown.
import { peerMeshSnapshot } from '$lib/peer/peer-mesh-store'
import { waitForAvenDbSessionReady } from '$lib/runtime/avendb-runtime'
import { copyToClipboard } from '$lib/runtime/clipboard'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { pairingLabelForSession } from '$lib/settings/active-vault-ui'
import { deviceSession } from '$lib/settings/device-session-store'
import { signerTypeLabelKey, vaultList } from '$lib/settings/vault'

let {
	identityId,
	wide = false,
	isAvenCeo = false
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
// Role label (Admin/Reader/Relay, board 0047) — distinct from cap labels so a relay
// shows "Relay" (role) + "Replicate" (cap), not two "Replicate" badges.
function grantLabel(grant: IdentityGrant): string {
	// On the avenCEO/network identity a `reader` grant IS the network admission (avenCeoAddMember)
	// — i.e. TIER-0. Label it as such so "invite a member to the network" is unambiguous (board
	// 0047: reads-on-avenCEO = TIER-0; the dual label resolved at the presentation layer).
	if (isAvenCeo && grant === 'reader') return t('identities.share.grants.tier0')
	return t(`identities.share.grants.${grant}`)
}
/// Display order for the Capabilities tab; any unknown cap falls in after these.
const CAP_ORDER = [
	'read',
	'write',
	'delete',
	'admit',
	'rotate_dek',
	'replicate',
	'quota',
	'rate_limit'
]

// Distinct effective caps across all access holders (incl. synthesized SYNC policy
// caps), ordered — drives the "how these permissions work" legend (H2).
const capsInUse = $derived.by((): string[] => {
	const set = new Set<string>()
	for (const e of accessEntries) for (const c of e.capabilities) set.add(c)
	return [...CAP_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CAP_ORDER.includes(c))]
})

type MembersTab = 'members' | 'caps'
let activeTab = $state<MembersTab>('members')

// Unified "Give access": one DID + a role (board 0047 — a role IS a named cap
// bundle: admin/reader/relay). The caps each confers come from the backend
// (`grant_kind_caps` SSOT) and show on the resulting member card (none hardcoded here).
const GRANT_KINDS: IdentityGrant[] = ['admin', 'reader', 'relay']
let grantKind = $state<IdentityGrant>('admin')
function grantDescKey(grant: IdentityGrant): string {
	// avenCEO `reader` = TIER-0 network admission (see grantLabel).
	if (isAvenCeo && grant === 'reader') return 'identities.share.grantDescTier0'
	return grant === 'admin'
		? 'identities.share.grantDescAdmin'
		: grant === 'reader'
			? 'identities.share.grantDescReader'
			: 'identities.share.grantDescRelay'
}

const LOCAL_IPC_BUDGET_MS = 12_000

let session = $state<AvenDbSessionReply | undefined>()
let err = $state<string | undefined>()
let busy = $state(false)
let adminDids = $state<string[]>([])
let replicaDids = $state<string[]>([])
// THE caps source for the UI: every subject + grant + effective caps, from the
// biscuit (`identity_cap_report`). Both tabs derive from this; nothing is hardcoded.
let subjects = $state<IdentitySubjectCaps[]>([])
// Backend-computed manage right (same authorize gate as the grant IPCs, full
// N-hop SAFE-in-SAFE walk) — drives the owner-only GIVE ACCESS form.
let viewerOwns = $state(false)
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
// Fail-closed revocation (board 0047): this device was revoked from the identity (genesis
// re-sealed beyond every held DEK + no admin cap). The shell reports it on hydrate; the UI
// locks the identity. The local cache is purged by the shell — physics: we can't delete bytes
// remotely, so the revoked device self-locks + self-purges.
const isRevokedSelf = $derived((session?.revokedSelf ?? []).includes(identityId.trim()))
// TIER-0 network admission (board 0047): "you may sync on this network at all" — granted to me
// BY the network (avenCEO roster), distinct from the per-SAFE RELAY grant I authorize. Surfaced
// as its own role so the two "sync" concepts (admission vs relay) are no longer smeared.
let admission = $state<'owner' | 'member' | 'none'>('none')
const showTier0 = $derived(admission !== 'none')

// The admin roster lives inside the identity's biscuit (`genesis_b64`). That field
// rides the reactive `identities` table store, so a remote admin grant (e.g. the AI
// adds an admin on another device) lands here in realtime over TCP sync. We watch
// it below and re-read the admin list whenever it changes — without it, the panel
// only refreshed on local add/revoke and on a fresh mount (app restart).
const identitiesStore = avenDbStore('safes')
const sparkBiscuit = $derived.by<string | undefined>(() => {
	const sid = identityId.trim().toLowerCase()
	if (!sid) return undefined
	const row = identitiesStore.rows.find(
		(r) =>
			String(r.owner ?? '')
				.trim()
				.toLowerCase() === sid
	)
	return typeof row?.genesis_b64 === 'string' ? row.genesis_b64 : undefined
})

let knownPeers = $state<PeerRow[]>([])
const peersAllow = $derived<PeerRow[]>(!tauri || !unlocked || !identityId.trim() ? [] : knownPeers)

// SAFE-in-SAFE member typing (enforced by the backend, mirrored here for UX):
// human SAFEs admit signers; aven SAFEs admit human SAFEs; spark SAFEs admit
// aven SAFEs. For aven/spark targets we offer a picker over the eligible local
// SAFEs — selecting one fills the DID input with its did:safe:.
const targetRow = $derived(
	identitiesStore.rows.find(
		(r) =>
			String(r.owner ?? '')
				.trim()
				.toLowerCase() === identityId.trim().toLowerCase()
	)
)
const targetType = $derived(String(targetRow?.type ?? 'aven'))
const memberSafeType = $derived(
	targetType === 'aven' ? 'human' : targetType === 'spark' ? 'aven' : null
)
const memberDidsLower = $derived(new Set(subjects.map((s) => s.did.trim().toLowerCase())))
const eligibleMemberSafes = $derived.by(() => {
	if (!memberSafeType || grantKind === 'relay') return []
	return identitiesStore.rows.filter(
		(r) =>
			r.type === memberSafeType &&
			String(r.owner ?? '')
				.trim()
				.toLowerCase() !== identityId.trim().toLowerCase() &&
			!memberDidsLower.has(
				`did:safe:${String(r.owner ?? '')
					.trim()
					.toLowerCase()}`
			)
	)
})
function safeDidFor(row: AvenDbRow): string {
	return `did:safe:${String(row.owner ?? '').trim()}`
}
// Human SAFEs admit concrete signer devices only (did:key:) — UX mirror of the
// backend `enforce_member_type_rule`, so a did:safe: paste fails here instead of
// at the IPC. Replicate grants are always signers, on every type.
const didTypeError = $derived.by<string | undefined>(() => {
	const did = addAdminDid.trim().toLowerCase()
	if (!did) return undefined
	if (targetType === 'human' && did.startsWith('did:safe:'))
		return t('identities.share.humanSignerOnly')
	return undefined
})
// Resolve a did:safe: member back to its local SAFE row (for name display).
function safeRowForDid(did: string): AvenDbRow | undefined {
	const norm = did.trim().toLowerCase()
	if (!norm.startsWith('did:safe:')) return undefined
	const id = norm.slice('did:safe:'.length)
	return identitiesStore.rows.find(
		(r) =>
			String(r.owner ?? '')
				.trim()
				.toLowerCase() === id
	)
}

function peerAccessLabel(
	signerDid: string,
	storedLabel: string | undefined,
	isThisDevice: boolean
): string {
	if (isThisDevice) return t('common.thisDevice')
	return peerDisplayLabel(signerDid, storedLabel, localPairingLabel)
}

type IdentityAccessEntry = {
	did: string
	label: string
	isThisDevice: boolean
	grant: IdentityGrant
	capabilities: string[]
	/// Set when the member is a SAFE (did:safe:) — its type label for the chip.
	safeType?: string
	/// Set when the member is a signer (did:key:) — how its key is held
	/// (apple_se | env_seed | …), shown as the signer-type subtitle.
	signerType?: string
}

// Member-centric view: each subject from the biscuit (`subjects`), enriched with
// the peer label. Caps are whatever Rust reported — never re-derived here.
// (Per-peer connection state is intentionally NOT shown — it didn't reflect the
// real sync logic; revisit with proper transport state later.)
const accessEntries = $derived.by((): IdentityAccessEntry[] => {
	const peersByDid = new Map(peersAllow.map((p) => [p.signerDid.trim().toLowerCase(), p] as const))
	const localDid = session?.signerDid?.trim().toLowerCase() ?? ''
	// Derive the local device's own SAFE DID from defaultSparkUrn ("identity:<uuid>")
	// so SAFE-in-SAFE owner entries are recognised as "this device".
	const localSafeDid = session?.defaultSparkUrn?.startsWith('identity:')
		? `did:safe:${session.defaultSparkUrn.slice('identity:'.length).toLowerCase()}`
		: ''
	return subjects.map((s): IdentityAccessEntry => {
		const norm = s.did.trim().toLowerCase()
		// SAFE member (did:safe:) — show its SAFE name + type, not a peer label.
		if (norm.startsWith('did:safe:')) {
			const safe = safeRowForDid(s.did)
			const isThisDevice = localSafeDid !== '' && norm === localSafeDid
			return {
				did: s.did,
				label: String(safe?.name ?? '') || t('common.unnamed'),
				isThisDevice,
				grant: s.grant,
				capabilities: s.caps,
				safeType: String(safe?.type ?? 'safe')
			}
		}
		const peer = peersByDid.get(norm)
		const isThisDevice = localDid !== '' && norm === localDid
		// D1: real names. Prefer the roster device label (Admina/Bobo); the connected
		// aven relay is labelled as such; otherwise fall through to the short DID —
		// never a misleading hardcoded "Replication Server".
		const isRelay = norm !== '' && norm === (session?.relayDid?.trim().toLowerCase() ?? '\0')
		const fallback = isRelay ? t('identities.share.syncRelay') : undefined
		// Empty stored label (grant-side rows no longer stamp a role word) → fall back
		// to the relay label or, via peerDisplayLabel, the short DID — never a role word.
		const label = peerAccessLabel(s.did, peer?.deviceLabel?.trim() || fallback, isThisDevice)
		// did:key signer — surface how its key is held (env_seed for the server,
		// apple_se for a human device). isThisDevice has no peer row → apple_se.
		const signerType = peer?.signerType?.trim() || (isThisDevice ? 'apple_se' : undefined)
		return { did: s.did, label, isThisDevice, grant: s.grant, capabilities: s.caps, signerType }
	})
})

// Owner-only management: only a holder of `owns` may grant/revoke. A read-only
// member sees the roster but NO manage controls — so it can't hit the
// `subject_not_owner` dead-end (members are read-only by design).
// `viewerOwns` is backend truth (same authorize gate as the grant IPCs, full
// N-hop SAFE-in-SAFE walk) — DID-equality alone misses transitive control,
// e.g. a human-SAFE signer managing the aven SAFE its human SAFE owns.
const amOwner = $derived(
	viewerOwns || accessEntries.some((e) => e.isThisDevice && e.grant === 'admin')
)

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
	const ordered = [
		...CAP_ORDER.filter((c) => map.has(c)),
		...[...map.keys()].filter((c) => !CAP_ORDER.includes(c))
	]
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
				await waitForAvenDbSessionReady()
				const status = await avenDbStatus()
				if (!status.ready) {
					throw new Error(t('errors.avendbShellNotReady'))
				}
				const nextSession = await avendbSession()
				if (gen !== adminLoadGen) return
				session = nextSession

				// TIER-0 admission (board 0047): a local vault check of network membership.
				admission = await avenCeoMembership().catch(() => 'none' as const)
				if (gen !== adminLoadGen) return

				knownPeers = (await peerList()).filter((p) => p.status === 'active')
				if (gen !== adminLoadGen) return

				if (sid) {
					const a = await sparkAdminList(sid)
					if (gen !== adminLoadGen) return
					adminDids = a.adminDids
					replicaDids = a.replicaDids ?? []
					subjects = a.subjects ?? []
					viewerOwns = a.viewerOwns === true
				} else {
					adminDids = []
					replicaDids = []
					subjects = []
					viewerOwns = false
				}
				addAdminDid = ''
				addNote = undefined
				adminErr = undefined
			})(),
			LOCAL_IPC_BUDGET_MS,
			t('errors.shareLoadingStalled')
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
		viewerOwns = a.viewerOwns === true
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
		if (kind === 'admin') await sparkAdminAdd({ identityId: sid, signerDid: did })
		else if (kind === 'reader')
			if (isAvenCeo)
				// On avenCEO, "Reader" is the full membership bundle (reads + keyshare +
				// row-scoped self-publish write); elsewhere it's a plain read grant.
				await avenCeoAddMember(did)
			else await sparkReaderAdd({ identityId: sid, signerDid: did })
		else await sparkReplicateAdd({ identityId: sid, signerDid: did })
		// The grant SUCCEEDED — always clear the input + show the note, even though a
		// concurrent re-hydration (the grant triggers a sync, which reloads the roster)
		// may have bumped adminLoadGen. Only the roster-state write below is gen-guarded,
		// so a stale grant can't clobber a newer load.
		if (!opts?.did) addAdminDid = ''
		addNote = t('identities.share.accessGrantedNote')
		const a = await sparkAdminList(sid)
		if (gen === adminLoadGen) {
			adminDids = a.adminDids
			replicaDids = a.replicaDids ?? []
			subjects = a.subjects ?? []
			viewerOwns = a.viewerOwns === true
		}
	} catch (e) {
		adminErr = e instanceof Error ? e.message : String(e)
	} finally {
		// Always re-enable the form — `adminBusy` reflects THIS operation, not a load gen.
		adminBusy = false
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
		await sparkAdminRevoke({ identityId: sid, signerDid: did })
		if (gen !== adminLoadGen) return
		revokeNote = t('identities.share.revokedNote', { label })
		const a = await sparkAdminList(sid)
		if (gen !== adminLoadGen) return
		adminDids = a.adminDids
		replicaDids = a.replicaDids ?? []
		subjects = a.subjects ?? []
		viewerOwns = a.viewerOwns === true
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
	viewerOwns = false
	addAdminDid = ''
	void loadSessionAndAdmins()
})

// Realtime reactivity: when the current identity's biscuit changes *without* a
// identity/session switch — i.e. a remote peer (or the AI) granted/revoked admin and
// it synced in over TCP — re-read the roster. We baseline-skip the first sighting
// and any identity switch (the main effect above owns those) so this fires only on a
// genuine in-place biscuit change, and never clobbers what the user is typing.
let adminWatchSpark: string | undefined
let adminWatchBiscuit: string | undefined
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
			ownDid: session?.signerDid ?? '',
			adminDids,
			replicaDids,
			peerRows,
			meshSnapshot: $peerMeshSnapshot
		},
		rustLogs
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
	const did = session?.signerDid
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
				{#if amOwner}
					<!-- Give access (owner-only): a read-only member sees the roster, not this form. -->
					<section
						class="border-border/50 bg-background/40 flex flex-col gap-3 rounded-xl border p-4"
					>
						<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">
							{t('identities.share.giveAccess')}
						</h2>
						{#if memberSafeType && grantKind !== 'relay'}
							<!-- SAFE-in-SAFE picker: aven SAFEs admit human SAFEs, spark SAFEs admit
					     aven SAFEs (backend-enforced). Picking fills the DID input below. -->
							<div class="flex flex-col gap-1.5">
								<span class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
									{memberSafeType === 'human'
								? t('identities.share.addMemberSafeHuman')
								: t('identities.share.addMemberSafeAven')}
								</span>
								{#if eligibleMemberSafes.length > 0}
									<select
										class="border-border/60 bg-background/40 w-full rounded-lg border px-3 py-2 text-sm"
										disabled={adminBusy}
										onchange={(e) => (addAdminDid = e.currentTarget.value)}
									>
										<option value="">{t('identities.share.pickSafePlaceholder')}</option>
										{#each eligibleMemberSafes as r (r.owner)}
											<option value={safeDidFor(r)}>{r.name || t('common.unnamed')}</option>
										{/each}
									</select>
								{:else}
									<p class="text-muted-foreground text-xs leading-relaxed">
										{t('identities.share.noEligibleSafes')}
									</p>
								{/if}
							</div>
						{/if}
						<input
							class="border-border/60 bg-background/40 w-full rounded-lg border px-3 py-2 font-mono text-[12px]"
							placeholder={memberSafeType && grantKind !== 'relay'
						? t('identities.share.safeDidPlaceholder')
						: targetType === 'human'
							? t('identities.share.signerDidPlaceholder')
							: t('identities.share.didPlaceholder')}
							bind:value={addAdminDid}
							disabled={adminBusy}
						>
						{#if didTypeError}
							<p class="text-destructive text-xs">{didTypeError}</p>
						{/if}
						<!-- Grant kind: the biscuit's three bundles (owns/reads/replicate). The
				     actual caps each confers show on the member card after granting. -->
						<div class="flex flex-col gap-1.5">
							<span class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase"
								>{t('identities.share.accessLevel')}</span
							>
							<div class="flex flex-wrap gap-2">
								{#each GRANT_KINDS as gk (gk)}
									<button
										type="button"
										class="rounded-lg border px-3 py-1.5 text-sm font-medium {grantKind === gk
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border/60 text-muted-foreground hover:text-foreground'}"
										onclick={() => (grantKind = gk)}
									>
										{grantLabel(gk)}
									</button>
								{/each}
							</div>
							<p class="text-muted-foreground text-xs leading-relaxed">
								{t(grantDescKey(grantKind))}
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<button
								type="button"
								class="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
								disabled={adminBusy || !addAdminDid.trim() || !!didTypeError}
								onclick={() => void grantAccess()}
							>
								{adminBusy ? '…' : t('identities.share.grantAccess')}
							</button>
							<!-- The connected relay is auto-granted RELAY at SAFE creation
							     (auto_relay_sync_on_create). To re-add a relay manually, grant the
							     RELAY role to its DID via the unified "Give access" flow above — no
							     bespoke button (board 0047 DRY: one manual path = the RELAY role). -->
						</div>
						{#if adminErr}
							<p class="text-destructive text-sm">{adminErr}</p>
						{/if}
						{#if addNote}
							<p class="text-muted-foreground text-sm">{addNote}</p>
						{/if}
						<p class="text-muted-foreground text-xs leading-relaxed">
							{t('identities.share.giveAccessHint')}
						</p>
					</section>
				{/if}

				<!-- Who has access -->
				<section class="flex flex-col gap-4">
					<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">
						{t('identities.share.whoHasAccess')}
					</h2>
					{#if isRevokedSelf}
						<!-- Fail-closed revocation (board 0047): this device was revoked → locked. -->
						<p
							class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm select-text"
						>
							{t('identities.share.revokedSelfLocked')}
						</p>
					{/if}
					{#if showTier0}
						<!-- TIER-0 network admission (board 0047): granted to this device BY the
						     network (avenCEO roster) — distinct from a per-SAFE RELAY grant. -->
						<div class="flex items-center gap-2 text-xs">
							<span class="rounded bg-foreground px-2 py-1 font-bold tracking-widest text-background uppercase">
								{t('identities.share.grants.tier0')}
							</span>
							<span class="opacity-60">{t('identities.share.grantDescTier0')}</span>
						</div>
					{/if}
					{#if err}
						<p
							class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm select-text"
						>
							{err}
						</p>
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
										<p
											class="text-muted-foreground mt-0.5 font-mono text-[11px] leading-snug select-text break-all"
											title={entry.did}
										>
											{entry.did}
										</p>
									{/if}
									<div class="mt-2 flex flex-wrap items-center gap-1.5">
										<!-- Grant kind (owns/reads/replicate) — primary; effective caps — muted. Biscuit caps + synthesized SYNC policy caps (10 MB / rate). Hover/legend = description. -->
										{#if entry.safeType}
											<span
												class="bg-accent text-accent-foreground rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
												>{t('identities.share.safeChip', { type: entry.safeType })}</span
											>
										{/if}
										{#if entry.signerType}
											<span
												class="bg-accent text-accent-foreground rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
												>{t(signerTypeLabelKey(entry.signerType))}</span
											>
										{/if}
										<span
											class="bg-primary/10 text-primary rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
											>{grantLabel(entry.grant)}</span
										>
										{#each entry.capabilities as cap (cap)}
											<span
												class="bg-muted text-muted-foreground rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
												title={capDescription(cap)}
												>{capLabel(cap)}</span
											>
										{/each}
										{#if entry.isThisDevice}
											<button
												type="button"
												class="bg-muted hover:bg-muted/70 ml-auto rounded-md px-2.5 py-1 text-[11px] font-medium"
												onclick={() => void copyOwnDid()}
											>
												{didCopied ? t('peers.copied') : t('common.copyDid')}
											</button>
										{:else if amOwner}
											<button
												type="button"
												class="border-destructive/40 text-destructive hover:bg-destructive/10 ml-auto rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
												disabled={revokeBusyDid !== undefined}
												onclick={() => void revokeAdmin(entry.did, entry.label)}
											>
												{revokeBusyDid === entry.did ? t('identities.share.revoking') : t('identities.share.revoke')}
											</button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
						{#if revokeErr}
							<p class="text-destructive text-sm">
								{t('identities.share.revokeFailed')}: {revokeErr}
							</p>
						{/if}
						{#if revokeNote}
							<p class="text-muted-foreground text-sm">{revokeNote}</p>
						{/if}
						{#if capsInUse.length > 0}
							<details class="border-border/40 mt-1 rounded-lg border bg-background/30 px-3 py-2">
								<summary
									class="text-muted-foreground hover:text-foreground cursor-pointer text-[11px] font-medium select-none"
								>
									{t('identities.share.capsLegendTitle')}
								</summary>
								<ul class="mt-2 flex flex-col gap-1.5">
									{#each capsInUse as cap (cap)}
										<li class="flex items-start gap-2">
											<span
												class="bg-muted text-muted-foreground mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
												>{capLabel(cap)}</span
											>
											<span class="text-muted-foreground text-[11px] leading-snug"
												>{capDescription(cap)}</span
											>
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
					>
						{debugCopyFailed
						? t('peers.copyFailed')
						: debugCopied
							? t('peers.copied')
							: t('peers.copyDebug')}
					</button>
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
			<p
				class="text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] select-text"
			>
				{err}
			</p>
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
							<p
								class="text-muted-foreground truncate font-mono text-[10px] leading-snug select-text"
								title={entry.did}
							>
								{entry.did}
							</p>
						{/if}
						<div class="mt-1 flex flex-wrap gap-1">
							{#if entry.safeType}
								<span
									class="bg-accent text-accent-foreground rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase"
									>{t('identities.share.safeChip', { type: entry.safeType })}</span
								>
							{/if}
							{#if entry.signerType}
								<span
									class="bg-accent text-accent-foreground rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase"
									>{t(signerTypeLabelKey(entry.signerType))}</span
								>
							{/if}
							<span
								class="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase"
								>{grantLabel(entry.grant)}</span
							>
							{#each entry.capabilities as cap (cap)}
								<span
									class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase"
									title={capDescription(cap)}
									>{capLabel(cap)}</span
								>
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
				placeholder={targetType === 'human'
					? t('identities.share.signerDidPlaceholder')
					: t('identities.share.didPlaceholder')}
				bind:value={addAdminDid}
				disabled={adminBusy}
			>
			{#if didTypeError}
				<p class="text-destructive text-[11px]">{didTypeError}</p>
			{/if}
			<button
				type="button"
				class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
				disabled={adminBusy || !addAdminDid.trim() || !!didTypeError}
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
