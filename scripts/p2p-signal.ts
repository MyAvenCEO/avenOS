#!/usr/bin/env bun
/**
 * AvenOS centralized P2P **discovery** stack (`aven-p2p-signal-dht` + blind-relay node).
 *
 * Master switch: **`AVEN_RELAY`** defaults **on** (central DHT + relay node for pairing/lookup).
 * Set **`AVEN_RELAY=false`** (or **`AVENOS_RELAY=false`**) to use public Holepunch HyperDHT instead.
 *
 * **Data plane is always direct P2P** — we never inject `AVENOS_HYPERSWARM_RELAY_*` into peeroxide
 * (`relay_through` forces blind-relay transport; AvenOS forbids that path).
 *
 * Relay subprocess defaults to **`node`** when on PATH (HyperDHT + Bun/macOS crashes). Override with
 * `AVENOS_P2P_SIGNAL_RELAY_WITH_BUN=1` / `AVENOS_P2P_SIGNAL_RELAY_WITH_NODE=0`.
 */

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Default isolated HyperDHT bootstrap UDP (Rust). */
export const P2P_DHT_UDP_PORT_DEFAULT = 49737
/** Default blind-relay UDP (central signal infra; not wired into peeroxide swarm). */
export const P2P_RELAY_UDP_PORT_DEFAULT = 49738

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['0', 'false', 'no', 'off'])

export function envTruthy(key: string, env: Record<string, string | undefined> = process.env): boolean {
	const v = env[key]?.trim().toLowerCase()
	return v != null && v !== '' && TRUTHY.has(v)
}

export function envFalsy(key: string, env: Record<string, string | undefined> = process.env): boolean {
	const v = env[key]?.trim().toLowerCase()
	return v != null && v !== '' && FALSY.has(v)
}

