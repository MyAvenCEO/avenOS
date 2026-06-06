import type { UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getTableRowsStore } from '$lib/runtime/table-stores'
import { grooveRuntime } from '$lib/runtime/groove-ipc'

/** The well-known avenCEO control-spark id for this network (deterministic from
 *  the network seed — every device computes the same one). */
export async function avenCeoSparkId(): Promise<string> {
	return invoke<string>('aven_ceo_spark_id')
}

/** Claim the avenCEO spark: mint its genesis and become the network owner/admin.
 *  Claim-once (errors if already claimed). Returns the avenCEO spark id. */
export async function avenCeoClaim(): Promise<string> {
	return grooveRuntime<string>('avenCeoClaim', {})
}

/** Onboard a member to the avenCEO roster by DID (the inverted invite): grants the
 *  membership bundle — read the roster + write only their own profile row. Owner-only. */
export async function avenCeoAddMember(peerDid: string): Promise<void> {
	await grooveRuntime('avenCeoAddMember', { peerDid })
}

/** Self-publish this device's profile into its own avenCEO roster row. */
export async function avenCeoPublishProfile(accountName: string, deviceLabel: string): Promise<void> {
	await grooveRuntime('avenCeoPublishProfile', { accountName, deviceLabel })
}

/** Untyped Groove row from IPC — schema lives in Rust (`libs/aven-schema`). */
export type JazzRow = Record<string, any> & { id: string }

export type JazzStatusReply = {
	ready: boolean
	tables: string[]
	session?: JazzSessionReply
	message?: string
}

export type JazzSessionReply = {
	peerDid: string
	peerDidShort: string
	defaultSparkUrn: string
	/** did:key of the aven-server relay this device is synced through, if any. */
	relayDid?: string | null
}

export async function jazzSession(): Promise<JazzSessionReply> {
	return grooveRuntime<JazzSessionReply>('session', {})
}

export async function jazzBootstrap(): Promise<JazzStatusReply> {
	return grooveRuntime<JazzStatusReply>('bootstrap', {})
}

export async function jazzStatus(): Promise<JazzStatusReply> {
	return grooveRuntime<JazzStatusReply>('status', {})
}

/** Re-register allowlisted Hyperswarm peers + Groove sync (safe to call after peer table changes). */
export type JazzPeerMeshRefreshReply = {
	registeredCount: number
}

export async function jazzPeerMeshRefresh(): Promise<JazzPeerMeshRefreshReply> {
	return grooveRuntime<JazzPeerMeshRefreshReply>('peerMeshRefresh', {})
}

/** Add a network peer as spark admin (biscuit + DEK keyshare); peer must be in My Network allowlist. */
export async function sparkAdminAdd(payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await grooveRuntime('sparkAdminAdd', {
		sparkId: payload.sparkId,
		peerDid: payload.peerDid,
	})
}

/**
 * Grant a server aven a blind `replicate` capability on this spark: it stores &
 * forwards the spark's encrypted batches (durable backup / relay) but gets NO
 * keyshare, so it cannot decrypt. Not membership — see `sparkAdminAdd` for that.
 */
export async function sparkReplicateAdd(payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await grooveRuntime('sparkReplicateAdd', {
		sparkId: payload.sparkId,
		peerDid: payload.peerDid,
	})
}

/**
 * Grant a peer a delegated `reads` capability + DEK keyshare on this spark: it
 * may decrypt and read the spark's rows but holds NO `owns`, so it cannot write.
 * This is how a member is onboarded onto `admin-spark` (the `reads` grant is the
 * membership credential; the keyshare lets it read the roster). Between
 * `sparkReplicateAdd` (relay, blind) and `sparkAdminAdd` (full owner).
 */
export async function sparkReaderAdd(payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await grooveRuntime('sparkReaderAdd', {
		sparkId: payload.sparkId,
		peerDid: payload.peerDid,
	})
}

/** A subject's grant kind, read from the spark biscuit. Single source of truth — the
 *  set of cap strings is defined in Rust (`spark_acc`), never hardcoded client-side. */
