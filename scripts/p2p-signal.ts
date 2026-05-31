#!/usr/bin/env bun

/**
 * AvenOS centralized P2P **discovery** stack (Rust `aven-relay-dht`: HyperDHT bootstrap + co-hosted blind-relay on UDP **49737**).
 *
 * Master switch: **`AVEN_RELAY`** defaults **on** (central DHT for pairing/lookup).
 * Set **`AVEN_RELAY=false`** (or **`AVENOS_RELAY=false`**) to use public Holepunch HyperDHT instead.
 *
 * **`AVEN_RELAY_URL`** (required when central): `127.0.0.1` / `localhost` → spawn local Rust signal;
 * any other host (e.g. `relay.aven.ceo`) → remote bootstrap + blind-relay from manifest (no local subprocess).
 *
 * Data plane: blind-relay only (`relay_through` on coordinator UDP 49737).
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAppStoreRelayConfig } from './relay-bootstrap.ts'
import {
	ensureRelayEnvReady,
	RELAY_SEED_ENV,
	resolveRelaySeedHex,
} from './relay-env.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Default isolated HyperDHT bootstrap + blind-relay UDP (single Rust process). */
export const P2P_DHT_UDP_PORT_DEFAULT = 49737
/** Blind-relay shares the bootstrap UDP port (co-hosted on HyperDHT). */
export const P2P_RELAY_UDP_PORT_DEFAULT = P2P_DHT_UDP_PORT_DEFAULT

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['0', 'false', 'no', 'off'])

export function envTruthy(
	key: string,
	env: Record<string, string | undefined> = process.env
): boolean {
	const v = env[key]?.trim().toLowerCase()
	return v != null && v !== '' && TRUTHY.has(v)
}

export function envFalsy(
	key: string,
	env: Record<string, string | undefined> = process.env
): boolean {
	const v = env[key]?.trim().toLowerCase()
	return v != null && v !== '' && FALSY.has(v)
}

/** Strip scheme/path/port; returns hostname (IPv6 without brackets). */
export function normalizeAvenRelayUrlHost(raw: string): string {
	let h = raw.trim()
	if (!h) throw new Error('AVEN_RELAY_URL is empty')
	if (h.toLowerCase().startsWith('https://')) h = h.slice(8)
	else if (h.toLowerCase().startsWith('http://')) h = h.slice(7)
	const slash = h.indexOf('/')
	if (slash !== -1) h = h.slice(0, slash)
	if (h.startsWith('[')) {
		const close = h.indexOf(']')
		if (close === -1) throw new Error('AVEN_RELAY_URL: invalid IPv6 (missing ])')
		const inner = h.slice(1, close).trim()
		if (!inner) throw new Error('AVEN_RELAY_URL: empty IPv6')
		return inner
	}
	const lastColon = h.lastIndexOf(':')
	if (lastColon > 0) {
		const tail = h.slice(lastColon + 1)
		if (/^\d+$/.test(tail) && Number(tail) <= 65535) {
			h = h.slice(0, lastColon)
		}
	}
	if (!h.trim()) throw new Error('AVEN_RELAY_URL: no hostname')
	return h.trim()
}

