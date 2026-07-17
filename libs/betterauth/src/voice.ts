// avenVOICE realtime relay (board: voice mode → Gemini Live, Enterprise/Vertex).
// One authenticated WebSocket per client bridges to one Gemini Live session via
// @avenos/aven-voice/server. Google credentials stay in this process's env
// (root .env): GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION (+ ADC or
// GOOGLE_SERVICE_ACCOUNT_JSON), or GOOGLE_AI_API_KEY for the Developer API.

import {
	createVoiceBridge,
	describeVoiceBackend,
	type VoiceBridge
} from '@avenos/aven-voice/server'
import { createBunWebSocket } from 'hono/bun'
import type { Context, Next } from 'hono'
import { auth } from './auth'

const { upgradeWebSocket, websocket } = createBunWebSocket()
export { websocket as voiceWebsocket }

/**
 * Only signed-in users may open a voice session (same gate as /api/ai/*).
 * Browser WebSockets can't set an Authorization header on the upgrade request,
 * so the bearer token may ride as `?token=` instead (WKWebView drops the
 * cross-site cookie — same reason the app uses bearer everywhere).
 */
export async function voiceSessionGuard(c: Context, next: Next): Promise<Response | void> {
	const headers = new Headers(c.req.raw.headers)
	const token = c.req.query('token')
	if (token && !headers.get('authorization')) headers.set('authorization', `Bearer ${token}`)
	const session = await auth.api.getSession({ headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	await next()
}

export const voiceLive = upgradeWebSocket(() => {
	let bridge: VoiceBridge | undefined
	return {
		onOpen(_evt, ws) {
			bridge = createVoiceBridge((msg) => ws.send(JSON.stringify(msg)))
		},
		onMessage(evt) {
			if (typeof evt.data === 'string') bridge?.handleMessage(evt.data)
		},
		onClose() {
			bridge?.close()
			bridge = undefined
		}
	}
})

console.log(`[betterauth] avenVOICE relay ready → ${describeVoiceBackend()}`)