/** Central discovery + pairing service (DHT + relay subprocess). Default **on** unless explicitly false. */
export function avenRelayCentralMode(
	env: Record<string, string | undefined> = process.env
): boolean {
	if (env.AVENOS_SKIP_P2P_SIGNAL === '1') return false
	for (const key of ['AVEN_RELAY', 'AVENOS_RELAY'] as const) {
		if (envFalsy(key, env)) return false
	}
	return true
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

function relaySpawnArgv(relayDir: string): string[] {
	const script = path.join(relayDir, 'blind-relay-server.cjs')
	if (process.env.AVENOS_P2P_SIGNAL_RELAY_WITH_BUN === '1') {
		return ['bun', 'blind-relay-server.cjs']
	}
	const nodeExe = Bun.which('node')
	if (nodeExe && process.env.AVENOS_P2P_SIGNAL_RELAY_WITH_NODE !== '0') {
		return [nodeExe, script]
	}
	return ['bun', 'blind-relay-server.cjs']
}

/** Env merged into Tauri children — direct data plane, no swarm relay injection. */
export function p2pPublicModeEnvAugment(): Record<string, string> {
	return {
		AVEN_RELAY: '0',
		AVENOS_DHT_PUBLIC: '1',
		AVENOS_P2P_DIRECT_ONLY: '1',
		AVENOS_P2P_IGNORE_RELAY_ENV: '1'
	}
}

export type P2pSignalHandles = {
	envAugment: Record<string, string>
	dispose(): Promise<void>
}

/**
 * When **`AVEN_RELAY=true`**: spawn isolated DHT + central relay node (discovery infra).
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

	const relayDir = path.join(repoRoot, 'infra/p2p-signal-relay')
	if (!existsSync(path.join(relayDir, 'node_modules'))) {
		console.warn('[p2p-signal] installing relay deps (`bun install` in infra/p2p-signal-relay)…')
		const i = Bun.spawn(['bun', 'install'], { cwd: relayDir, stdout: 'inherit', stderr: 'inherit' })
		const code = await i.exited
		if (code !== 0) {
			throw new Error(`p2p-signal relay: bun install exited ${code}`)
		}
	}

	const dhtPort = Number(process.env.AVENOS_P2P_SIGNAL_PORT || P2P_DHT_UDP_PORT_DEFAULT)
	const relayUdpPort = Number(process.env.AVENOS_P2P_SIGNAL_RELAY_PORT || P2P_RELAY_UDP_PORT_DEFAULT)
	freeUdpPort(dhtPort, 'DHT')
	freeUdpPort(relayUdpPort, 'relay')

	const keysDir = path.join(repoRoot, '.avenOS', 'dev', 'p2p-signal')

	const dhtManifest = path.join(repoRoot, 'projects', 'aven-p2p-signal', 'Cargo.toml')
	const baseEnv = { ...process.env } as Record<string, string>
	baseEnv.RUST_LOG ??= 'warn'

	const dht = Bun.spawn(
		['cargo', 'run', '-q', `--manifest-path=${dhtManifest}`],
		{
			cwd: repoRoot,
			stdout: 'pipe',
			stderr: 'inherit',
			stdin: 'ignore',
			env: baseEnv
		}
	)

	let dhtLine: Record<string, unknown>
	try {
		dhtLine = await readFirstJsonLine(dht.stdout, 'aven-p2p-signal-dht')
	} catch (e) {
		dht.kill('SIGKILL')
		throw e
	}

	const ready = dhtLine.ready === true
	const bootstrap = typeof dhtLine.bootstrap === 'string' ? dhtLine.bootstrap : ''
	if (!ready || !bootstrap) {
		dht.kill('SIGKILL')
		throw new Error(`aven-p2p-signal-dht invalid ready handshake: ${JSON.stringify(dhtLine)}`)
	}

	const relayArgv = relaySpawnArgv(relayDir)
	const relayProc = Bun.spawn(relayArgv, {
		cwd: relayDir,
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'ignore',
		env: {
			...process.env,
			AVENOS_P2P_SIGNAL_BOOTSTRAP: bootstrap,
			AVENOS_P2P_SIGNAL_KEYS_DIR: keysDir,
			AVENOS_P2P_SIGNAL_RELAY_HOST: process.env.AVENOS_P2P_SIGNAL_RELAY_HOST ?? '127.0.0.1',
			AVENOS_P2P_SIGNAL_RELAY_PORT: String(relayUdpPort)
		}
	})

	let relayLine: Record<string, unknown>
	try {
		relayLine = await readFirstJsonLine(relayProc.stdout, 'blind-relay')
	} catch (e) {
		relayProc.kill('SIGKILL')
		dht.kill('SIGKILL')
		throw e
	}

	if (relayLine.ready !== true) {
		relayProc.kill('SIGKILL')
		dht.kill('SIGKILL')
		throw new Error(`blind relay invalid ready: ${JSON.stringify(relayLine)}`)
	}

	const pkHex = typeof relayLine.publicKey === 'string' ? relayLine.publicKey.trim() : ''
	const rHost =
		typeof relayLine.host === 'string'
			? relayLine.host
			: (process.env.AVENOS_P2P_SIGNAL_RELAY_HOST ?? '127.0.0.1')
	const rPort = typeof relayLine.port === 'number' ? relayLine.port : relayUdpPort
	if (!pkHex || pkHex.length !== 64) {
		relayProc.kill('SIGKILL')
		dht.kill('SIGKILL')
		throw new Error(`blind relay publicKey invalid (${pkHex.slice(0, 16)}…)`)
	}

	const relayAddr = `${rHost}:${rPort}`

	const envAugment: Record<string, string> = {
		AVEN_RELAY: '1',
		AVENOS_DHT_ISOLATED: '1',
		AVENOS_DHT_BOOTSTRAP: bootstrap,
		AVENOS_P2P_DIRECT_ONLY: '1',
		AVENOS_P2P_IGNORE_RELAY_ENV: '1'
	}

	console.log(
		`[p2p-signal] central discovery ready — bootstrap=${bootstrap} relayNode=${relayAddr} relayPk=${pkHex.slice(0, 16)}… ` +
			'(relay node runs on signal stack only; peeroxide data plane stays direct P2P)'
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
		await gracefulKill(relayProc)
		await gracefulKill(dht)
	}

	return { envAugment, dispose }
}

async function foreground(): Promise<void> {
	const { envAugment, dispose } = await startP2pSignal(REPO_ROOT)
	console.log(
		JSON.stringify(
			{
				...envAugment,
				note: 'AVEN_RELAY=true → central DHT+relay subprocesses. Ctrl-C stops them. Data plane: direct P2P only.'
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
