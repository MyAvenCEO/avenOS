import { invoke } from '@tauri-apps/api/core'
import { grooveRuntime } from '$lib/runtime/groove-ipc'

export type PeerInviteCreateReply = {
	code: string
}

export async function peerSwarmRetry(): Promise<void> {
	await invoke<void>('plugin:peer|peer_swarm_retry')
}

export async function peerInviteCreate(): Promise<PeerInviteCreateReply> {
	return invoke<PeerInviteCreateReply>('plugin:peer|peer_invite_create')
}

export async function peerInviteAccept(code: string): Promise<void> {
	await invoke<void>('plugin:peer|peer_invite_accept', { code })
}

export async function peerInviteCancel(): Promise<void> {
	await invoke<void>('plugin:peer|peer_invite_cancel')
}

/**
 * DHT-lifecycle counters scraped from aven-p2p `tracing` events.
 *
 * - `dhtBootstrapped` is `true` once aven-p2p DHT receives a UDP reply from the bootstrap
 *   node — on iOS we routinely see `false` here while `hyperswarmRunning` is `true`, which
 *   proves the bootstrap UDP packets are being dropped by the network (router / carrier).
 * - `lastAnnounceClosest === 0` means the announce committed to zero DHT nodes (same root cause).
 * - `lastLookupPeerCount === 1` on a quiet topic = "only me" — peer pairing will never link
 *   until the OTHER device's announce reaches the bootstrap too.
 * - `handshakeRelayForwardTotal`: DHT forwarded `PEER_HANDSHAKE` between peers (CGNAT relay path).
 * - `swarmPeerConnectedTotal`: outbound swarm established a UDX link.
 * - `lastConnectRelayed` / `lastRemoteHolepunchable`: last HyperDHT “deciding connection path” scrape after Noise (~`relayed=` / `remote_holepunchable=`). Expect `true`/`true` on Fly-relay pairing when swarm holepunch metadata is wired.
 * - `holepunchBlindRelayFallbackTotal`: holepunch failed and stack fell back to blind relay (`relay_through`).
 */
export type DhtTraceSnapshot = {
	dhtBootstrapped: boolean
	lastAnnounceClosest: number
	lastLookupPeerCount: number
	discoveredPeerTotal: number
	handshakeRelayForwardTotal: number
	swarmPeerConnectedTotal: number
	/** Last `relayed` from Noise “deciding connection path” (`null` if not seen yet). */
	lastConnectRelayed: boolean | null
	/** Last `remote_holepunchable` from the same tracing line. */
	lastRemoteHolepunchable: boolean | null
	/** Times holepunch failed and the stack fell back to blind relay (`relays_through`). */
	holepunchBlindRelayFallbackTotal: number
}

export async function avenosDhtTraceSnapshot(): Promise<DhtTraceSnapshot> {
	return invoke<DhtTraceSnapshot>('avenos_dht_trace_snapshot')
}

/** One-shot HTTPS GET to the relay manifest URL. Proves TCP/443 reachability separately from UDP DHT. */
export type RelayHttpsProbe = {
	ok: boolean
	status?: number
	latencyMs?: number
	error?: string
	url?: string
}

export async function avenosRelayHttpsProbe(): Promise<RelayHttpsProbe> {
	return invoke<RelayHttpsProbe>('avenos_relay_https_probe')
}

export async function avenosRecentRustLogs(): Promise<string[]> {
	return invoke<string[]>('avenos_recent_rust_logs')
}

export type PeerRowReply = {
	id: string
	peerDid: string
	deviceLabel: string
	kind: string
	addedAtMs: number
	status: string
}

/** Table pushes use Groove column names (`peer_did`); IPC `peerList` uses camelCase. */
export function normalizePeerRow(row: unknown): PeerRowReply {
	const r = row as Record<string, unknown>
	const added = r.addedAtMs ?? r.added_at_ms
	return {
		id: String(r.id ?? ''),
		peerDid: String(r.peerDid ?? r.peer_did ?? ''),
		deviceLabel: String(r.deviceLabel ?? r.device_label ?? ''),
		kind: String(r.kind ?? ''),
		addedAtMs: typeof added === 'number' ? added : Number(added ?? 0),
		status: String(r.status ?? ''),
	}
}

export async function peerList(): Promise<PeerRowReply[]> {
	return grooveRuntime<PeerRowReply[]>('peerList', {})
}

export async function peerRevoke(peerDid: string): Promise<void> {
	await grooveRuntime('peerRevoke', { peerDid })
}