export function isEmbeddedLocalRelayHost(host: string): boolean {
	const l = host.toLowerCase()
	return l === '127.0.0.1' || l === 'localhost' || l === '::1'
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

/**
 * HyperDHT bootstrap string for central discovery.
 * Local embedded signal uses `127.0.0.1@host:port` (aven-p2p connects to loopback).
 * Remote hosts use `{publicIp}@host:port` so node ids match Fly ingress (bind IP ≠ public IP).
 */
export function centralBootstrap(hostname: string, dhtUdpPort: number): string {
	if (isEmbeddedLocalRelayHost(hostname)) {
		return `127.0.0.1@${hostname}:${dhtUdpPort}`
	}
	const ip = resolveIpv4Sync(hostname)
	if (ip) return `${ip}@${hostname}:${dhtUdpPort}`
	return `${hostname}:${dhtUdpPort}`
}

/** @deprecated use {@link centralBootstrap} */
export function remoteCentralBootstrap(hostname: string, dhtUdpPort: number): string {
	return centralBootstrap(hostname, dhtUdpPort)
}

/** Central discovery + pairing service (Rust DHT + co-hosted blind-relay). Default **on** unless explicitly false. */
export function avenRelayCentralMode(
	env: Record<string, string | undefined> = process.env
): boolean {
	if (env.AVENOS_SKIP_P2P_SIGNAL === '1') return false
	for (const key of ['AVEN_RELAY', 'AVENOS_RELAY'] as const) {
		if (envFalsy(key, env)) return false
	}
	return true
}

/**
 * Bun dev wrappers only (`dev-app-*`, `dev-two-instances`, `--foreground`): when central relay is on but
 * `AVEN_RELAY_URL` is empty, default to hosted alpha relay.
 */
export function applyCentralRelayUrlDevDefault(launcherTag: string): void {
	if (!avenRelayCentralMode()) return
	if (process.env.AVEN_RELAY_URL?.trim()) return
	process.env.AVEN_RELAY_URL = 'relay.aven.ceo'
	console.warn(
		`[${launcherTag}] AVEN_RELAY_URL unset — defaulting to relay.aven.ceo (hosted alpha bootstrap). Set 127.0.0.1 for embedded local signal.`,
	)
}

export function udpListenerPids(port: number): string[] {
	try {
		const out = execFileSync('lsof', ['-nP', `-iUDP:${port}`, '-t'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim()
		if (!out) return []
		return [...new Set(out.split(/\s+/).filter(Boolean))]
	} catch {
		return []
	}
}

export function freeUdpPort(port: number, label = 'UDP'): void {
	const pids = udpListenerPids(port)
	if (pids.length === 0) return
	console.warn(
		`[p2p-signal] ${label} port ${port} in use (PID ${pids.join(', ')}); SIGTERM stale holder(s)…`
	)
	for (const pid of pids) {
		try {
			process.kill(Number(pid), 'SIGTERM')
		} catch {
			/* ESRCH */
		}
	}
	for (let i = 0; i < 30; i++) {
		if (udpListenerPids(port).length === 0) return
		Bun.sleepSync(100)
	}
	for (const pid of udpListenerPids(port)) {
		try {
			process.kill(Number(pid), 'SIGKILL')
		} catch {
			/* ESRCH */
		}
	}
}

async function readFirstJsonLine(
	out: ReadableStream<Uint8Array> | undefined,
	label: string
): Promise<Record<string, unknown>> {
	if (!out) throw new Error(`${label}: stdout not piped`)
	const dec = new TextDecoder()
	const reader = out.getReader()
	let buf = ''
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		buf += dec.decode(value, { stream: true })
		const nl = buf.indexOf('\n')
		if (nl !== -1) {
			const line = buf.slice(0, nl).trim()
			try {
				return JSON.parse(line) as Record<string, unknown>
			} catch {
				throw new Error(`${label}: invalid JSON line: ${line.slice(0, 200)}`)
			}
		}
	}
	throw new Error(`${label}: process ended before emitting ready JSON`)
}

function relayFromDhtReadyLine(
	dhtLine: Record<string, unknown>,
	fallbackHost: string,
	fallbackPort: number,
): { relayPublicKeyHex: string; relayAddr: string } {
	const pkHex =
		typeof dhtLine.relayPublicKeyHex === 'string' ? dhtLine.relayPublicKeyHex.trim() : ''
	const rPort =
		typeof dhtLine.relayUdpPort === 'number' && dhtLine.relayUdpPort > 0
			? dhtLine.relayUdpPort
			: fallbackPort
	const rHost =
		typeof dhtLine.host === 'string' && dhtLine.host.trim() ? dhtLine.host.trim() : fallbackHost
	if (!pkHex || pkHex.length !== 64) {
		throw new Error(`Rust signal relayPublicKeyHex invalid (${pkHex.slice(0, 16)}…)`)
	}
	return { relayPublicKeyHex: pkHex, relayAddr: `${rHost}:${rPort}` }
}

function hyperswarmRelayEnv(relayPublicKeyHex: string, relayAddr: string): Record<string, string> {
	return {
		AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX: relayPublicKeyHex,
		AVENOS_HYPERSWARM_RELAY_ADDR: relayAddr,
	}
}

/** Env merged into Tauri children — public Holepunch HyperDHT (no central relay). */
export function p2pPublicModeEnvAugment(): Record<string, string> {
	return {
		AVEN_RELAY: '0',
		AVENOS_DHT_PUBLIC: '1',
	}
}

export type P2pSignalHandles = {
	envAugment: Record<string, string>
	dispose(): Promise<void>
}

/**
 * When **`AVEN_RELAY=true`**: spawn isolated Rust DHT + co-hosted blind-relay (49737), or use remote manifest.
 * Otherwise return public-DHT env augment and no subprocesses.
 */
export async function startP2pSignal(repoRoot = REPO_ROOT): Promise<P2pSignalHandles> {
	if (!avenRelayCentralMode()) {
		console.log('[p2p-signal] off (AVEN_RELAY=false) — public Holepunch HyperDHT')
		return {
			envAugment: p2pPublicModeEnvAugment(),
			async dispose() {}
		}
	}

	const relayUrlRaw = process.env.AVEN_RELAY_URL?.trim()
	if (!relayUrlRaw) {
		throw new Error(
			'[p2p-signal] AVEN_RELAY_URL is required when central relay is on (e.g. 127.0.0.1 for local subprocess, or relay.aven.ceo for Fly-hosted discovery)'
		)
	}
	let relayHostNorm: string
	try {
		relayHostNorm = normalizeAvenRelayUrlHost(relayUrlRaw)
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		throw new Error(`[p2p-signal] ${msg}`)
	}

	const dhtPort = Number(process.env.AVENOS_P2P_SIGNAL_PORT || P2P_DHT_UDP_PORT_DEFAULT)

	if (!isEmbeddedLocalRelayHost(relayHostNorm)) {
		const relayCfg = await resolveAppStoreRelayConfig(relayHostNorm, dhtPort, {
			warnLabel: 'p2p-signal',
			repoRoot: REPO_ROOT,
		})
		const envAugment: Record<string, string> = {
			AVEN_RELAY: '1',
			AVEN_RELAY_URL: relayUrlRaw,
			AVENOS_DHT_ISOLATED: '1',
			AVENOS_DHT_BOOTSTRAP: relayCfg.dhtBootstrap,
		}
		if (relayCfg.relayPublicKeyHex && relayCfg.relayAddr) {
			Object.assign(envAugment, hyperswarmRelayEnv(relayCfg.relayPublicKeyHex, relayCfg.relayAddr))
		}
		console.log(
			`[p2p-signal] central discovery (remote) — bootstrap=${relayCfg.dhtBootstrap}` +
				(relayCfg.relayAddr ? ` blindRelay=${relayCfg.relayAddr}` : ''),
		)
		return { envAugment, async dispose() {} }
	}

	const keysDir = path.join(repoRoot, '.avenOS', 'dev', 'p2p-signal')
	ensureRelayEnvReady(repoRoot)
	freeUdpPort(dhtPort, 'DHT+blind-relay')

	const dhtManifest = path.join(repoRoot, 'libs', 'aven-relay', 'Cargo.toml')
	const baseEnv = { ...process.env } as Record<string, string>
	baseEnv.RUST_LOG ??= 'warn'
	baseEnv.AVENOS_P2P_SIGNAL_KEYS_DIR = keysDir
	const relaySeedHex = resolveRelaySeedHex(repoRoot)
	if (relaySeedHex) baseEnv[RELAY_SEED_ENV] = relaySeedHex
	// Local subprocess: seed only — pubkey verify env is for Fly/deploy when seed+pubkey are paired.
	delete baseEnv[RELAY_PUBLIC_KEY_ENV]

	const dht = Bun.spawn(['cargo', 'run', '-q', `--manifest-path=${dhtManifest}`], {
		cwd: repoRoot,
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'ignore',
		env: baseEnv
	})

	let dhtLine: Record<string, unknown>
	try {
		dhtLine = await readFirstJsonLine(dht.stdout, 'aven-relay-dht')
	} catch (e) {
		dht.kill('SIGKILL')
		throw e
	}

	const ready = dhtLine.ready === true
	const bootstrap = typeof dhtLine.bootstrap === 'string' ? dhtLine.bootstrap : ''
	if (!ready || !bootstrap) {
		dht.kill('SIGKILL')
		throw new Error(`aven-relay-dht invalid ready handshake: ${JSON.stringify(dhtLine)}`)
	}

	const { relayPublicKeyHex, relayAddr } = relayFromDhtReadyLine(
		dhtLine,
		process.env.AVENOS_P2P_SIGNAL_RELAY_HOST ?? '127.0.0.1',
		dhtPort,
	)

	const envAugment: Record<string, string> = {
		AVEN_RELAY: '1',
		AVEN_RELAY_URL: relayUrlRaw,
		AVENOS_DHT_ISOLATED: '1',
		AVENOS_DHT_BOOTSTRAP: bootstrap,
		...hyperswarmRelayEnv(relayPublicKeyHex, relayAddr),
	}

	console.log(
		`[p2p-signal] central discovery (local) — bootstrap=${bootstrap} blindRelay=${relayAddr} relayPk=${relayPublicKeyHex.slice(0, 16)}…`,
	)

	async function gracefulKill(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
		if (proc.exitCode != null) return
		proc.kill('SIGTERM')
		await Promise.race([proc.exited, Bun.sleep(5000)])
		if (proc.exitCode == null && proc.pid != null) {
			try {
				process.kill(proc.pid, 'SIGKILL')
			} catch {
				/* ESRCH */
			}
		}
		await proc.exited.catch(() => undefined)
	}

	let disposed = false
	async function dispose(): Promise<void> {
		if (disposed) return
		disposed = true
		await gracefulKill(dht)
	}

	return { envAugment, dispose }
}

async function foreground(): Promise<void> {
	applyCentralRelayUrlDevDefault('p2p-signal --foreground')
	const { envAugment, dispose } = await startP2pSignal(REPO_ROOT)
	console.log(
		JSON.stringify(
			{
				...envAugment,
				note: 'AVEN_RELAY central stack: Rust DHT + co-hosted blind-relay on UDP 49737 (relay-only data plane).',
			},
			null,
			2
		)
	)

	await new Promise<void>((resolve) => {
		const done = (): void => {
			void dispose().then(resolve).catch(resolve)
		}
		process.once('SIGINT', done)
		process.once('SIGTERM', done)
	})
}

if (import.meta.main && process.argv.includes('--foreground')) {
	void foreground().catch((e) => {
		console.error(e)
		process.exit(1)
	})
}
