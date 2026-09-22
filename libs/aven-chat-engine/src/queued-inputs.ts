import type { Turn } from './chat'
import type { ContextReference } from './context-references'
import type { PriorActionReceipt } from './prior-actions'
import type { ToolCall } from './tool-call'

export interface QueuedInput {
	session: string
	context: string
	contextReferences?: ContextReference[]
	priorActions?: PriorActionReceipt[]
	user: Turn
	calls: ToolCall[]
	claimed: boolean
}

/** Snapshot a contiguous waiting prefix. Never cross a host context or speaker boundary. */
export function waitingInputs(queue: Iterable<QueuedInput>): QueuedInput[] {
	const batch: QueuedInput[] = []
	let characters = 0
	for (const next of queue) {
		if (next.claimed) continue
		const first = batch[0]
		if (
			first &&
			(next.session !== first.session ||
				next.context !== first.context ||
				JSON.stringify(next.contextReferences ?? []) !==
					JSON.stringify(first.contextReferences ?? []) ||
				Boolean(next.priorActions?.length || first.priorActions?.length) ||
				next.user.inputAdmission?.intentId !== first.user.inputAdmission?.intentId ||
				next.user.anonymousSpeaker?.session_id !== first.user.anonymousSpeaker?.session_id ||
				next.user.anonymousSpeaker?.speaker_id !== first.user.anonymousSpeaker?.speaker_id ||
				batch.length >= 16 ||
				characters + next.user.content.length > 32_000)
		)
			break
		batch.push(next)
		characters += next.user.content.length
	}
	return batch
}
