#!/usr/bin/env bun
/**
 * Container entry: Rust `aven-p2p-signal-dht` + blind relay (`blind-relay-server.cjs`).
 * Bun is PID1. HTTP `:8080` serves `/.well-known/aven-relay.json` (Fly proxy + diagnostics).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

const DHT_BIN = Bun.env.P2P_SIGNAL_DHT_BINARY ?? '/usr/local/bin/aven-p2p-signal-dht'
const RELAY_DIR = Bun.env.P2P_SIGNAL_RELAY_DIR ?? '/app/infra/p2p-signal-relay'
const MANIFEST_HTTP_PORT = Number(Bun.env.AVEN_RELAY_MANIFEST_HTTP_PORT ?? '8080')

/** `fly-global-services` is not bindable (`SocketAddr`); Rust/Node UDP stacks need `0.0.0.0`. */
function patchFlyBindEnv(ev: Record<string, string | undefined>): void {
	for (const key of ['AVENOS_P2P_SIGNAL_HOST', 'AVENOS_P2P_SIGNAL_RELAY_HOST'] as const) {
		if ((ev[key] ?? '').trim() === 'fly-global-services') {
			ev[key] = '0.0.0.0'
		}
	}
}

/** Prefer real Node (HyperDHT NAPI); never Bun's `bun-node-fallback-bin/node` shim. */
function usableNodeExe(): string | undefined {
	// Debian `apt install nodejs` often installs `/usr/bin/nodejs` only; PATH-first `which node` sees Bun shim.
	for (const p of ['/usr/bin/node', '/usr/bin/nodejs']) {
		if (existsSync(p)) return p
	}
	const nodeExe = Bun.which('node')
	if (nodeExe && !nodeExe.includes('bun-node-fallback-bin')) return nodeExe
	return undefined
}

function relaySpawnArgv(): string[] {
	const script = path.join(RELAY_DIR, 'blind-relay-server.cjs')
	if (Bun.env.AVENOS_P2P_SIGNAL_RELAY_WITH_BUN === '1') {
		return ['bun', 'blind-relay-server.cjs']
	}
	const nodeExe = usableNodeExe()
	if (nodeExe && Bun.env.AVENOS_P2P_SIGNAL_RELAY_WITH_NODE !== '0') {
		return [nodeExe, script]
	}
	return ['bun', 'blind-relay-server.cjs']
}

/**
 * Reads child stdout line-by-line until a line parses as JSON and satisfies `predicate`.
 * Skips empty lines & obvious log noise (anything that isn't `{…}` handshake JSON).
 */
function tryHandshakeLine(
	lineRaw: string,
	isHandshake: (o: Record<string, unknown>) => boolean
): Record<string, unknown> | null {
	let line = lineRaw.trim()
	if (!line || line.startsWith('#')) return null
	const b = line.indexOf('{')
	if (b > 0) line = line.slice(b).trim()
	try {
		const obj = JSON.parse(line) as Record<string, unknown>
		if (isHandshake(obj)) return obj
	} catch {
		/* not JSON handshake */
	}
	return null
}

