#!/usr/bin/env bun
/**
 * Container entry: Rust HyperDHT bootstrap + co-hosted blind-relay (single UDP 49737).
 * Bun is PID1. HTTP `:8080` serves `/.well-known/aven-relay.json`.
 */

const DHT_BIN = Bun.env.P2P_SIGNAL_DHT_BINARY ?? '/usr/local/bin/aven-relay-dht'
const MANIFEST_HTTP_PORT = Number(Bun.env.AVEN_RELAY_MANIFEST_HTTP_PORT ?? '8080')
const DHT_UDP_PORT_DEFAULT = 49737

import dns from 'node:dns/promises'

/** Fly public UDP ingress requires the fly-global-services IPv4, not 0.0.0.0. */
async function resolveFlyUdpBindHost(host: string): Promise<string> {
	const h = host.trim()
	if (h.toLowerCase() !== 'fly-global-services') {
		return h
	}
	try {
		const { address } = await dns.lookup('fly-global-services', { family: 4 })
		console.log(`[p2p-fly] UDP bind fly-global-services -> ${address}`)
		return address
	} catch (e) {
		console.warn(
			'[p2p-fly] fly-global-services DNS failed — UDP may not receive public traffic:',
			e,
		)
		return h
	}
}

async function applyFlyUdpBindEnv(ev: Record<string, string | undefined>): Promise<void> {
	const key = 'AVENOS_P2P_SIGNAL_HOST'
	const raw = ev[key]?.trim()
	if (raw) ev[key] = await resolveFlyUdpBindHost(raw)
}

function tryHandshakeLine(
	lineRaw: string,
	isHandshake: (o: Record<string, unknown>) => boolean,
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
	isHandshake: (o: Record<string, unknown>) => boolean,
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
	let manifest: Record<string, unknown> | null = null
	const server = Bun.serve({
		port: MANIFEST_HTTP_PORT,
		hostname: '0.0.0.0',
		fetch(req) {
			const u = new URL(req.url)
			if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
			if (u.pathname === '/health') return new Response('ok\n')
			if (u.pathname === '/.well-known/aven-relay.json') {
				if (manifest) return Response.json(manifest)
				return Response.json({ ready: false, note: 'Rust DHT + blind-relay starting' }, { status: 503 })
			}
			return new Response('Not Found', { status: 404 })
		},
	})
	console.log('[p2p-fly] HTTP listening on 0.0.0.0:', MANIFEST_HTTP_PORT)

	const env: Record<string, string | undefined> = { ...process.env }
	await applyFlyUdpBindEnv(env)

	console.log('[p2p-fly] starting Rust HyperDHT + blind-relay:', DHT_BIN)
	const rust = Bun.spawn([DHT_BIN], {
		stdout: 'pipe',
		stderr: 'inherit',
		stdin: 'ignore',
		env,
	})

	let dhtHandshake: Record<string, unknown>
	try {
		dhtHandshake = await readHandshakeLine(
			rust.stdout,
			'dht',
			(o) =>
				o.ready === true &&
				typeof o.bootstrap === 'string' &&
				typeof o.relayPublicKeyHex === 'string',
		)
	} catch (e) {
		await gracefulKill(rust)
		throw e
	}

	const bootstrap = dhtHandshake.bootstrap as string
	const dhtPort =
		typeof dhtHandshake.port === 'number'
			? dhtHandshake.port
			: Number(Bun.env.AVENOS_P2P_SIGNAL_PORT ?? DHT_UDP_PORT_DEFAULT)
	const relayPublicKeyHex =
		typeof dhtHandshake.relayPublicKeyHex === 'string'
			? dhtHandshake.relayPublicKeyHex.trim()
			: ''
	const relayUdpPort =
		typeof dhtHandshake.relayUdpPort === 'number'
			? dhtHandshake.relayUdpPort
			: dhtPort
	const advertised =
		Bun.env.AVENOS_P2P_ADVERTISED_HOST?.trim() ||
		(typeof dhtHandshake.host === 'string' ? dhtHandshake.host : '')

	if (relayPublicKeyHex.length !== 64) {
		await gracefulKill(rust)
		throw new Error(`Rust relay invalid relayPublicKeyHex: ${relayPublicKeyHex.slice(0, 16)}…`)
	}

	manifest = {
		bootstrap,
		host: advertised || null,
		dhtUdpPort: dhtPort,
		relayPublicKeyHex,
		relayUdpPort,
		note: 'Single Rust process: HyperDHT bootstrap + blind-relay on UDP 49737. Connect order: LAN → holepunch → relay_through.',
	}
	console.log(
		'[p2p-fly] manifest ready — bootstrap=',
		bootstrap,
		'relayPk=',
		relayPublicKeyHex.slice(0, 16) + '…',
		'relayUdpPort=',
		relayUdpPort,
	)

	async function shutdown(signal: NodeJS.Signals) {
		console.warn(`[p2p-fly] ${signal} — stopping…`)
		server.stop(false)
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
