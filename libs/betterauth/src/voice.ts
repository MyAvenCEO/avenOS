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
import { buildVoiceServerTools } from './voice-tools'
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
	c.set('voiceUserId' as never, session.user.id as never)
	await next()
}

export const voiceLive = upgradeWebSocket((c) => {
	const userId = c.get('voiceUserId' as never) as string | undefined
	let bridge: VoiceBridge | undefined
	const pending: string[] = []
	return {
		onOpen(_evt, ws) {
			const send = (msg: unknown) => ws.send(JSON.stringify(msg))
			if (!userId) {
				send({ type: 'error', message: 'unauthorized' })
				return
			}
			// Tools are the SAME registry chat uses — built per connection so the
			// skill menu (DB config) is fresh; execution is bound to this user.
			// The client's 'setup' frame arrives IMMEDIATELY after open, i.e. while
			// the tool build (DB reads) is still in flight — queue frames until the
			// bridge exists, else the session silently never starts.
			void buildVoiceServerTools(userId)
				.catch((err) => {
					console.error('[betterauth] voice tools build failed:', err)
					return undefined
				})
				.then((serverTools) => {
					bridge = createVoiceBridge(send, serverTools ? { serverTools } : {})
					for (const raw of pending.splice(0)) bridge.handleMessage(raw)
				})
		},
		onMessage(evt) {
			if (typeof evt.data !== 'string') return
			if (bridge) bridge.handleMessage(evt.data)
			else pending.push(evt.data)
		},
		onClose() {
			bridge?.close()
			bridge = undefined
		}
	}
})

console.log(`[betterauth] avenVOICE relay ready → ${describeVoiceBackend()}`)
