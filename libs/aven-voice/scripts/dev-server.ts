// Standalone dev relay — the voice route WITHOUT the betterauth stack, for
// local development and package testing. Same path as production
// (/api/voice/live) so app config is identical. UNAUTHENTICATED — dev only.
//
// Run: bun --env-file=../../.env scripts/dev-server.ts   (from libs/aven-voice)

import { createVoiceBridge, describeVoiceBackend, type VoiceBridge } from '../src/server'

const PORT = Number(process.env.VOICE_DEV_PORT ?? 8787)
const bridges = new Map<unknown, VoiceBridge>()

Bun.serve({
	port: PORT,
	fetch(req, server) {
		const url = new URL(req.url)
		if (url.pathname === '/api/voice/live' && server.upgrade(req)) return
		return new Response(`aven-voice dev relay → ${describeVoiceBackend()}`, { status: 200 })
	},
	websocket: {
		open(ws) {
			bridges.set(ws, createVoiceBridge((msg) => ws.send(JSON.stringify(msg))))
		},
		message(ws, raw) {
			bridges.get(ws)?.handleMessage(String(raw))
		},
		close(ws) {
			bridges.get(ws)?.close()
			bridges.delete(ws)
		}
	}
})

console.log(`🔊 aven-voice dev relay: ws://localhost:${PORT}/api/voice/live → ${describeVoiceBackend()}`)
