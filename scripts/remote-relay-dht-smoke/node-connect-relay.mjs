#!/usr/bin/env node
/** Quick check: Node hyperdht.connect → blind-relay server */
import DHT from 'hyperdht'
import b4a from 'b4a'

const bootstrap = (process.env.BOOTSTRAP || '127.0.0.1@127.0.0.1:49737').split(',')
const relayPkHex = process.env.RELAY_PK
const relayAddr = process.env.RELAY_ADDR || '127.0.0.1:61156'
if (!relayPkHex) {
	console.error('RELAY_PK required')
	process.exit(1)
}

const relayPk = b4a.from(relayPkHex, 'hex')
const [host, portStr] = relayAddr.split(':')
const port = Number(portStr)

const dht = new DHT({ bootstrap })
await dht.fullyBootstrapped()
console.log('[node] bootstrapped, connecting to relay', relayPkHex.slice(0, 16), relayAddr)

const socket = dht.connect(relayPk, { relayAddresses: [{ host, port }] })
socket.on('open', () => {
	console.log('[node] SUCCESS relay socket open')
	socket.end()
	dht.destroy().then(() => process.exit(0))
})
socket.on('error', (err) => {
	console.error('[node] relay connect error:', err.message)
	dht.destroy().then(() => process.exit(1))
})
setTimeout(() => {
	console.error('[node] timeout')
	dht.destroy().then(() => process.exit(1))
}, 15000)
