import { type FeedbackCheck, readFeedbackCheck } from '@avenos/chat-engine/response-feedback'
import { type InputFeedback, parseInputFeedback } from '@avenos/llm-client/input-decision'

export interface FeedbackInput {
	id: string
	content: string
	feedbackCheck?: FeedbackCheck
}
export interface FeedbackRecoveryHost {
	assess(
		input: FeedbackInput,
		check: FeedbackCheck,
		signal: AbortSignal
	): Promise<InputFeedback | null>
	commit(
		intentId: string,
		input: FeedbackInput,
		check: FeedbackCheck,
		feedback: InputFeedback | null
	): Promise<void | 'deferred'>
}
interface Job {
	intentId: string
	input: FeedbackInput
	check: FeedbackCheck
	assessed: boolean
	feedback: InputFeedback | null
}

/** One non-blocking, bounded recovery lane. The immutable saved input is the backlog.
 * A failed check remains recoverable on reload; it is never recorded as neutral. */
export class FeedbackRecovery {
	#jobs = new Map<string, Job>()
	#waiting = new Map<string, Job>()
	#wakeRevision = 0
	#attempted = new Set<string>()
	#running = false
	#abort = new AbortController()
	constructor(private host: FeedbackRecoveryHost) {}
	enqueue(intentId: string, input: FeedbackInput) {
		const check = readFeedbackCheck(input.feedbackCheck)
		if (!check || this.#attempted.has(check.commandId) || this.#jobs.has(check.commandId)) return
		// Retained inputs are still in SQL if a very large history is loaded.
		if (this.#jobs.size + this.#waiting.size >= 100) return
		this.#jobs.set(check.commandId, {
			intentId,
			input: { ...input, feedbackCheck: check },
			check,
			assessed: false,
			feedback: null
		})
		void this.#drain()
	}
	/** Called after reply persistence/history hydration, not by a polling timer. */
	resume() {
		this.#wakeRevision++
		for (const [id, job] of this.#waiting) this.#jobs.set(id, job)
		this.#waiting.clear()
		void this.#drain()
	}
	async #drain() {
		if (this.#running) return
		this.#running = true
		const scope = this.#abort
		try {
			for (const [id, job] of this.#jobs) {
				if (scope.signal.aborted) break
				this.#jobs.delete(id)
				this.#attempted.add(id)
				for (let attempt = 0; attempt < 2 && !scope.signal.aborted; attempt++) {
					try {
						if (!job.assessed) {
							job.feedback = parseInputFeedback(
								await this.host.assess(job.input, job.check, scope.signal),
								job.check.recent,
								job.input.content
							)
							job.assessed = true
						}
						if (scope.signal.aborted) break
						const wakeRevision = this.#wakeRevision
						const result = await this.host.commit(job.intentId, job.input, job.check, job.feedback)
						if (scope.signal.aborted) break
						if (result === 'deferred') {
							// Persistence may finish while the missing-target lookup is in
							// flight. Do not lose that wakeup, or block unrelated feedback.
							const destination = wakeRevision === this.#wakeRevision ? this.#waiting : this.#jobs
							destination.set(id, job)
						}
						break
					} catch {
						/* Leave the saved check unresolved for later recovery. */
					}
				}
			}
		} finally {
			if (scope === this.#abort) this.#running = false
		}
	}
	reset() {
		this.#abort.abort()
		this.#abort = new AbortController()
		this.#jobs.clear()
		this.#waiting.clear()
		this.#attempted.clear()
		this.#running = false
		this.#wakeRevision++
	}
}
