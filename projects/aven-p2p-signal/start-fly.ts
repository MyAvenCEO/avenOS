#!/usr/bin/env bun
/**
 * Container entry: supervise Rust `aven-p2p-signal-dht` + blind relay (`blind-relay-server.cjs`).
 * Uses **Bun** as PID1; the relay prefers **Node** when present in the image (`Bun.which('node')`).
 */

import path from 'node:path'
const DHT_BIN = Bun.env.P2P_SIGNAL_DHT_BINARY ?? '/usr/local/bin/aven-p2p-signal-dht'
const RELAY_DIR = Bun.env.P2P_SIGNAL_RELAY_DIR ?? '/app/infra/p2p-signal-relay'

function relaySpawnArgv(): string[] {
	const script = path.join(RELAY_DIR, 'blind-relay-server.cjs')
	if (Bun.env.AVENOS_P2P_SIGNAL_RELAY_WITH_BUN === '1') {
		return ['bun', 'blind-relay-server.cjs']
	}
	const nodeExe = Bun.which('node')
	if (nodeExe && Bun.env.AVENOS_P2P_SIGNAL_RELAY_WITH_NODE !== '0') {
		return [nodeExe, script]
	}
	return ['bun', 'blind-relay-server.cjs']
}

async function readReadyJson(stream: ReadableStream<Uint8Array> | undefined, label: string) {
	if (!stream) throw new Error(`${label}: stdout not piped`)
	const dec = new TextDecoder()
	const reader = stream.getReader()
	let buf = ''
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		buf += dec.decode(value, { stream: true })
		const nl = buf.indexOf('\n')
		if (nl !== -1) return JSON.parse(buf.slice(0, nl).trim()) as Record<string, unknown>
	}
	throw new Error(`${label}: no ready line`)
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
	const relayPort = Bun.env.AVENOS_P2P_SIGNAL_RELAY_PORT ?? '49738'
	const keysDir = Bun.env.AVENOS_P2P_SIGNAL_KEYS_DIR ?? '/data/p2p-signal'

	console.log('[p2p-fly] starting Rust HyperDHT bootstrap:', DHT_BIN)
	const rust = Bun.spawn([DHT_BIN], {
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'ignore',
		env: { ...process.env }
	})

	let handshake: Record<string, unknown>
	try {
		handshake = await readReadyJson(rust.stdout, 'dht')
	} catch (e) {
		await gracefulKill(rust)
		throw e
	}

	const bootstrap = handshake.bootstrap
	if (handshake.ready !== true || typeof bootstrap !== 'string') {
		await gracefulKill(rust)
		throw new Error(`dht handshake invalid: ${JSON.stringify(handshake)}`)
	}

	console.log('[p2p-fly] DHT bootstrap string:', bootstrap)
	const relayArgv = relaySpawnArgv()
	console.log('[p2p-fly] blind-relay subprocess:', relayArgv.join(' '))
	console.log('[p2p-fly] working dir:', RELAY_DIR)

	const relay = Bun.spawn(relayArgv, {
		cwd: RELAY_DIR,
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'ignore',
		env: {
			...process.env,
			AVENOS_P2P_SIGNAL_BOOTSTRAP: bootstrap,
			AVENOS_P2P_SIGNAL_KEYS_DIR: keysDir,
			AVENOS_P2P_SIGNAL_RELAY_PORT: relayPort
		}
	})

	try {
		const r = await readReadyJson(relay.stdout, 'relay')
		if (r.ready !== true || typeof r.publicKey !== 'string') {
			throw new Error(`relay handshake invalid: ${JSON.stringify(r)}`)
		}
		const hp = `${r.host ?? '127.0.0.1'}:${r.port ?? relayPort}`
		console.log('[p2p-fly] relay publicKey=', r.publicKey)
		console.log('[p2p-fly] relay advertise address=', hp)
	} catch (e) {
		await gracefulKill(relay)
		await gracefulKill(rust)
		throw e
	}

	async function shutdown(signal: NodeJS.Signals) {
		console.warn(`[p2p-fly] ${signal} — stopping relay then DHT…`)
		await gracefulKill(relay)
		await gracefulKill(rust)
		process.exit(0)
	}

	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.once(sig, () => {
			void shutdown(sig)
		})
	}

	await new Promise(() => {
		/* Bun keeps relay + rust subprocesses alive until PID1 exits */
	})
}

if (import.meta.main) {
	await main().catch((err: unknown) => {
		console.error('[p2p-fly] fatal:', err)
		process.exit(1)
	})
}

