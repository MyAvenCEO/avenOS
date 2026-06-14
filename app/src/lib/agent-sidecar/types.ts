/**
 * Shared types for the .NET stdio sidecar bridge. These mirror the protocol contract
 * frozen in `Aven.Sidecar.Protocol` (.NET) and the Rust `agent_sidecar` manager.
 */

/** Raw protocol envelope as it arrives on the `agent-sidecar:event` webview event. */
export type SidecarEnvelope = {
	v: number
	kind: 'request' | 'response' | 'event'
	id?: string
	method?: string
	params?: unknown
	result?: unknown
	error?: SidecarError
	event?: Record<string, unknown>
	meta?: Record<string, unknown>
}

/** Structured error preserved across .NET → Rust → TS (machine code never flattened). */
export type SidecarError = {
	code: string
	message: string
	retryable: boolean
	data?: unknown
}

/** Lifecycle snapshot from `agent_sidecar_status`. */
export type SidecarStatus = {
	state: 'stopped' | 'starting' | 'ready' | 'crashed'
	capabilities?: Record<string, unknown>
	lastError?: string
	lastExitCode?: number
	pid?: number
}

/** Handshake result from `session.hello`. */
export type SidecarHello = {
	server: { name: string; version: string }
	protocolVersion: number
	capabilities: Record<string, boolean>
}

/** The runtime boundary input — one submit shape for every identity sub-view. */
export type AgentSubmitInput = {
	identityId: string
	messageId: string
	replyId: string
	text: string
	sourceView?: string
	attachments: { fileId?: string; path?: string; filename: string; mimeType?: string }[]
}

/** Structured outcome of `messages.submit` (status discriminator + payload fields). */
export type SubmitResult = {
	status: 'accepted' | 'clarification' | 'rejected' | 'conflict' | 'unknown'
	idempotencyKey?: string
	/** Routed agent id (present when accepted) — poll target for {@link MessageResult}. */
	agentId?: string
	[key: string]: unknown
}

/** A .NET human prompt (from `humanPrompts.list`/`get`), serialized camelCase. */
export type HumanPromptView = {
	promptId: string
	status: string
	promptText: string
	requestId?: string
	operationType?: string
	correlationId?: string
	caller?: string
	owner?: string
	replyTo?: string
	requiredCapabilityId?: string | null
	answer?: string | null
	answeredAt?: string | null
	expiresAt?: string | null
}

/** Settlement view for a routed turn from `messages.result` (bounded-poll target). */
export type MessageResult = {
	agentId: string
	status: string
	settled: boolean
	summary?: string | null
	activeRuns: number
	pendingOperations: number
	openWorkItems: number
}

/**
 * App-facing runtime event union (the narrowed, stable shape the UI consumes). The raw
 * sidecar `agent.*` / `humanPrompt.*` event envelopes are translated into this by
 * {@link narrowSidecarEvent}. Mirrors the architecture target in the milestone plan.
 */
export type AgentRuntimeEvent =
	| { type: 'run.started'; identityId: string; messageId: string; replyId: string; runId: string }
	| { type: 'message.delta'; replyId: string; text: string; runId?: string }
	| {
			type: 'message.completed'
			replyId: string
			text: string
			runId: string
			finishReason?: string
	  }
	| { type: 'tool.started'; replyId: string; toolId: string; name: string; label: string }
	| { type: 'tool.completed'; replyId: string; toolId: string; label: string; ok: boolean }
	| {
			type: 'humanPrompt.created'
			replyId: string
			promptId: string
			title: string
			body: string
			choices?: unknown[]
	  }
	| { type: 'humanPrompt.resolved'; replyId: string; promptId: string }
	| { type: 'run.failed'; replyId: string; message: string; code?: string }
	| { type: 'runtime.health'; status: string; message?: string }
