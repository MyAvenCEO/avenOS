import type { FeedbackCheck } from '@avenos/chat-engine/response-feedback'
import type { SourceContext } from '@avenos/chat-engine/source-context'
import type {
	InputIntent,
	InputReply,
	InputRoute,
	InputTarget
} from '@avenos/llm-client/input-decision'
import { inputLocale } from '@avenos/llm-client/input-decision'
import type { AnonymousSpeaker } from './anonymous-speaker'
import { captureInputContext, type InputCapture, inputCaptureSchema } from './input-capture'

export interface PendingInput {
	id: string
	revision: number
	text: string
	originalText: string
	corrections: string[]
	locale: string
	createdAt: string
	/** Absent only when a saved draft cannot establish its original screen context. */
	capture?: InputCapture
	speaker?: AnonymousSpeaker
	defaultId: string
	selectionEpoch: number
	stage: 'checking' | 'choice' | 'assigning' | 'failed'
	intents: InputIntent[]
	suggestion: InputTarget | null
	topic: string
	/** Absent while unclassified or after a manual destination choice on routing failure. */
	responseMode?: InputRoute['responseMode']
	feedbackCheck?: FeedbackCheck
	sourceContext?: SourceContext
	error: string | null
	confirmed: boolean
	decisionId: string
	replyTo?: { id: string; revision: number; decisionId: string }
	assignment?: InputTarget
}
export interface InputHost {
	inspect(
		item: PendingInput,
		signal: AbortSignal
	): Promise<{ intents: InputIntent[]; route: InputRoute }>
	reply(item: PendingInput, pending: PendingInput, signal: AbortSignal): Promise<InputReply>
	assign(item: PendingInput, target: InputTarget): Promise<string>
	/** Encrypted local storage only. A failed save never silently discards the input. */
	save?(items: PendingInput[]): Promise<void>
	announce?(item: PendingInput): void
}
export class InputNotAccepted extends Error {}

