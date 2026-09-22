/** Model transport is a host port. The turn engine has no desktop or provider dependency. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
/** Engine-owned purpose, not provider/model-generated narration. */
export type ModelPhase = 'answer' | 'verification' | 'repair' | 'checklist'
export interface ChatMessage {
	role: ChatRole
	content: string
	tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
	tool_call_id?: string
}
export interface ToolSpec {
	name: string
	description: string
	parameters: Record<string, unknown>
	/** Host-owned policy. Never forwarded as a provider function field. It adds
	 * source/receipt review; omitting it cannot disable existing mandatory checks. */
	answerReview?: 'required'
}
export type StreamEvent =
	| { kind: 'text'; text: string }
	| { kind: 'finish'; reason: string }
	| { kind: 'usage'; usage: Record<string, unknown> }
	| { kind: 'tool'; index: number; id?: string; name?: string; args?: string }
export type ModelStream = (
	messages: ChatMessage[],
	tools: ToolSpec[],
	signal?: AbortSignal,
	model?: string,
	options?: { json?: boolean; thinking?: boolean; max_tokens?: number; phase?: ModelPhase }
) => AsyncGenerator<StreamEvent>
// biome-ignore lint/correctness/useYield: An absent transport rejects on iteration using the same async-generator port.
export async function* unavailableStream(): AsyncGenerator<StreamEvent> {
	throw Error('No model transport is installed for this conversation.')
}
