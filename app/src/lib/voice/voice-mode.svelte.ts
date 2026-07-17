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
import { getBearerToken } from '$lib/auth/auth-client'
import { createTodos, deleteTodo, listTodos, updateTodos } from '$lib/data/client'

const AUTH_ORIGIN =
	(import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined) || 'https://api.next.aven.ceo'

const INSTRUCTIONS = `Du bist avenOS' schneller Sprachassistent. Sprich immer Deutsch, außer der Nutzer wechselt die Sprache.
Halte Antworten kurz — ein bis zwei Sätze.
Du verwaltest die Todo-Liste des Nutzers über Tools.
Für mehrere Artikel: IMMER ein einziger Batch-Aufruf (create_todos/update_todos), danach genau EINE kurze Bestätigung. Wiederhole dich nie.
"habe ich schon" / "ist erledigt" / "gekauft" bedeutet abhaken (done=true) — NIEMALS löschen.
Löschen nur bei ausdrücklichem "löschen/entfernen".
Bei relativen Zeiten (morgen, in 2 Stunden): rufe zuerst get_current_time auf, antworte darauf nicht, sondern rufe direkt das nächste Tool mit dem ISO-Datum auf.`

const TOOLS = [
	{
		name: 'list_todos',
		description: 'Listet alle Todos mit IDs, Status und Fälligkeit.',
		parametersJsonSchema: { type: 'object', properties: {} }
	},
	{
		name: 'create_todos',
		description:
			'Legt ein oder mehrere Todos an — alle in EINEM Aufruf. Fälligkeit (due, ISO 8601) optional.',
		parametersJsonSchema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							title: { type: 'string' },
							due: { type: 'string', description: 'Optional, ISO 8601 mit Zeitzone' }
						},
						required: ['title']
					}
				}
			},
			required: ['items']
		}
	},
	{
		name: 'update_todos',
		description:
			'Ändert ein oder mehrere Todos in EINEM Aufruf: done (abhaken/reaktivieren), title (umbenennen), due (Fälligkeit, leer = entfernen). IDs kommen aus list_todos.',
		parametersJsonSchema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							done: { type: 'boolean' },
							title: { type: 'string' },
							due: { type: 'string' }
						},
						required: ['id']
					}
				}
			},
			required: ['items']
		}
	},
	{
		name: 'delete_todos',
		description: 'Löscht Todos endgültig — nur nach ausdrücklichem Nutzerwunsch. IDs aus list_todos.',
		parametersJsonSchema: {
			type: 'object',
			properties: { ids: { type: 'array', items: { type: 'string' } } },
			required: ['ids']
		}
	},
	{
		name: 'get_current_time',
		description:
			'Aktuelles Datum, Uhrzeit, Zeitzone. IMMER zuerst bei relativen Zeitangaben aufrufen.',
		parametersJsonSchema: { type: 'object', properties: {} }
	}
]

async function executeTool(name: string, rawArgs: unknown): Promise<unknown> {
	try {
		switch (name) {
			case 'list_todos':
				return { todos: await listTodos() }
			case 'create_todos': {
				const items = ((rawArgs as { items?: unknown[] })?.items ?? []).map((it) => {
					const o = it as { title?: unknown; due?: unknown }
					return {
						title: String(o?.title ?? '').trim(),
						...(typeof o?.due === 'string' && o.due ? { due: o.due } : {})
					}
				})
				await createTodos(items.filter((i) => i.title))
				return { ok: true, created: items.map((i) => i.title) }
			}
			case 'update_todos': {
				const items = ((rawArgs as { items?: unknown[] })?.items ?? []) as {
					id: string
					done?: boolean
					title?: string
					due?: string
				}[]
				await updateTodos(items)
				return { ok: true, updated: items.map((i) => i.id) }
			}
			case 'delete_todos': {
				const ids = ((rawArgs as { ids?: unknown[] })?.ids ?? []).map(String)
				for (const id of ids) await deleteTodo(id)
				return { ok: true, deleted: ids }
			}
			case 'get_current_time': {
				const d = new Date()
				return {
					iso: d.toISOString(),
					local: d.toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' }),
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
				}
			}
			default:
				return { ok: false, error: `Unbekanntes Tool: ${name}` }
		}
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Tool-Fehler' }
	}
}

class VoiceMode {
	status = $state<VoiceStatus>('disconnected')
	active = $state(false)
	error = $state<string | null>(null)
	transcript = $state<TranscriptLine[]>([])

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
			}
		})
		this.#engine.start()
		this.active = true
	}

	stop(): void {
		this.#engine?.stop()
		this.#engine = null
		this.active = false
	}
}

export const voiceMode = new VoiceMode()