async function readHandshakeLine(
	stream: ReadableStream<Uint8Array> | undefined,
	label: string,
	isHandshake: (o: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
	if (!stream) throw new Error(`${label}: stdout not piped`)
	const dec = new TextDecoder()
	const reader = stream.getReader()
	let buf = ''
	for (;;) {
		const { done, value } = await reader.read()
		if (value) buf += dec.decode(value, { stream: true })

		let nl = buf.indexOf('\n')
		while (nl !== -1) {
			const raw = buf.slice(0, nl)
			buf = buf.slice(nl + 1)
			nl = buf.indexOf('\n')

			const got = tryHandshakeLine(raw, isHandshake)
			if (got !== null) return got
		}

		if (done) {
			const got = tryHandshakeLine(buf, isHandshake)
			if (got !== null) return got
			break
		}
	}
	throw new Error(`${label}: no handshake JSON line on stdout`)
}

async function gracefulKill(proc: ReturnType<typeof Bun.spawn>) {
	if (proc.exitCode != null) return
	proc.kill('SIGTERM')
	await Promise.race([proc.exited, Bun.sleep(5000)])
	const code = proc.exitCode
	if (code == null && proc.pid != null) {
		try {
			process.kill(proc.pid, 'SIGKILL')
		} catch {
			/* ESRCH */
		}
	}
	await proc.exited.catch(() => undefined)
}

async function main() {
	const relayPort = Number(Bun.env.AVENOS_P2P_SIGNAL_RELAY_PORT ?? '49738')
	const keysDir = Bun.env.AVENOS_P2P_SIGNAL_KEYS_DIR ?? '/data/p2p-signal'

	const env: Record<string, string | undefined> = { ...process.env }
	patchFlyBindEnv(env)

	console.log('[p2p-fly] starting Rust HyperDHT bootstrap:', DHT_BIN)
	const rust = Bun.spawn([DHT_BIN], {
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'ignore',
		env
	})

	let handshake: Record<string, unknown>
	try {
		handshake = await readHandshakeLine(
			rust.stdout,
			'dht',
			(o) => o.ready === true && typeof o.bootstrap === 'string'
		)
	} catch (e) {
		await gracefulKill(rust)
		throw e
	}

	const bootstrap = handshake.bootstrap as string

	const dhtPort =
		typeof handshake.port === 'number'
			? handshake.port
			: Number(Bun.env.AVENOS_P2P_SIGNAL_PORT ?? '49737')
	const advertised =
		Bun.env.AVENOS_P2P_ADVERTISED_HOST?.trim() ||
		(typeof handshake.host === 'string' ? handshake.host : '')

	console.log('[p2p-fly] DHT bootstrap string:', bootstrap)
	const relayArgv = relaySpawnArgv()
	console.log('[p2p-fly] blind-relay subprocess:', relayArgv.join(' '))

	const relayEnv: Record<string, string | undefined> = {
		...process.env,
		AVENOS_P2P_SIGNAL_BOOTSTRAP: bootstrap,
		AVENOS_P2P_SIGNAL_KEYS_DIR: keysDir,
		AVENOS_P2P_SIGNAL_RELAY_PORT: String(relayPort),
		AVENOS_P2P_SIGNAL_RELAY_HOST:
			Bun.env.AVENOS_P2P_SIGNAL_RELAY_HOST ?? Bun.env.AVENOS_P2P_SIGNAL_HOST ?? '0.0.0.0'
	}
	patchFlyBindEnv(relayEnv)

	const relay = Bun.spawn(relayArgv, {
		cwd: RELAY_DIR,
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'ignore',
		env: relayEnv
	})

	let relayLine: Record<string, unknown>
	try {
		relayLine = await readHandshakeLine(
			relay.stdout,
			'relay',
			(o) => o.ready === true && typeof o.publicKey === 'string'
		)
		const rlPort = typeof relayLine.port === 'number' ? relayLine.port : relayPort
		const hp = `${relayLine.host ?? '127.0.0.1'}:${rlPort}`
		console.log('[p2p-fly] relay publicKey=', relayLine.publicKey)
		console.log('[p2p-fly] relay bind address=', hp)
	} catch (e) {
		await gracefulKill(relay)
		await gracefulKill(rust)
		throw e
	}

	const rlPort = typeof relayLine.port === 'number' ? relayLine.port : relayPort
	const manifest: Record<string, unknown> = {
		bootstrap,
		host: advertised || null,
		dhtUdpPort: dhtPort,
		// Fly publishes `relayPort` on the edge — HyperDHT's `address()` often reports ephemeral/local.
		relayUdpPort: relayPort,
		relayPublicKeyHex: relayLine.publicKey as string,
		note:
			'Clients use UDP HyperDHT bootstrap (bootstrap + dhtUdpPort). relayUdpPort matches Fly edge mapping / AVENOS_P2P_SIGNAL_RELAY_PORT. HTTPS is health/diagnostics. Peeroxide data plane ignores relayPublicKeyHex (direct P2P).'
	}
	if (rlPort !== relayPort) {
		manifest.relayUdpSocketReported = {
			host: typeof relayLine.host === 'string' ? relayLine.host : '127.0.0.1',
			port: rlPort
		}
	}

	const server = Bun.serve({
		port: MANIFEST_HTTP_PORT,
		hostname: '0.0.0.0',
		fetch(req) {
			const u = new URL(req.url)
			if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
			if (u.pathname === '/health') return new Response('ok\n')
			if (u.pathname === '/.well-known/aven-relay.json') return Response.json(manifest)
			return new Response('Not Found', { status: 404 })
		}
	})
	console.log('[p2p-fly] HTTP manifest:', server.hostname, ':', server.port)

	async function shutdown(signal: NodeJS.Signals) {
		console.warn(`[p2p-fly] ${signal} — stopping…`)
		server.stop(false)
		await gracefulKill(relay)
		await gracefulKill(rust)
		process.exit(0)
	}

	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.once(sig, () => {
			void shutdown(sig)
		})
	}

	await new Promise(() => {})
}

if (import.meta.main) {
	await main().catch((err: unknown) => {
		console.error('[p2p-fly] fatal:', err)
		process.exit(1)
	})
}