/** Independent admission jobs. A destination choice never owns the execution queue. */
export class InputInboxController {
	items: PendingInput[] = []
	activeId = ''
	#jobs = new Map<string, { cancel: AbortController; done: () => void }>()
	#storage = Promise.resolve()
	#generation = 0
	#suspended = false
	#recoveryGeneration = 0
	constructor(
		private host: InputHost,
		private changed: () => void,
		private decisionDeadlineMs = 5000
	) {}
	setPersistence(save: InputHost['save']) {
		this.host.save = save
	}
	flush() {
		return this.#storage
	}
	persist() {
		return this.#save()
	}
	get recoveryGeneration() {
		return this.#recoveryGeneration
	}
	get active() {
		return this.items.find((i) => i.id === this.activeId) ?? this.items[0]
	}
	#notify() {
		this.changed()
	}
	#save(): Promise<void> {
		const snapshot = structuredClone(this.items)
		const persist = this.host.save
		const save = this.#storage.catch(() => {}).then(() => persist?.(snapshot))
		this.#storage = save
		return save
	}
	select(id: string) {
		if (this.items.some((i) => i.id === id)) {
			this.activeId = id
			this.#notify()
		}
	}
	submit(
		text: string,
		defaultId: string,
		selectionEpoch: number,
		speaker?: AnonymousSpeaker,
		id = crypto.randomUUID(),
		locale = 'en-GB',
		feedbackCheck?: FeedbackCheck,
		sourceContext?: SourceContext,
		capture: InputCapture = captureInputContext()
	): Promise<void> {
		if (this.#suspended)
			throw new InputNotAccepted('The workspace is changing. Your message has not been sent.')
		if (!text.trim() || text.length > 8000)
			throw new InputNotAccepted(
				'Use a message of up to 8,000 characters. Your words are still in the input.'
			)
		if (this.items.length >= 100)
			throw new InputNotAccepted(
				'There are too many unsent messages. Send or discard one before adding another.'
			)
		if (this.items.some((item) => item.id === id))
			throw new InputNotAccepted('This message is already in the input tray.')
		const pending = this.active
		const replyTo =
			pending?.stage === 'choice' && !pending.replyTo
				? { id: pending.id, revision: pending.revision, decisionId: pending.decisionId }
				: undefined
		const item: PendingInput = {
			id,
			revision: 1,
			text,
			originalText: text,
			corrections: [],
			locale: inputLocale(locale),
			createdAt: new Date().toISOString(),
			capture: inputCaptureSchema.parse(capture),
			speaker,
			defaultId,
			selectionEpoch,
			stage: 'checking',
			intents: [],
			suggestion: null,
			topic: '',
			error: null,
			confirmed: false,
			decisionId: crypto.randomUUID(),
			replyTo,
			feedbackCheck,
			sourceContext
		}
		this.items.push(item)
		if (!this.activeId) this.activeId = id
		const done = new Promise<void>((resolve) =>
			this.#jobs.set(id, { cancel: new AbortController(), done: resolve })
		)
		this.#notify()
		void this.#inspect(item)
		return done
	}
	#current(item: PendingInput, revision: number, generation: number) {
		return (
			generation === this.#generation &&
			this.items.includes(item) &&
			item.revision === revision &&
			!this.#suspended &&
			this.#jobs.has(item.id) &&
			!this.#jobs.get(item.id)!.cancel.signal.aborted
		)
	}
	async #decision<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
		const deadline = new AbortController()
		let timer: ReturnType<typeof setTimeout> | undefined
		const timedOut = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				const error = Error(
					'The destination check is taking too long. Your message is still here; choose its destination or retry.'
				)
				deadline.abort(error)
				reject(error)
			}, this.decisionDeadlineMs)
		})
		try {
			return await Promise.race([run(AbortSignal.any([signal, deadline.signal])), timedOut])
		} finally {
			clearTimeout(timer)
		}
	}
	async #inspect(item: PendingInput) {
		const revision = item.revision,
			generation = this.#generation
		const signal = this.#jobs.get(item.id)!.cancel.signal
		try {
			await this.#save()
			if (!this.#current(item, revision, generation)) return
			if (item.replyTo) {
				const pending = this.items.find((i) => i.id === item.replyTo!.id)
				if (
					!pending ||
					pending.stage !== 'choice' ||
					pending.revision !== item.replyTo.revision ||
					pending.decisionId !== item.replyTo.decisionId
				)
					throw Error(
						'That destination question changed. Edit this reply or choose where to send it.'
					)
				const reply = await this.#decision(
					(s) => this.host.reply(item, structuredClone(pending), s),
					signal
				)
				if (!this.#current(item, revision, generation)) return
				if (
					pending.stage !== 'choice' ||
					pending.revision !== item.replyTo.revision ||
					pending.decisionId !== item.replyTo.decisionId
				)
					throw Error(
						'That destination question was already answered. Your words have not been sent.'
					)
				if (reply === 'clarify')
					throw Error('Please choose a destination, or clarify which message you mean.')
				if (reply === 'accept-suggested') {
					if (!pending.suggestion) throw Error('Please choose a destination first.')
					this.choose(pending.id, pending.suggestion)
				} else if (reply === 'keep-current') {
					if (!pending.intents.some((i) => i.id === pending.defaultId))
						throw Error('The original Intent is no longer available.')
					this.choose(pending.id, { kind: 'existing', id: pending.defaultId })
				} else if (reply === 'cancel') {
					await this.discard(pending.id)
				} else if (reply === 'amend') {
					if (
						pending.corrections.length >= 20 ||
						pending.text.length + item.text.length + 14 > 16000
					)
						throw Error(
							'This message has too many corrections. Edit the original; these words have not been sent.'
						)
					pending.corrections.push(item.text)
					pending.text = `${pending.originalText}\n\n${pending.corrections.map((t) => `Correction: ${t}`).join('\n')}`
					pending.revision++
					delete pending.responseMode
					pending.decisionId = crypto.randomUUID()
					pending.stage = 'checking'
					pending.error = null
					void this.#inspect(pending)
				}
				if (reply !== 'independent') {
					await this.#remove(item)
					return
				}
				delete item.replyTo
			}
			const inspected = await this.#decision(
				(s) => this.host.inspect(structuredClone(item), s),
				signal
			)
			if (!this.#current(item, revision, generation) || item.stage !== 'checking') return
			item.intents = inspected.intents
			item.suggestion = inspected.route.target
			item.topic = inspected.route.topic
			item.responseMode = inspected.route.responseMode
			if (inspected.route.target && (inspected.route.fit || inspected.route.explicit)) {
				item.confirmed = inspected.route.explicit
				await this.#assign(item, inspected.route.target)
			} else {
				item.stage = 'choice'
				this.#notify()
				await this.#save()
				if (this.active?.id === item.id) this.host.announce?.(structuredClone(item))
			}
		} catch (error) {
			if (!this.#current(item, revision, generation)) return
			item.stage = 'failed'
			item.error =
				error instanceof Error ? error.message : 'The destination check could not finish.'
			this.#notify()
			void this.#save().catch(() => {})
		}
	}
	async #assign(item: PendingInput, target: InputTarget) {
		item.stage = 'assigning'
		item.assignment = target
		this.#notify()
		await this.#save() // Recover the exact dispatched decision after a lost acknowledgement.
		const revision = item.revision,
			generation = this.#generation
		if (!this.#current(item, revision, generation)) return
		await this.host.assign(structuredClone(item), target)
		if (this.#current(item, revision, generation)) await this.#remove(item)
	}
	choose(id: string, target: InputTarget) {
		if (this.#suspended) return
		const item = this.items.find((i) => i.id === id)
		if (!item || !['choice', 'failed'].includes(item.stage) || item.assignment) return
		if (target.kind === 'existing' && !item.intents.some((i) => i.id === target.id)) return
		if (target.kind === 'new' && (!target.title.trim() || target.title.length > 160)) return
		item.confirmed = true
		item.stage = 'assigning' // Guard double taps and in-flight spoken replies synchronously.
		void this.#assign(item, target).catch((error) => {
			if (!this.items.includes(item)) return
			item.stage = 'failed'
			item.error = String(error instanceof Error ? error.message : error)
			this.#notify()
			void this.#save().catch(() => {})
		})
	}
	retry(id: string) {
		if (this.#suspended) return
		const item = this.items.find((i) => i.id === id)
		if (!item || item.stage !== 'failed') return
		item.error = null
		const job = this.#jobs.get(id)!
		job.cancel.abort()
		job.cancel = new AbortController()
		if (item.assignment) {
			void this.#assign(item, item.assignment).catch((error) => {
				if (!this.items.includes(item)) return
				item.stage = 'failed'
				item.error = String(error instanceof Error ? error.message : error)
				this.#notify()
			})
		} else {
			item.stage = 'checking'
			this.#notify()
			void this.#inspect(item)
		}
	}
	addCandidates(id: string, found: InputIntent[]) {
		const item = this.items.find((i) => i.id === id)
		if (!item) return
		item.intents = [...new Map([...item.intents, ...found].map((i) => [i.id, i])).values()]
		this.#notify()
	}
	async #remove(item: PendingInput) {
		const generation = this.#generation
		this.items = this.items.filter((i) => i !== item)
		// Serialize removal with every other save, preserving inputs submitted during I/O.
		try {
			await this.#save()
		} catch (error) {
			// A failed old-scope save must not reinsert private text into a new workspace.
			if (generation !== this.#generation) throw error
			this.items.push(item)
			this.#notify()
			// Repair snapshots queued during the failed removal before reporting failure.
			await this.#save().catch(() => {})
			throw error
		}
		if (generation !== this.#generation) return
		this.#jobs.get(item.id)?.done()
		this.#jobs.delete(item.id)
		if (this.activeId === item.id) this.activeId = this.items[0]?.id ?? ''
		this.#notify()
	}
	async discard(id: string): Promise<string | null> {
		const item = this.items.find((i) => i.id === id)
		if (!item || item.stage === 'assigning' || item.assignment) return null
		this.#jobs.get(id)?.cancel.abort()
		try {
			await this.#remove(item)
			return item.text
		} catch {
			item.stage = 'failed'
			item.error = 'Could not remove the saved draft. Try again.'
			this.#notify()
			return null
		}
	}
	reset() {
		this.#generation++
		this.#recoveryGeneration++
		this.#suspended = false
		for (const job of this.#jobs.values()) {
			job.cancel.abort()
			job.done()
		}
		this.#jobs.clear()
		this.items = []
		this.activeId = ''
		this.#notify()
	}
	async suspend() {
		if (this.items.some((i) => i.stage === 'assigning'))
			throw Error('Wait for the message to finish sending.')
		this.#suspended = true
		this.#generation++
		for (const item of this.items) {
			this.#jobs.get(item.id)?.cancel.abort()
			if (item.stage === 'checking') {
				item.stage = 'failed'
				item.error = 'Destination check paused. Retry when you return.'
			}
		}
		this.#notify()
		await this.#save()
	}
	resume() {
		this.#suspended = false
		for (const job of this.#jobs.values())
			if (job.cancel.signal.aborted) job.cancel = new AbortController()
	}
	restore(items: PendingInput[]) {
		const known = new Set(this.items.map((i) => i.id))
		const recovered: PendingInput[] = structuredClone(items)
			.filter((i) => !known.has(i.id))
			.map((i) => ({
				...i,
				stage: 'failed',
				error: i.assignment
					? 'Checking whether this message was sent is required before retrying.'
					: 'Recovered unsent message. Check its destination to continue.'
			}))
		// Input typed while the private store opens remains separate and is never replaced.
		this.items = [...recovered, ...this.items]
		for (const item of recovered)
			this.#jobs.set(item.id, { cancel: new AbortController(), done: () => {} })
		this.activeId ||= this.items[0]?.id ?? ''
		this.#notify()
	}
}
