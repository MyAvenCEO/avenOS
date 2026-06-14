/**
 * Sidecar event name + the pure narrowing from raw protocol envelopes to the
 * app-facing {@link AgentRuntimeEvent} union. Kept pure (no Tauri imports) so it is
 * unit-testable without a webview.
 */
import type { AgentRuntimeEvent, SidecarEnvelope } from './types'

/** The webview event the Rust manager emits for every sidecar `event` envelope. */
export const SIDECAR_EVENT = 'agent-sidecar:event'

function field(event: Record<string, unknown>, key: string): string | undefined {
	const v = event[key]
	return typeof v === 'string' ? v : undefined
}

/**
 * Translate a raw sidecar `event` envelope into a narrowed {@link AgentRuntimeEvent},
 * or `undefined` if it isn't a recognized event (or is missing required correlation
 * fields). The .NET method names (`agent.*`, `humanPrompt.*`, `runtime.health`) map to
 * the stable app event `type`s.
 */
export function narrowSidecarEvent(
	envelope: SidecarEnvelope | undefined
): AgentRuntimeEvent | undefined {
	if (!envelope || envelope.kind !== 'event' || !envelope.method) {
		return undefined
	}
	const e = (envelope.event ?? {}) as Record<string, unknown>
	const replyId = field(e, 'replyId')

	switch (envelope.method) {
		case 'runtime.health':
			return {
				type: 'runtime.health',
				status: field(e, 'status') ?? 'unknown',
				message: field(e, 'message')
			}

		case 'agent.run.started':
			if (!replyId) return undefined
			return {
				type: 'run.started',
				identityId: field(e, 'identityId') ?? '',
				messageId: field(e, 'messageId') ?? '',
				replyId,
				runId: field(e, 'runId') ?? ''
			}

		case 'agent.message.delta':
			if (!replyId) return undefined
			return {
				type: 'message.delta',
				replyId,
				text: field(e, 'text') ?? '',
				runId: field(e, 'runId')
			}

		case 'agent.message.completed':
			if (!replyId) return undefined
			return {
				type: 'message.completed',
				replyId,
				text: field(e, 'text') ?? '',
				runId: field(e, 'runId') ?? '',
				finishReason: field(e, 'finishReason')
			}

		case 'agent.tool.started':
			if (!replyId) return undefined
			return {
				type: 'tool.started',
				replyId,
				toolId: field(e, 'toolId') ?? '',
				name: field(e, 'name') ?? '',
				label: field(e, 'label') ?? ''
			}

		case 'agent.tool.completed':
			if (!replyId) return undefined
			return {
				type: 'tool.completed',
				replyId,
				toolId: field(e, 'toolId') ?? '',
				label: field(e, 'label') ?? '',
				ok: e.ok === true
			}

		case 'humanPrompt.created':
			if (!replyId) return undefined
			return {
				type: 'humanPrompt.created',
				replyId,
				promptId: field(e, 'promptId') ?? '',
				title: field(e, 'title') ?? '',
				body: field(e, 'body') ?? '',
				choices: Array.isArray(e.choices) ? (e.choices as unknown[]) : undefined
			}

		case 'humanPrompt.resolved':
			if (!replyId) return undefined
			return { type: 'humanPrompt.resolved', replyId, promptId: field(e, 'promptId') ?? '' }

		case 'agent.run.failed':
			if (!replyId) return undefined
			return {
				type: 'run.failed',
				replyId,
				message: field(e, 'message') ?? '',
				code: field(e, 'code')
			}

		default:
			return undefined
	}
}
