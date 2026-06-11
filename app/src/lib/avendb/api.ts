import type { UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getTableRowsStore } from '$lib/runtime/table-stores'
import { avenDbRuntime } from '$lib/runtime/avendb-ipc'

/** The well-known avenCEO control-identity id for this network (deterministic from
 *  the network seed — every device computes the same one). */
export async function avenCeoSparkId(): Promise<string> {
	return invoke<string>('aven_ceo_identity')
}

/** Network membership for the invite-only gate: 'owner' | 'member' | 'none'.
 *  A local vault check — the server grants caps; this reads what we hold. */
export async function avenCeoMembership(): Promise<'owner' | 'member' | 'none'> {
	return avenDbRuntime<'owner' | 'member' | 'none'>('avenCeoMembership', {})
}

/** Onboard a member to the avenCEO roster by DID (the inverted invite): grants the
 *  membership bundle — read the roster + write only their own profile row. Owner-only. */
export async function avenCeoAddMember(signerDid: string): Promise<void> {
	await avenDbRuntime('avenCeoAddMember', { signerDid })
}

/** Self-publish this device's profile into its own avenCEO roster row. */
export async function avenCeoPublishProfile(accountName: string, deviceLabel: string): Promise<void> {
	await avenDbRuntime('avenCeoPublishProfile', { accountName, deviceLabel })
}

/** Create a new user-owned SAFE. `type`: 'human' (a person/persona), 'aven'
 *  (a group/workspace), or 'spark' (a cross-aven company). This device mints its
 *  genesis biscuit (→ owner) + DEK + self-keyshare. Returns the new id. */
export async function createIdentity(name: string, type: 'human' | 'aven' | 'spark'): Promise<string> {
	return avenDbRuntime<string>('createIdentity', { name, type })
}

/** Untyped avenDB row from IPC — schema lives in Rust (`libs/aven-schema`). */
export type AvenDbRow = Record<string, any> & { id: string }

export type AvenDbStatusReply = {
	ready: boolean
	tables: string[]
	session?: AvenDbSessionReply
	message?: string
}

export type AvenDbSessionReply = {
	signerDid: string
	signerDidShort: string
	defaultSparkUrn: string
	/** did:key of the aven-node relay this device is synced through, if any. */
	relayDid?: string | null
}

export async function avendbSession(): Promise<AvenDbSessionReply> {
	return avenDbRuntime<AvenDbSessionReply>('session', {})
}

export async function avendbBootstrap(): Promise<AvenDbStatusReply> {
	return avenDbRuntime<AvenDbStatusReply>('bootstrap', {})
}

export async function avenDbStatus(): Promise<AvenDbStatusReply> {
	return avenDbRuntime<AvenDbStatusReply>('status', {})
}

/** Re-register allowlisted Hyperswarm peers + avenDB sync (safe to call after peer table changes). */
export type AvenDbPeerMeshRefreshReply = {
	registeredCount: number
}

export async function avendbPeerMeshRefresh(): Promise<AvenDbPeerMeshRefreshReply> {
	return avenDbRuntime<AvenDbPeerMeshRefreshReply>('peerMeshRefresh', {})
}

/** Add a network peer as identity admin (biscuit + DEK keyshare); peer must be in My Network allowlist. */
export async function sparkAdminAdd(payload: {
	identityId: string
	signerDid: string
}): Promise<void> {
	await avenDbRuntime('sparkAdminAdd', {
		identityId: payload.identityId,
		signerDid: payload.signerDid,
	})
}

/**
 * Grant a server aven a blind `replicate` capability on this identity: it stores &
 * forwards the identity's encrypted batches (durable backup / relay) but gets NO
 * keyshare, so it cannot decrypt. Not membership — see `sparkAdminAdd` for that.
 */
export async function sparkReplicateAdd(payload: {
	identityId: string
	signerDid: string
}): Promise<void> {
	await avenDbRuntime('sparkReplicateAdd', {
		identityId: payload.identityId,
		signerDid: payload.signerDid,
	})
}

/**
 * Grant a peer a delegated `reads` capability + DEK keyshare on this identity: it
 * may decrypt and read the identity's rows but holds NO `owns`, so it cannot write.
 * This is how a member is onboarded onto `admin-identity` (the `reads` grant is the
 * membership credential; the keyshare lets it read the roster). Between
 * `sparkReplicateAdd` (relay, blind) and `sparkAdminAdd` (full owner).
 */
export async function sparkReaderAdd(payload: {
	identityId: string
	signerDid: string
}): Promise<void> {
	await avenDbRuntime('sparkReaderAdd', {
		identityId: payload.identityId,
		signerDid: payload.signerDid,
	})
}

