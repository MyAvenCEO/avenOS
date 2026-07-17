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
ZEIT-REGEL (immer befolgen): Sobald eine Anfrage IRGENDEINE Datums- oder Zeitangabe enthält — absolut (heute, 14. Juli, Freitag) ODER relativ (in 6 Stunden, morgen Mittag, nächste Woche) ODER implizit "heute" (z.B. "ich habe X für 12,32 € gekauft") — rufe ZUERST get_current_time auf. Sprich nach get_current_time NICHT, sondern rechne die genannte Zeit auf localIso und rufe im selben Zug das eigentliche Tool (data_crud create/update) mit dem berechneten ISO-Datum (mit Offset) im due- bzw. date-Feld auf.
Gilt für Todos (due) UND Transaktionen (date, z.B. Kauf "heute"). Ohne Datumsbezug wird get_current_time NICHT aufgerufen.
Beispiel: "Ich hab heute für 12,32 € Schuhe gekauft" → get_current_time → data_crud create transaction {name:"Schuhe", amount:"-12.32", date:<heute-ISO>}.`

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
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
		// Local ISO WITH the user's offset, so the model can add hours/days and
		// emit a correct due/date without guessing the timezone.
		const pad = (n: number) => String(n).padStart(2, '0')
		const off = -d.getTimezoneOffset()
		const offStr = `${off >= 0 ? '+' : '-'}${pad(Math.abs(off) / 60)}:${pad(Math.abs(off) % 60)}`
		const localIso =
			`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
			`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offStr}`
		return {
			localIso,
			utcIso: d.toISOString(),
			weekday: d.toLocaleDateString('de-DE', { weekday: 'long' }),
			human: d.toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' }),
			timezone: tz,
			hint: 'Rechne relative Zeiten (in X Stunden, morgen, Freitag Mittag) auf localIso drauf und gib das Ergebnis als ISO 8601 mit Offset als due/date weiter.'
		}
	}
	return { ok: false, error: `Unbekanntes Tool: ${name}` }
}

export type VoiceToolEvent = Extract<ServerMessage, { type: 'toolEvent' }>
export type VoiceHitl = Extract<ServerMessage, { type: 'hitl' }>

class VoiceMode {
	status = $state<VoiceStatus>('disconnected')
	active = $state(false)
	error = $state<string | null>(null)
	transcript = $state<TranscriptLine[]>([])
	toolEvents = $state<VoiceToolEvent[]>([])
	pendingHitl = $state<VoiceHitl | null>(null)
	/** Vibes the executed actors declared (schema + data), in arrival order —
	 *  the shell's stage consumes them exactly like chat's aven_vibe events. */
	vibeQueue = $state<{ seq: number; schema: string; data?: unknown }[]>([])
	/** Live connect progress for the connecting state (attempt/region). */
	connecting = $state<{ attempt: number; total: number; region: string } | null>(null)
	#vibeSeq = 0

	#engine: VoiceEngine | null = null

	toggle(): void {
		if (this.active) this.stop()
		else this.start()
	}

	start(): void {
		this.error = null
		this.transcript = []
		this.toolEvents = []
		this.vibeQueue = []
		this.connecting = null
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
				if (msg.type === 'status' && msg.phase === 'connecting') {
					this.connecting = { attempt: msg.attempt, total: msg.total, region: msg.region }
				} else if (msg.type === 'open') {
					this.connecting = null
				} else if (msg.type === 'toolEvent') {
					this.toolEvents = [...this.toolEvents.slice(-19), msg]
					// The ACTOR declared its vibes (schema + state) server-side — same
					// contract as chat's aven_vibe; no client-side mapping tables.
					for (const v of msg.vibes ?? []) {
						this.vibeQueue = [
							...this.vibeQueue.slice(-9),
							{ seq: this.#vibeSeq++, schema: v.schema, data: v.data }
						]
					}
				} else if (msg.type === 'hitl') {
					this.pendingHitl = msg
				}
			}
		})
		this.#engine.start()
		this.active = true
	}

	/** Confirm the pending HITL action via the SAME endpoint chat's card uses. */
	async confirmHitl(): Promise<void> {
		const hitl = this.pendingHitl
		if (!hitl) return
		this.pendingHitl = null
		try {
			const token = getBearerToken()
			const res = await fetch(`${AUTH_ORIGIN}/api/ai/confirm`, {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify({ action: hitl.action })
			})
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { error?: string } | null
				this.error = err?.error ?? `Bestätigung fehlgeschlagen (HTTP ${res.status})`
			}
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Bestätigung fehlgeschlagen'
		}
	}

	dismissHitl(): void {
		this.pendingHitl = null
	}

	/** Full call log (transcript + tool runs) as plain text — for the copy button. */
	exportLog(): string {
		const lines: string[] = []
		for (const t of this.transcript) lines.push(`${t.role === 'user' ? 'DU' : 'AGENT'}: ${t.text}`)
		if (this.toolEvents.length) {
			lines.push('', '── TOOL CALLS ──')
			for (const ev of this.toolEvents) {
				lines.push(
					`${ev.name} ${ev.detail ? `(${ev.detail}) ` : ''}[${ev.status}] args=${JSON.stringify(ev.args ?? {})}`
				)
			}
		}
		return lines.join('\n')
	}

	stop(): void {
		this.#engine?.stop()
		this.#engine = null
		this.active = false
		this.pendingHitl = null
		this.connecting = null
	}
}

export const voiceMode = new VoiceMode()
