/**
 * Central HyperDHT bootstrap + blind-relay fallback for App Store / Xcode compile embeds.
 * Fetches `/.well-known/aven-relay.json`; falls back to DNS via {@link centralBootstrap}.
 */
import { execFileSync } from 'node:child_process'

import { centralBootstrap } from './p2p-signal.ts'
import {
	normalizeHex64,
	RELAY_PUBLIC_KEY_ENV,
	resolveRelayPublicKeyHex,
} from './relay-env.ts'

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

function relayAddrForHost(host: string, dhtPort: number): string {
	const ip = resolveIpv4Sync(host)
	const addrHost = ip ?? host
	return `${addrHost}:${dhtPort}`
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
			: dhtPort
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
	opts: {
		warnLabel?: string
		repoRoot?: string
		/** App Store / Fly deploy: require `AVENOS_RELAY_PUBLIC_KEY_HEX` in repo env. */
		requireEnvPubkey?: boolean
	} = {},
): Promise<AppStoreRelayConfig> {
	const label = opts.warnLabel ?? 'relay-bootstrap'
	const fallbackBootstrap = centralBootstrap(host, dhtPort)

	let envPub: string | undefined
	if (opts.repoRoot) {
		envPub = resolveRelayPublicKeyHex(opts.repoRoot)
	}
	if (opts.requireEnvPubkey) {
		if (!opts.repoRoot) {
			throw new Error(`${label}: requireEnvPubkey needs repoRoot`)
		}
		if (!envPub) {
			throw new Error(
				`${label}: missing ${RELAY_PUBLIC_KEY_ENV} — set in shell, .env.apple.local, or repo .env`,
			)
		}
	}

	let manifest: AvenRelayManifest | undefined
	let dhtBootstrap = fallbackBootstrap

	try {
		const res = await fetch(`https://${host}/.well-known/aven-relay.json`)
		if (res.ok) {
			manifest = (await res.json()) as AvenRelayManifest
			if (typeof manifest.bootstrap === 'string' && manifest.bootstrap.includes('@')) {
				dhtBootstrap = manifest.bootstrap
			}
		}
	} catch (e) {
		console.warn(`[${label}] relay manifest fetch failed — falling back to DNS:`, e)
	}

	if (fallbackBootstrap.includes('@') && dhtBootstrap === fallbackBootstrap) {
		/* already set */
	} else if (!dhtBootstrap.includes('@')) {
		const ip = resolveIpv4Sync(host)
		if (ip) dhtBootstrap = `${ip}@${host}:${dhtPort}`
	}

	const manifestPub =
		typeof manifest?.relayPublicKeyHex === 'string' &&
		manifest.relayPublicKeyHex.trim().length === 64
			? normalizeHex64(manifest.relayPublicKeyHex, 'manifest.relayPublicKeyHex')
			: undefined

	const relayPublicKeyHex = envPub ?? manifestPub
	if (envPub && manifestPub && envPub !== manifestPub) {
		throw new Error(
			`${label}: ${RELAY_PUBLIC_KEY_ENV} (${envPub}) mismatch with live relay manifest (${manifestPub})`,
		)
	}

	if (!relayPublicKeyHex) {
		if (fallbackBootstrap.includes('@')) {
			return { dhtBootstrap: fallbackBootstrap }
		}
		const ip = resolveIpv4Sync(host)
		if (ip) {
			return { dhtBootstrap: `${ip}@${host}:${dhtPort}` }
		}
		return { dhtBootstrap: `${host}:${dhtPort}` }
	}

	const relayUdpPort =
		typeof manifest?.relayUdpPort === 'number' && manifest.relayUdpPort > 0
			? manifest.relayUdpPort
			: dhtPort
	const relayHost = (typeof manifest?.host === 'string' && manifest.host.trim()) || host
	const relayAddr =
		(manifest && relayAddrFromManifest(manifest, host, dhtPort)) ??
		relayAddrForHost(relayHost, relayUdpPort)

	return {
		dhtBootstrap,
		relayPublicKeyHex,
		relayHost,
		relayUdpPort,
		relayAddr,
	}
}