/** A subject's grant kind, read from the identity biscuit. Single source of truth — the
 *  set of cap strings is defined in Rust (`identity_acc`), never hardcoded client-side. */
export type IdentityGrant = 'owns' | 'reads' | 'replicate'

/** One subject's caps on a identity, derived from the biscuit by `identity_cap_report`. */
export type IdentitySubjectCaps = {
	did: string
	grant: IdentityGrant
	/** Effective caps, e.g. read, write, delete, admit, rotate_dek, replicate. */
	caps: string[]
}

export type IdentityAdminListReply = {
	adminDids: string[]
	/** Server avens granted a blind `replicate` cap (store-and-forward backups). */
	replicaDids: string[]
	/** THE cap source of truth: every subject + grant + effective caps from the
	 *  biscuit. The Members UI renders these directly and defines no caps itself. */
	subjects: IdentitySubjectCaps[]
	/** Whether this device may manage the identity (grant/revoke) — computed by the
	 *  backend with the same authorize gate the grant IPCs enforce (full N-hop
	 *  SAFE-in-SAFE walk), so the UI never guesses ownership from DID equality. */
	viewerOwns: boolean
}

export async function sparkAdminList(identityId: string): Promise<IdentityAdminListReply> {
	return avenDbRuntime<IdentityAdminListReply>('sparkAdminList', { identityId })
}

export async function sparkAdminRevoke(_payload: {
	identityId: string
	signerDid: string
}): Promise<void> {
	await avenDbRuntime('sparkAdminRevoke', _payload)
}

/** A trusted peer device (My Network) — flat list, no humans coupling. */
export type PeerRow = {
	id: string
	signerDid: string
	deviceLabel: string
	kind: string
	signerType?: string
	addedAtMs: number
	status: string
}

/** List trusted peers (devices I'm P2P-connected with). */
export async function peerList(): Promise<PeerRow[]> {
	return avenDbRuntime<PeerRow[]>('peerList', {})
}

/** First contact: add a trusted peer by DID (dev paste-DID shortcut). */
export async function peerAdd(payload: { signerDid: string; label?: string }): Promise<void> {
	await avenDbRuntime('peerAdd', { signerDid: payload.signerDid, label: payload.label ?? '' })
}

/** Remove a trusted peer from My Network. */
export async function peerForget(signerDid: string): Promise<void> {
	await avenDbRuntime('peerRevoke', { signerDid })
}

/** Result of explorer list — rows omit unauthorized biscuit/identity gates; count is diagnostics-only. */
export type AvenDbExplorerListReply = {
	rows: AvenDbRow[]
	skippedUnauthorizedRows: number
}

export async function avenDbExplorerList(table: string): Promise<AvenDbExplorerListReply> {
	return avenDbRuntime<AvenDbExplorerListReply>('explorerList', { table })
}

/**
 * Ref-counted subscribe on the avenDB actor; row snapshots arrive on `avenos:runtime`
 * `{ kind: 'table', table, rows }` → [`getTableRowsStore`].
 */
async function subscribeToTableSnapshot(
	table: string,
	handler: (rows: AvenDbRow[]) => void,
): Promise<UnlistenFn> {
	const st = getTableRowsStore(table)
	const un = st.subscribe((rows) => handler(rows as AvenDbRow[]))
	await avenDbRuntime('subscribe', { table })
	return () => {
		un()
		void avenDbRuntime('unsubscribe', { table })
	}
}

export async function avenDbExplorerSubscribe(
	table: string,
	handler: (rows: AvenDbRow[]) => void,
): Promise<UnlistenFn> {
	return subscribeToTableSnapshot(table, handler)
}

/** Table CRUD over JSON IPC (`jazz-tools` runs in the Rust shell only). */
export function avenDbTable(table: string) {
	return {
		async list(): Promise<AvenDbRow[]> {
			return avenDbRuntime<AvenDbRow[]>('list', { table })
		},
		async get(id: string): Promise<AvenDbRow> {
			return avenDbRuntime<AvenDbRow>('get', { table, id })
		},
		async create(values: Record<string, unknown>): Promise<AvenDbRow> {
			return avenDbRuntime<AvenDbRow>('create', { table, values })
		},
		async update(id: string, patch: Record<string, unknown>): Promise<AvenDbRow> {
			return avenDbRuntime<AvenDbRow>('update', { table, id, patch })
		},
		async delete(id: string): Promise<void> {
			await avenDbRuntime('delete', { table, id })
		},
		async subscribe(handler: (rows: AvenDbRow[]) => void): Promise<UnlistenFn> {
			return subscribeToTableSnapshot(table, handler)
		},
	}
}
