'use strict'

/**
 * HyperDHT + blind-relay server (Hyperswarm wire-compatible).
 * Used as **last-resort** data plane when LAN direct + UDP holepunch fail.
 *
 * Env:
 *   AVENOS_P2P_SIGNAL_BOOTSTRAP — comma-separated HyperDHT bootstrap entries.
 *   AVENOS_P2P_SIGNAL_KEYS_DIR — persisted 32-byte `relay-hyperdht.seed`.
 *   AVENOS_P2P_SIGNAL_RELAY_HOST — UDP bind host (default 127.0.0.1).
 *   AVENOS_P2P_SIGNAL_RELAY_PORT — UDP port (default 49738).
 *
 * Stdout (one JSON line): { ready, publicKey, host, port }
 */

const fs = require('fs')
const path = require('path')

const DHT = require('hyperdht')
const relayPkg = require('blind-relay')
const b4a = require('b4a')

const SEED_FILE = 'relay-hyperdht.seed'

function readBootstrapList() {
	const raw = (process.env.AVENOS_P2P_SIGNAL_BOOTSTRAP || '').trim()
	if (!raw) {
		throw new Error(
			'AVENOS_P2P_SIGNAL_BOOTSTRAP missing — paste `bootstrap` from aven-p2p-signal-dht stdout'
		)
	}
	return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

async function loadOrCreateSeed(keysDir) {
	fs.mkdirSync(keysDir, { recursive: true })
	const fp = path.join(keysDir, SEED_FILE)
	if (fs.existsSync(fp)) {
		const b = fs.readFileSync(fp)
		if (b.length !== 32) throw new Error(`${fp}: expected 32-byte HyperDHT seed`)
		return b
	}
	const { utils } = await import('@noble/ed25519')
	const seed = Buffer.from(utils.randomPrivateKey())
	fs.writeFileSync(fp, seed)
	return seed
}

async function main() {
	const keysDir =
		process.env.AVENOS_P2P_SIGNAL_KEYS_DIR &&
		process.env.AVENOS_P2P_SIGNAL_KEYS_DIR.trim()
			? path.resolve(process.env.AVENOS_P2P_SIGNAL_KEYS_DIR.trim())
			: path.resolve('.avenOS/dev/p2p-signal')

	const bootstrap = readBootstrapList()

	const relayHost = process.env.AVENOS_P2P_SIGNAL_RELAY_HOST || '127.0.0.1'
	const relayPort = Number(process.env.AVENOS_P2P_SIGNAL_RELAY_PORT || '49738')

	const seedBuf = await loadOrCreateSeed(keysDir)
	const keyPair = DHT.keyPair(seedBuf)

	const dht = new DHT({
		bootstrap,
		host: relayHost,
		port: Number.isFinite(relayPort) && relayPort > 0 ? relayPort : 49738,
		keyPair
	})

	await dht.fullyBootstrapped()

	const relayServer = new relayPkg.Server({
		createStream(opts) {
			return dht.rawStreams.add(opts)
		}
	})

	const server = dht.createServer(function (socket) {
		relayServer.accept(socket, { id: socket.remotePublicKey })
	})

	await server.listen(keyPair)

	const addr = dht.address()
	const pkHex = b4a.toString(keyPair.publicKey, 'hex')

	process.stdout.write(
		JSON.stringify({
			ready: true,
			publicKey: pkHex,
			host: addr.host === '0.0.0.0' ? relayHost : addr.host,
			port: addr.port
		}) + '\n'
	)

	const shutdown = async () => {
		await relayServer.close()
		await server.close()
		await dht.destroy()
		process.exit(0)
	}

	process.stdin.resume()
	process.stdin.on('end', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('SIGINT', shutdown)
}

main().catch((err) => {
	process.stderr.write((err.stack || String(err)) + '\n')
	process.exit(1)
})
