/**
 * Central HyperDHT bootstrap + blind-relay fallback for App Store / Xcode compile embeds.
 * Fetches `/.well-known/aven-relay.json`; falls back to DNS via {@link centralBootstrap}.
 */
import { execFileSync } from 'node:child_process'

import { centralBootstrap, P2P_RELAY_UDP_PORT_DEFAULT } from './p2p-signal.ts'

export type AppStoreRelayConfig = {
	dhtBootstrap: string
	/** 64-char hex Ed25519 public key of hosted blind-relay (optional until manifest serves it). */
	relayPublicKeyHex?: string
	relayHost?: string
	relayUdpPort?: number
	/** `host:port` for `AVENOS_HYPERSWARM_RELAY_ADDR` when pubkey is present. */
	relayAddr?: string
}

type AvenRelayManifest = {
	bootstrap?: string
	host?: string
	dhtUdpPort?: number
	relayPublicKeyHex?: string
	relayUdpPort?: number
}

function resolveIpv4Sync(hostname: string): string | undefined {
	try {
		const out = execFileSync('dig', ['+short', hostname, 'A'], { encoding: 'utf8' })
		for (const line of out.split('\n')) {
			const ip = line.trim()
			if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip
		}
	} catch {
		/* dig unavailable */
	}
	return undefined
}

function relayAddrFromManifest(j: AvenRelayManifest, host: string, dhtPort: number): string | undefined {
	const pk =
		typeof j.relayPublicKeyHex === 'string' && j.relayPublicKeyHex.trim().length === 64
			? j.relayPublicKeyHex.trim()
			: undefined
	if (!pk) return undefined
	const relayPort =
		typeof j.relayUdpPort === 'number' && j.relayUdpPort > 0
			? j.relayUdpPort
			: P2P_RELAY_UDP_PORT_DEFAULT
	const relayHost =
		(typeof j.host === 'string' && j.host.trim()) || host
	const ip = resolveIpv4Sync(relayHost)
	const addrHost = ip ?? relayHost
	return `${addrHost}:${relayPort}`
}

export async function resolveAppStoreDhtBootstrap(
	host: string,
	port: number,
	opts: { warnLabel?: string } = {},
): Promise<string> {
	const cfg = await resolveAppStoreRelayConfig(host, port, opts)
	return cfg.dhtBootstrap
}

export async function resolveAppStoreRelayConfig(
	host: string,
	dhtPort: number,
	opts: { warnLabel?: string } = {},
): Promise<AppStoreRelayConfig> {
	const label = opts.warnLabel ?? 'relay-bootstrap'
	const fallbackBootstrap = centralBootstrap(host, dhtPort)

	try {
		const res = await fetch(`https://${host}/.well-known/aven-relay.json`)
		if (res.ok) {
			const j = (await res.json()) as AvenRelayManifest
			const dhtBootstrap =
				typeof j.bootstrap === 'string' && j.bootstrap.includes('@') ? j.bootstrap : fallbackBootstrap
			const relayPublicKeyHex =
				typeof j.relayPublicKeyHex === 'string' && j.relayPublicKeyHex.trim().length === 64
					? j.relayPublicKeyHex.trim()
					: undefined
			const relayUdpPort =
				typeof j.relayUdpPort === 'number' && j.relayUdpPort > 0
					? j.relayUdpPort
					: P2P_RELAY_UDP_PORT_DEFAULT
			const relayHost = (typeof j.host === 'string' && j.host.trim()) || host
			const relayAddr = relayPublicKeyHex
				? relayAddrFromManifest(j, host, dhtPort) ?? `${host}:${relayUdpPort}`
				: undefined
			return {
				dhtBootstrap,
				relayPublicKeyHex,
				relayHost,
				relayUdpPort: relayPublicKeyHex ? relayUdpPort : undefined,
				relayAddr,
			}
		}
	} catch (e) {
		console.warn(`[${label}] relay manifest fetch failed — falling back to DNS:`, e)
	}

	if (fallbackBootstrap.includes('@')) {
		return { dhtBootstrap: fallbackBootstrap }
	}
	const ip = resolveIpv4Sync(host)
	if (ip) {
		return { dhtBootstrap: `${ip}@${host}:${dhtPort}` }
	}
	return { dhtBootstrap: `${host}:${dhtPort}` }
}
