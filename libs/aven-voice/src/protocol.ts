// Wire protocol between the browser voice engine and the server relay.
// Battle-tested shape from the avenVOICE prototype: every tool call gets a
// response (silence causes model retry loops), audio rides as base64 PCM16.

/** Tool declaration passed to Gemini Live at session setup. */
export type VoiceToolDeclaration = {
	name: string
	description: string
	parametersJsonSchema: Record<string, unknown>
}

/** Session config the client sends as its FIRST message after connecting. */
export type VoiceSetup = {
	type: 'setup'
	/** System instructions for the session (the surface owns its prompt). */
	instructions: string
	/** Tools the surface exposes; executed client-side via 'toolCall'/'toolResponse'. */
	tools: VoiceToolDeclaration[]
	/** Prebuilt voice name, validated against the relay allowlist. */
	voice?: string
	/** BCP-47, defaults to de-DE. */
	languageCode?: string
}

export type ClientMessage =
	| VoiceSetup
	| { type: 'audio'; data: string } // base64 PCM16 @ 16kHz
	| {
			type: 'toolResponse'
			responses: { id: string; name: string; response: unknown }[]
	  }

export type ServerMessage =
	| { type: 'open' }
	// Informational: a server-executed tool ran (for UI chips / vibe switching).
	| {
			type: 'toolEvent'
			id: string
			name: string
			args: unknown
			status: 'running' | 'done' | 'error'
			detail?: string
			/** Vibe views the executed actor declared (schema + state data). */
			vibes?: { schema: string; data?: unknown }[]
	  }
	// Server tool requested human confirmation (e.g. destructive delete).
	| { type: 'hitl'; id: string; tool: string; label: string; action: unknown }
	| { type: 'audio'; data: string } // base64 PCM16 @ 24kHz
	| { type: 'toolCall'; calls: { id: string; name: string; args: unknown }[] }
	| { type: 'transcript'; role: 'user' | 'assistant'; text: string }
	| { type: 'interrupted' }
	| { type: 'turnComplete' }
	| { type: 'error'; message: string }

export const VOICE_ALLOWLIST = ['Charon', 'Aoede', 'Puck', 'Kore', 'Fenrir', 'Orus'] as const
export const DEFAULT_VOICE = 'Charon'
export const DEFAULT_LANGUAGE = 'de-DE'
export const CAPTURE_SAMPLE_RATE = 16_000
export const PLAYBACK_SAMPLE_RATE = 24_000
