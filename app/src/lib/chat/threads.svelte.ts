import {
	type ContextReference,
	captureContextReferences
} from '@avenos/chat-engine/context-references'
import { captureFeedbackContext, readFeedbackCheck } from '@avenos/chat-engine/response-feedback'
import { captureSourceContext } from '@avenos/chat-engine/source-context'
import type { ToolCall } from '@avenos/chat-engine/tool-call'
import type { AnonymousSpeaker } from './anonymous-speaker'
import { Chat, type ChatSink, type ChatTools, type Turn } from './chat.svelte'
import { FeedbackRecovery, type FeedbackRecoveryHost } from './feedback-recovery'
import { captureInputContext, type InputCapture } from './input-capture'
import type { PendingInput } from './input-inbox.svelte'
import { InputInbox } from './input-inbox.svelte'
import {
	assessInputFeedback,
	type InputIntent,
	type InputTarget,
	replyToRoute,
	routeInput
} from './input-routing'
import type { streamChat } from './redpill'

/** Owns independent conversations; selection is only a view, not an execution lock. */
export class ChatThreads {
	session = $state('')
	#revision = $state(0)
	#threads = new Map<string, Chat>()
	#uploads = new Map<string, Chat>()
	#assets = new Chat()
	#sink: ChatSink
	#tools: (thread: Chat) => ChatTools
	#stream?: typeof streamChat
	#audible: Chat | null = null
	#audibleUser: string | null = null
	#inputEpoch = 0
	#selectionEpoch = 0
	#latestInput = ''
	#narrationEpoch = 0
	readonly input: InputInbox
	unread = $state<string[]>([])
	inputCatalog: ((query?: string, defaultId?: string) => Promise<InputIntent[]>) | null = null
	assignInput:
		| ((target: InputTarget, requestId: string) => Promise<{ session: string; call?: ToolCall }>)
		| null = null
	onInput: (() => void) | null = null
	onInputRejected: ((text: string, error: unknown) => void) | null = null
	context: ((session: string) => string) | null = null
	captureInputContext: (() => InputCapture) | null = null
	contextReferences: ((session: string) => readonly ContextReference[]) | null = null
	prepareSession: ((prompt: string, session: string) => Promise<string>) | null = null
	onExchange: Chat['onExchange'] = null
	persistInput: ((session: string, user: Turn) => Promise<void>) | null = null
	onFeedbackAssessment: FeedbackRecoveryHost['commit'] | null = null
	#feedbackRecovery = new FeedbackRecovery({
		assess: (input, check, signal) =>
			assessInputFeedback(input.content, check.recent, check.locale, signal),
		commit: (...args) => {
			if (!this.onFeedbackAssessment) throw Error('Feedback storage is not ready.')
			return this.onFeedbackAssessment(...args)
		}
	})
	onSelect: ((id: string) => void) | null = null
	onSilence: (() => void) | null = null
	onRoutingQuestion: ((item: PendingInput) => void) | null = null

	constructor(sink: ChatSink, tools: (thread: Chat) => ChatTools, stream?: typeof streamChat) {
		this.#sink = sink
		this.#tools = tools
		this.#stream = stream
		this.input = new InputInbox({
			announce: (item) => this.onRoutingQuestion?.(item),
			reply: (item, pending, signal) =>
				replyToRoute(
					item.text,
					{
						text: pending.text,
						current: pending.intents.find((i) => i.id === pending.defaultId)?.title ?? '',
						suggested:
							pending.suggestion?.kind === 'new'
								? pending.suggestion.title
								: (pending.intents.find(
										(i) =>
											i.id ===
											(pending.suggestion?.kind === 'existing' ? pending.suggestion.id : '')
									)?.title ?? ''),
						canKeep: pending.intents.some((i) => i.id === pending.defaultId)
					},
					pending.locale,
					signal
				),
			inspect: async (item, signal) => {
				if (!this.inputCatalog) throw Error('The workspace is not ready. Try again shortly.')
				const intents = await this.inputCatalog('', item.defaultId)
				this.input.addCandidates(item.id, intents)
				const recent =
					item.feedbackCheck?.recent ?? captureFeedbackContext(this.thread(item.defaultId).turns)
				return {
					intents,
					route: await routeInput(
						item.text,
						{ selectedId: item.defaultId, intents, recent },
						signal,
						item.locale
					)
				}
			},
			assign: async (item, target) => {
				if (!this.assignInput) throw Error('The workspace is not ready. Try again shortly.')
				const submission = this.#submissions.get(item.id) ?? {
					epoch: this.#inputEpoch,
					selection: -1,
					narration: -1,
					origin: item.defaultId,
					context: this.context?.(item.defaultId) ?? '',
					contextReferences: captureContextReferences(this.contextReferences?.(item.defaultId)),
					execution: Promise.resolve()
				}
				const route = await this.assignInput(target, item.id)
				if (submission.epoch !== this.#inputEpoch) throw Error('The workspace changed.')
				const thread = this.thread(route.session)
				const destinationDecision =
					target.kind === 'new'
						? 'The user confirmed creation. The requested new Intent has ALREADY been created, as the creation receipt shows.'
						: item.confirmed
							? 'The user explicitly requested or confirmed this EXISTING Intent. This accepted destination supersedes any other destination in the original wording. NO new Intent was created or is now wanted. Routing is COMPLETE, not blocked. Continue with the actual topic here. Do not apologize about missing Intent tools, say an Intent still needs creation, or ask again whether to discuss the topic here.'
							: 'The contribution fits its existing Intent. NO new Intent was created. Continue in this accepted destination.'
				const context =
					(route.session === submission.origin
						? submission.context
						: (this.context?.(route.session) ?? '')) +
					(item.capture?.prompt ?? '') +
					`\nINPUT ADMISSION: The destination has been checked and accepted: Intent ${route.session}. Do not create, switch or relocate this conversation again. ${destinationDecision} The user may be viewing another screen. Discuss the requested topic here; an exploratory topic alone does not authorize speculative work.`
				const contextReferences =
					route.session === submission.origin
						? submission.contextReferences
						: captureContextReferences(this.contextReferences?.(route.session))
				const user: Turn = {
					id: item.id,
					role: 'user',
					content: item.text,
					inputAdmission: {
						intentId: route.session,
						destination: target.kind,
						confirmed: item.confirmed,
						...(item.sourceContext &&
							item.sourceContext.intentId !== route.session && {
								sourceContext: item.sourceContext
							}),
						...(item.responseMode && { responseMode: item.responseMode })
					},
					anonymousSpeaker: item.speaker,
					feedbackCheck: item.feedbackCheck,
					queued: true
				}
				if (!this.persistInput)
					throw Error('Conversation storage is not ready. Your message has not been sent.')
				await this.persistInput(route.session, user)
				if (submission.epoch !== this.#inputEpoch) throw Error('The workspace changed.')
				// Navigation follows successful admission, never just a routing guess.
				// A newer input or an intervening screen change keeps the user's focus.
				if (
					(target.kind === 'new' || item.confirmed) &&
					this.#latestInput === item.id &&
					this.#selectionEpoch === submission.selection &&
					route.session !== this.session
				) {
					this.#select(route.session, false)
					this.onSelect?.(route.session)
				}
				if (route.call)
					route.call.result = JSON.stringify({
						...JSON.parse(route.call.result),
						screenSelected: this.session === route.session
					})
				this.#feedbackRecovery.enqueue(route.session, user)
				submission.execution = thread.send(item.text, item.speaker, {
					user,
					context,
					contextReferences,
					calls: route.call ? [route.call] : []
				})
				if (
					this.#latestInput === item.id &&
					this.session === route.session &&
					submission.narration === this.#narrationEpoch
				) {
					this.#audible = thread
					this.#audibleUser = item.id
				}
				return route.session
			}
		})
		this.thread('')
	}
	#submissions = new Map<
		string,
		{
			epoch: number
			selection: number
			narration: number
			origin: string
			context: string
			contextReferences: ContextReference[]
			execution: Promise<void>
		}
	>()

	thread(key = this.session): Chat {
		void this.#revision
		let thread = this.#threads.get(key)
		if (thread) return thread
		const audible = () =>
			this.#audible === thread &&
			this.#audibleUser === thread!.activeUserId &&
			this.session === thread!.session
		const tools = () => this.#tools(thread!)
		thread = new Chat(
			{
				onDelta: (text) => {
					if (audible()) this.#sink.onDelta?.(text)
				},
				onDone: () => {
					if (audible()) this.#sink.onDone?.()
				},
				onRestart: () => {
					if (audible()) this.#sink.onRestart?.()
				},
				onTurn: () => {
					this.#sink.onTurn?.()
				}
			},
			{
				get specs() {
					return tools().specs
				},
				run: (name, args) => tools().run(name, args)
			},
			this.#stream
		)
		this.#threads.set(key, thread)
		this.#revision++
		thread.use(key)
		thread.context = () => this.context?.(thread!.session) ?? ''
		thread.contextReferences = () => this.contextReferences?.(thread!.session) ?? []
		thread.prepareSession = async (prompt) => {
			const target = await this.prepareSession?.(prompt, thread!.session)
			if (target && target !== thread!.session) this.relocate(thread!, target)
		}
		thread.onExchange = (...args) => {
			if (args[0] !== this.session && !this.unread.includes(args[0])) this.unread.push(args[0])
			this.onExchange?.(...args)
		}
		return thread
	}

	get turns() {
		return this.thread().turns
	}
	get streaming() {
		return this.thread().streaming
	}
	get verifying() {
		return this.thread().verifying
	}
	get modelActivity() {
		return this.thread().modelActivity
	}
	get recoveringStream() {
		return this.thread().recoveringStream
	}
	get failure() {
		return this.thread().failure
	}
	set failure(value: string | null) {
		this.thread().failure = value
	}
	get routing() {
		return this.thread().routing
	}
	get routingReply() {
		return this.thread().routingReply
	}
	get preparingPrompt() {
		return this.thread().preparingPrompt
	}
	get toolCalls() {
		return this.thread().toolCalls
	}
	get activeToolCalls() {
		return this.thread().activeToolCalls
	}
	get responseStartedAt() {
		return this.thread().responseStartedAt
	}
	get lastRequest() {
		return this.thread().lastRequest
	}
	get diagnostics() {
		return this.thread().diagnostics
	}
	get canSend() {
		return true
	}
	get busy() {
		return this.input.items.length > 0 || this.working
	}
	get working() {
		void this.#revision
		return [...this.#threads.values()].some(
			(t) => t.streaming || t.preparingPrompt || t.turns.some((turn) => turn.queued)
		)
	}

	status(key: string): 'working' | 'queued' | 'idle' {
		void this.#revision
		const thread = this.#threads.get(key)
		return thread?.streaming ? 'working' : thread?.turns.some((t) => t.queued) ? 'queued' : 'idle'
	}

	use(key: string): void {
		if (key === this.session) return
		this.#selectionEpoch++
		this.#select(key)
	}

	#select(key: string, silence = true): void {
		if (silence) this.silence()
		this.session = key
		this.unread = this.unread.filter((id) => id !== key)
		this.thread(key)
		this.#sink.onTurn?.()
	}

	send(text: string, speaker?: AnonymousSpeaker): Promise<void> {
		if (!text.trim()) return Promise.resolve()
		this.silence()
		const submission = {
			epoch: this.#inputEpoch,
			selection: this.#selectionEpoch,
			narration: this.#narrationEpoch,
			origin: this.session,
			context: this.context?.(this.session) ?? '',
			contextReferences: captureContextReferences(this.contextReferences?.(this.session)),
			execution: Promise.resolve()
		}
		const id = crypto.randomUUID()
		this.#latestInput = id
		this.#submissions.set(id, submission)
		let admission: Promise<void>
		try {
			const locale = typeof navigator === 'undefined' ? 'en-GB' : navigator.language
			const feedbackCheck = readFeedbackCheck({
				commandId: crypto.randomUUID(),
				intentId: this.session,
				locale,
				recent: captureFeedbackContext(this.thread().turns)
			})
			admission = this.input.submit(
				text.trim(),
				this.session,
				this.#selectionEpoch,
				speaker,
				id,
				locale,
				feedbackCheck,
				captureSourceContext(this.session, this.thread().turns),
				this.captureInputContext?.() ?? captureInputContext()
			)
		} catch (error) {
			this.#submissions.delete(id)
			this.onInputRejected?.(text, error)
			throw error
		}
		this.onInput?.()
		return admission.then(() => submission.execution).finally(() => this.#submissions.delete(id))
	}

	/** Barge-in affects narration, never the agent or its queue. */
	silence(): void {
		this.#narrationEpoch++
		this.#audible = null
		this.#audibleUser = null
		this.onSilence?.()
	}

	stop(key = this.session): void {
		this.#threads.get(key)?.stop()
	}

	/** Routing tools carry their own runner; they never act on the selected runner. */
	relocate(thread: Chat, key: string): void {
		const old = thread.session
		if (key === old) return
		if (this.status(key) !== 'idle')
			throw Error('That Intent is already working. Open it and send a queued follow-up there.')
		const target = this.#threads.get(key)
		const oldHistory = thread.turns
		if (target) thread.hydrate(key, target.turns)
		thread.relocateTurn(key)
		// Admission can route before a turn has started. Preserve submitted messages too.
		if (!thread.streaming) thread.mergeSessions([old], key)
		const oldTurns = oldHistory.filter((turn) => !turn.queued)
		thread.use(key)
		this.#threads.delete(old)
		this.#threads.set(key, thread)
		this.#revision++
		this.hydrate(old, oldTurns)
		if (this.session === old) {
			this.session = key
			this.onSelect?.(key)
		}
	}

	hydrate(key: string, turns: Turn[]) {
		this.thread(key).hydrate(key, turns)
		for (const turn of turns)
			if (turn.persisted && turn.role === 'user') this.#feedbackRecovery.enqueue(key, turn)
		this.#feedbackRecovery.resume()
	}
	/** A previously pending target now has a durable reply. No new model assessment. */
	resumeFeedback() {
		this.#feedbackRecovery.resume()
	}
	conversationFor(key: string, query = '') {
		return this.thread(key).conversationFor(key, query)
	}
	conversationMatches(key: string, query: string) {
		return this.thread(key).conversationMatches(key, query)
	}
	messageHistory(key: string) {
		return this.thread(key).messageHistory(key)
	}
	assertMergeable(keys: string[]) {
		if (keys.some((key) => this.status(key) !== 'idle'))
			throw Error('Wait for these Intents to finish, or stop their responses, before merging them.')
	}
	mergeSessions(from: string[], into: string) {
		this.assertMergeable([...from, into])
		const target = this.thread(into)
		for (const key of from) {
			if (key === into) continue
			target.hydrate(key, this.thread(key).turns)
			target.mergeSessions([key], into)
			this.#threads.delete(key)
		}
		this.#revision++
		if (from.includes(this.session)) this.use(into)
	}
	clear() {
		this.thread().clear()
	}
	export() {
		return this.thread().export()
	}
	resetForEnvironment() {
		this.silence()
		this.#inputEpoch++
		this.#feedbackRecovery.reset()
		this.#selectionEpoch++
		this.input.reset()
		this.#submissions.clear()
		for (const thread of this.#threads.values()) thread.resetForEnvironment()
		this.#threads.clear()
		this.#uploads.clear()
		this.#assets.resetForEnvironment()
		this.unread = []
		this.session = ''
		this.thread('')
		this.#revision++
	}

	beginArtifactUpload(uploadId: string, publicationId: string, name: string, key = this.session) {
		const thread = this.thread(key)
		this.#uploads.set(uploadId, thread)
		thread.beginArtifactUpload(uploadId, publicationId, name, key)
	}
	updateArtifactUpload(...args: Parameters<Chat['updateArtifactUpload']>) {
		this.#uploads.get(args[0])?.updateArtifactUpload(...args)
	}
	commitArtifactUpload(...args: Parameters<Chat['commitArtifactUpload']>) {
		this.#uploads.get(args[0])?.commitArtifactUpload(...args)
		this.#uploads.delete(args[0])
	}
	failArtifactUpload(...args: Parameters<Chat['failArtifactUpload']>) {
		this.#uploads.get(args[0])?.failArtifactUpload(...args)
		this.#uploads.delete(args[0])
	}
	adoptArtifact(...args: Parameters<Chat['adoptArtifact']>) {
		this.#assets.adoptArtifact(...args)
	}
	artifactInfo(id: string) {
		return (
			[...this.#threads.values()].map((t) => t.artifactInfo(id)).find(Boolean) ??
			this.#assets.artifactInfo(id)
		)
	}
	hasArtifact(id: string) {
		return !!this.artifactInfo(id)
	}
	updateArtifactProcessing(...args: Parameters<Chat['updateArtifactProcessing']>) {
		for (const t of [...this.#threads.values(), this.#assets]) t.updateArtifactProcessing(...args)
	}
	markArtifactProcessingPending(id: string) {
		for (const t of [...this.#threads.values(), this.#assets]) t.markArtifactProcessingPending(id)
	}
	markArtifactProcessingUnavailable(id: string, error: string) {
		for (const t of [...this.#threads.values(), this.#assets])
			t.markArtifactProcessingUnavailable(id, error)
	}
}
