import type {
	InputDecisionRequest,
	InputFeedback,
	InputReply,
	InputRoute,
	RoutingContext
} from '@avenos/llm-client/input-decision'
import { inputLocale } from '@avenos/llm-client/input-decision'
import { invoke } from '@tauri-apps/api/core'
import { CHAT_MODEL } from './redpill'

export type {
	InputIntent,
	InputRoute,
	InputTarget,
	RoutingContext
} from '@avenos/llm-client/input-decision'

/** Abort ownership is local; the fixed gateway deadline also bounds the native request. */
async function decision(request: InputDecisionRequest, signal?: AbortSignal) {
	if (signal?.aborted) throw signal.reason
	let abort: (() => void) | undefined
	try {
		return await Promise.race([
			invoke<{ decision: InputRoute | InputReply | InputFeedback | null }>('input_decision', {
				request
			}),
			new Promise<never>((_, reject) => {
				abort = () => reject(signal?.reason ?? Error('Cancelled'))
				signal?.addEventListener('abort', abort, { once: true })
				if (signal?.aborted) abort()
			})
		])
	} catch (error) {
		if (signal?.aborted) throw signal.reason
		throw Error('The destination check could not finish. Choose where to send this, or try again.')
	} finally {
		if (abort) signal?.removeEventListener('abort', abort)
	}
}
export async function assessInputFeedback(
	text: string,
	recent: RoutingContext['recent'],
	locale: string,
	signal?: AbortSignal
): Promise<InputFeedback | null> {
	return (
		await decision(
			{ kind: 'feedback', modelId: CHAT_MODEL, text, recent, locale: inputLocale(locale) },
			signal
		)
	).decision as InputFeedback | null
}
export async function routeInput(
	text: string,
	context: RoutingContext,
	signal?: AbortSignal,
	locale = typeof navigator === 'undefined' ? 'en-GB' : navigator.language,
	correction?: string
): Promise<InputRoute> {
	return (
		await decision(
			{
				kind: 'route',
				modelId: CHAT_MODEL,
				text,
				context,
				locale: inputLocale(locale),
				correction
			},
			signal
		)
	).decision as InputRoute
}
export async function replyToRoute(
	text: string,
	pending: Extract<InputDecisionRequest, { kind: 'reply' }>['pending'],
	locale: string,
	signal?: AbortSignal
): Promise<InputReply> {
	return (
		await decision(
			{ kind: 'reply', modelId: CHAT_MODEL, text, pending, locale: inputLocale(locale) },
			signal
		)
	).decision as InputReply
}
