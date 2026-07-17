/**
 * Realtime voice mode (avenVOICE, board: aven-voice) — the default voice UX,
 * replacing the Parakeet push-to-talk→transcript flow with a live
 * speech-to-speech session (Gemini Live Enterprise via the betterauth relay).
 *
 * One rune-based singleton: the composer's logo button calls `toggle()`;
 * session + mic start and stop together (no idle WebSocket costs). Tools run
 * client-side against the SAME /api/data/todos path the chat LLM tools use,
 * so voice edits land in the real store and SSE-invalidate the UI.
 */
import { VoiceEngine, type TranscriptLine, type VoiceStatus } from '@avenos/aven-voice'
import type { ServerMessage } from '@avenos/aven-voice'
import { getBearerToken } from '$lib/auth/auth-client'

const AUTH_ORIGIN =
	(import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined) || 'https://api.next.aven.ceo'

const INSTRUCTIONS = `Du bist avenOS' schneller Sprachassistent. Sprich immer Deutsch, außer der Nutzer wechselt die Sprache.
Halte Antworten kurz — ein bis zwei Sätze.
Du steuerst avenOS über Tools: Todos, Inventar, Planner, Website, Ontology und weitere Skills.
Erledige jede Anfrage in möglichst EINER Tool-Runde (Batch-Argumente nutzen), danach genau EINE kurze Bestätigung. Wiederhole dich nie.
"habe ich schon" / "ist erledigt" / "gekauft" bedeutet abhaken/als erledigt markieren — NIEMALS löschen.
Löschen nur bei ausdrücklichem "löschen/entfernen"; destruktive Aktionen erfordern Bestätigung (HITL).
Bei relativen Zeiten (morgen, in 2 Stunden): rufe zuerst get_current_time auf, antworte darauf nicht, sondern rufe direkt das nächste Tool mit dem ISO-Datum auf.`

const TOOLS = [
	{
		name: 'get_current_time',
		description:
			'Aktuelles Datum, Uhrzeit, Zeitzone des Nutzers. IMMER zuerst bei relativen Zeitangaben aufrufen.',
		parametersJsonSchema: { type: 'object', properties: {} }
	}
]

async function executeTool(name: string): Promise<unknown> {
	if (name === 'get_current_time') {
		const d = new Date()
		return {
			iso: d.toISOString(),
			local: d.toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' }),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
		}
	}
	return { ok: false, error: `Unbekanntes Tool: ${name}` }
}

export type VoiceToolEvent = Extract<ServerMessage, { type: 'toolEvent' }>
export type VoiceHitl = Extract<ServerMessage, { type: 'hitl' }>

/** Tool → Vibe-View, die die Shell beim jeweiligen Tool-Lauf zeigen soll. board aven-voice. */
const TOOL_VIBES: Record<string, string> = {
	data_crud: 'todos',
	todos: 'todos',
	inventory: 'inventory',
	locations: 'inventory-locations',
	goals: 'goals',
	planner: 'goals'
}

class VoiceMode {
	status = $state<VoiceStatus>('disconnected')
	active = $state(false)
	error = $state<string | null>(null)
	transcript = $state<TranscriptLine[]>([])
	toolEvents = $state<VoiceToolEvent[]>([])
	pendingHitl = $state<VoiceHitl | null>(null)
	/** Vibe-View-Name passend zum letzten Tool-Lauf (Shell rendert sie daneben). */
	activeVibe = $state<string | null>(null)

	#engine: VoiceEngine | null = null

	toggle(): void {
		if (this.active) this.stop()
		else this.start()
	}

	start(): void {
		this.error = null
		this.transcript = []
		const wsOrigin = AUTH_ORIGIN.replace(/^http/, 'ws')
		const token = getBearerToken()
		const url = `${wsOrigin}/api/voice/live${token ? `?token=${encodeURIComponent(token)}` : ''}`
		this.#engine = new VoiceEngine({
			url,
			instructions: INSTRUCTIONS,
			tools: TOOLS,
			executeTool,
			voice: 'Charon',
			languageCode: 'de-DE',
			onStatus: (s) => {
				this.status = s
			},
			onTranscript: () => {
				this.transcript = [...(this.#engine?.transcript ?? [])]
			},
			onError: (m) => {
				this.error = m
			},
			onServerMessage: (msg) => {
				if (msg.type === 'toolEvent') {
					this.toolEvents = [...this.toolEvents.slice(-9), msg]
					const vibe = TOOL_VIBES[msg.name]
					if (vibe) this.activeVibe = vibe
				} else if (msg.type === 'hitl') {
					this.pendingHitl = msg
				}
			}
		})
		this.#engine.start()
		this.active = true
	}

	stop(): void {
		this.#engine?.stop()
		this.#engine = null
		this.active = false
		this.pendingHitl = null
	}
}

export const voiceMode = new VoiceMode()