export type SparkGrant = 'owns' | 'reads' | 'replicate'

/** One subject's caps on a spark, derived from the biscuit by `spark_cap_report`. */
export type SparkSubjectCaps = {
	did: string
	grant: SparkGrant
	/** Effective caps, e.g. read, write, delete, admit, rotate_dek, replicate. */
	caps: string[]
}

export type SparkAdminListReply = {
	adminDids: string[]
	/** Server avens granted a blind `replicate` cap (store-and-forward backups). */
	replicaDids: string[]
	/** THE cap source of truth: every subject + grant + effective caps from the
	 *  biscuit. The Members UI renders these directly and defines no caps itself. */
	subjects: SparkSubjectCaps[]
}

export async function sparkAdminList(sparkId: string): Promise<SparkAdminListReply> {
	return grooveRuntime<SparkAdminListReply>('sparkAdminList', { sparkId })
}

export async function sparkAdminRevoke(_payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await grooveRuntime('sparkAdminRevoke', _payload)
}

/** A trusted peer device (My Network) — flat list, no humans coupling. */
export type PeerRow = {
	id: string
	peerDid: string
	deviceLabel: string
	kind: string
	addedAtMs: number
	status: string
}

/** List trusted peers (devices I'm P2P-connected with). */
export async function peerList(): Promise<PeerRow[]> {
	return grooveRuntime<PeerRow[]>('peerList', {})
}

/** First contact: add a trusted peer by DID (dev paste-DID shortcut). */
export async function peerAdd(payload: { peerDid: string; label?: string }): Promise<void> {
	await grooveRuntime('peerAdd', { peerDid: payload.peerDid, label: payload.label ?? '' })
}

/** Remove a trusted peer from My Network. */
export async function peerForget(peerDid: string): Promise<void> {
	await grooveRuntime('peerRevoke', { peerDid })
}

/** Result of explorer list — rows omit unauthorized biscuit/spark gates; count is diagnostics-only. */
export type JazzExplorerListReply = {
	rows: JazzRow[]
	skippedUnauthorizedRows: number
}

export async function jazzExplorerList(table: string): Promise<JazzExplorerListReply> {
	return grooveRuntime<JazzExplorerListReply>('explorerList', { table })
}

/**
 * Ref-counted subscribe on the Groove actor; row snapshots arrive on `avenos:runtime`
 * `{ kind: 'table', table, rows }` → [`getTableRowsStore`].
 */
async function subscribeToTableSnapshot(
	table: string,
	handler: (rows: JazzRow[]) => void,
): Promise<UnlistenFn> {
	const st = getTableRowsStore(table)
	const un = st.subscribe((rows) => handler(rows as JazzRow[]))
	await grooveRuntime('subscribe', { table })
	return () => {
		un()
		void grooveRuntime('unsubscribe', { table })
	}
}

export async function jazzExplorerSubscribe(
	table: string,
	handler: (rows: JazzRow[]) => void,
): Promise<UnlistenFn> {
	return subscribeToTableSnapshot(table, handler)
}

/** Table CRUD over JSON IPC (`jazz-tools` runs in the Rust shell only). */
export function jazzTable(table: string) {
	return {
		async list(): Promise<JazzRow[]> {
			return grooveRuntime<JazzRow[]>('list', { table })
		},
		async get(id: string): Promise<JazzRow> {
			return grooveRuntime<JazzRow>('get', { table, id })
		},
		async create(values: Record<string, unknown>): Promise<JazzRow> {
			return grooveRuntime<JazzRow>('create', { table, values })
		},
		async update(id: string, patch: Record<string, unknown>): Promise<JazzRow> {
			return grooveRuntime<JazzRow>('update', { table, id, patch })
		},
		async delete(id: string): Promise<void> {
			await grooveRuntime('delete', { table, id })
		},
		async subscribe(handler: (rows: JazzRow[]) => void): Promise<UnlistenFn> {
			return subscribeToTableSnapshot(table, handler)
		},
	}
}
