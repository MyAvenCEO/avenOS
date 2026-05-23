/**
 * Central HyperDHT bootstrap string for App Store / Xcode compile embeds.
 * Fetches `/.well-known/aven-relay.json` for the official `bootstrap` line; falls back to DNS via {@link centralBootstrap}.
 */
import { execFileSync } from 'node:child_process'

import { centralBootstrap } from './p2p-signal.ts'

export type AppStoreRelayConfig = {
	dhtBootstrap: string
}

type AvenRelayManifest = {
	bootstrap?: string
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
			return { dhtBootstrap }
		}
	} catch (e) {
		console.warn(`[${label}] relay manifest fetch failed — falling back to DNS:`, e)
	}

	// Minimal manifest (e.g. 503 during DHT startup) — build still needs a plausible bootstrap line.
	if (fallbackBootstrap.includes('@')) {
		return { dhtBootstrap: fallbackBootstrap }
	}
	const ip = resolveIpv4Sync(host)
	if (ip) {
		return { dhtBootstrap: `${ip}@${host}:${dhtPort}` }
	}
	return { dhtBootstrap: `${host}:${dhtPort}` }
}
