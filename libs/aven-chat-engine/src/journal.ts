import type { TurnOperation } from '@avenos/intents/turn-progress'
import type { ChatCore, ChatTools, Turn } from './chat'
import type { ModelPhase, ModelStream, StreamEvent } from './model'
import { IncompleteModelStream } from './stream-errors'
import { toolResultFailed } from './tool-call'

export interface OperationTiming {
	startedAt: number
	durationMs: number
	basis: 'execution' | 'receipt-check' | 'read-again' | 'recomputed'
	/** First public text or tool fragment, not private reasoning, audio or rendered UI. */
	firstContentMs?: number
	/** First public text delta, separately from an earlier tool fragment. */
	firstTextMs?: number
}
export interface ToolResult {
	record: string
	wire: string
	outcome?: 'uncertain'
	timing?: OperationTiming
}
export interface ToolResolution {
	result: ToolResult
	basis: 'receipt-check' | 'read-again' | 'recomputed'
}
export type ModelResult = { events: StreamEvent[] } | { error: { name: string; message: string } }
export interface ChatOutcome {
	state: 'completed' | 'failed'
	failure: string | null
	reply: Turn
	diagnostics: ChatCore['diagnostics']
}
export type JournalValue =
	| ((
			| { kind: 'model'; phase?: ModelPhase; result: ModelResult }
			| {
					kind: 'tool'
					command: { name: string; args: string }
					result: ToolResult
			  }
	  ) & { timing: OperationTiming })
	| { kind: 'outcome'; result: ChatOutcome }
/** Only execution metadata: never model messages, reasoning, credentials or tool arguments. */
export type OperationProgress = TurnOperation
export type JournalClaim =
	| { state: 'new'; invocationId: string }
	| { state: 'complete'; invocationId: string; value: JournalValue }
	| { state: 'uncertain'; invocationId: string }

/** Customer-owned records. The host must fence every method with its current execution lease. */
export interface TurnJournal {
	claim(ordinal: number, kind: JournalValue['kind'], digest: string): Promise<JournalClaim>
	complete(ordinal: number, value: JournalValue): Promise<void>
	/** Original execution start and elapsed wall time, measured by the same durable
	 * clock across attempts. Omit elapsed time if the clock moved backwards. */
	timing(): Promise<{ startedAt: number; durationMs?: number }>
}
export class TurnRecoveryRequired extends Error {}

function canonical(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map((v) => canonical(v ?? null)).join(',')}]`
	return `{${Object.entries(value)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
		.join(',')}}`
}
export async function journalDigest(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonical(value))
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
		.map((v) => v.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Replay engine I/O, not effects. Stored model frames rebuild the same engine state,
 * including its review/repair budget. A changed request fails closed in the journal.
 * Failed persistence poisons the attempt: the engine may catch errors, but no later
 * model or tool request can escape the fence and no result may be published.
 */
export class JournaledChatPorts {
	#ordinal = 0
	#failure: Error | null = null
	constructor(
		private readonly journal: TurnJournal,
		private readonly signal?: AbortSignal,
		private readonly progress?: (event: OperationProgress) => Promise<void>
	) {}
	assertHealthy() {
		if (this.#failure) throw this.#failure
		if (this.signal?.aborted) throw new TurnRecoveryRequired('Turn execution was interrupted.')
	}
	async #guard<T>(action: () => Promise<T>): Promise<T> {
		this.assertHealthy()
		try {
			const result = await action()
			this.assertHealthy()
			return result
		} catch (error) {
			this.#failure =
				error instanceof Error ? error : new TurnRecoveryRequired('Turn checkpoint failed.')
			throw this.#failure
		}
	}
	model(live: ModelStream): ModelStream {
		const ports = this
		return async function* (messages, tools, signal, model, options) {
			const ordinal = ports.#ordinal++
			// Optional model metadata must remain portable when a caller has no
			// phase classification; explicit undefined is not a JSON field.
			const phase = options?.phase ? { phase: options.phase } : {}
			const claim = await ports.#guard(async () =>
				ports.journal.claim(
					ordinal,
					'model',
					await journalDigest({ messages, tools, model, options })
				)
			)
			if (claim.state === 'uncertain')
				return await ports.#guard(async () => {
					throw new TurnRecoveryRequired('Model checkpoint is not recoverable.')
				})
			let result: ModelResult, timing: OperationTiming
			if (claim.state === 'complete') {
				if (claim.value.kind !== 'model')
					return await ports.#guard(async () => {
						throw new TurnRecoveryRequired('Unexpected model checkpoint.')
					})
				result = claim.value.result
				timing = claim.value.timing
			} else {
				const startedAt = Date.now(),
					began = performance.now()
				await ports.#guard(async () =>
					ports.progress?.({
						ordinal,
						kind: 'model',
						...phase,
						state: 'running',
						startedAt,
						replayed: false
					})
				)
				const events: StreamEvent[] = []
				let firstContentMs: number | undefined
				let firstTextMs: number | undefined
				let bytes = 0
				try {
					for await (const event of live(messages, tools, signal, model, options)) {
						ports.assertHealthy()
						if (firstTextMs === undefined && event.kind === 'text' && event.text.length > 0)
							firstTextMs = performance.now() - began
						if (
							firstContentMs === undefined &&
							((event.kind === 'text' && event.text.length > 0) ||
								(event.kind === 'tool' && Boolean(event.id || event.name || event.args)))
						)
							firstContentMs = performance.now() - began
						bytes += new TextEncoder().encode(JSON.stringify(event)).length
						if (bytes > 2 * 1024 * 1024)
							throw new IncompleteModelStream('Model response exceeds the checkpoint bound.')
						events.push(event)
						yield event
					}
					result = { events }
				} catch (error) {
					ports.assertHealthy()
					if (signal?.aborted) throw new TurnRecoveryRequired('Model request was interrupted.')
					result = {
						error: {
							name: error instanceof Error ? error.name : 'Error',
							message: error instanceof Error ? error.message : 'Model request failed.'
						}
					}
					if (error instanceof IncompleteModelStream) result.error.name = 'IncompleteModelStream'
				}
				timing = {
					startedAt,
					durationMs: performance.now() - began,
					basis: 'execution',
					...(firstContentMs !== undefined && { firstContentMs }),
					...(firstTextMs !== undefined && { firstTextMs })
				}
				await ports.#guard(() =>
					ports.journal.complete(ordinal, {
						kind: 'model',
						...phase,
						result,
						timing
					})
				)
			}
			await ports.#guard(async () =>
				ports.progress?.({
					ordinal,
					kind: 'model',
					...phase,
					state: 'error' in result ? 'failed' : 'completed',
					...timing,
					replayed: claim.state === 'complete'
				})
			)
			if ('error' in result)
				throw result.error.name === 'IncompleteModelStream'
					? new IncompleteModelStream(result.error.message)
					: new Error(result.error.message)
			if (claim.state === 'complete')
				for (const event of result.events) {
					ports.assertHealthy()
					yield event
				}
		}
	}
	tools(
		specs: ChatTools['specs'],
		execute: (name: string, args: string, invocationId: string) => Promise<ToolResult>,
		resolve?: (invocationId: string, name: string, args: string) => Promise<ToolResolution | null>
	): ChatTools {
		return {
			specs,
			run: async (name, args) => {
				const ordinal = this.#ordinal++
				const command = { name, args }
				const digest = await journalDigest(command)
				const claim = await this.#guard(async () => this.journal.claim(ordinal, 'tool', digest))
				if (claim.state === 'complete') {
					if (
						claim.value.kind !== 'tool' ||
						!claim.value.command ||
						(await journalDigest(claim.value.command)) !== digest
					)
						return this.#guard(async () => {
							throw new TurnRecoveryRequired('Unexpected tool checkpoint.')
						})
					const value = claim.value
					await this.#guard(async () =>
						this.progress?.({
							ordinal,
							kind: 'tool',
							name,
							state: toolResultFailed(value.result.record) ? 'failed' : 'completed',
							...value.timing,
							replayed: true
						})
					)
					return { ...value.result, timing: value.timing }
				}
				const startedAt = Date.now(),
					began = performance.now()
				await this.#guard(async () =>
					this.progress?.({
						ordinal,
						kind: 'tool',
						name,
						state: claim.state === 'uncertain' ? 'reconciling' : 'running',
						startedAt,
						replayed: false
					})
				)
				let basis: OperationTiming['basis'] = 'execution'
				const result = await this.#guard(async () => {
					if (claim.state === 'uncertain') {
						const receipt = await resolve?.(claim.invocationId, name, args)
						if (!receipt)
							throw new TurnRecoveryRequired(
								'An interrupted operation needs its receipt checked before continuing.'
							)
						basis = receipt.basis
						return receipt.result
					}
					return execute(name, args, claim.invocationId)
				})
				const timing: OperationTiming = {
					startedAt,
					durationMs: performance.now() - began,
					basis
				}
				await this.#guard(async () => {
					if (result.outcome === 'uncertain')
						throw new TurnRecoveryRequired(
							'The operation may have been saved. Check its receipt before continuing; do not repeat it as a new change.'
						)
					await this.journal.complete(ordinal, {
						kind: 'tool',
						command,
						result,
						timing
					})
				})
				await this.#guard(async () =>
					this.progress?.({
						ordinal,
						kind: 'tool',
						name,
						state: toolResultFailed(result.record) ? 'failed' : 'completed',
						...timing,
						replayed: false
					})
				)
				return { ...result, timing }
			}
		}
	}

	/** Publish the exact same answer, diagnostics and timing after a lost acknowledgement.
	 * Rebuilding model/tool state alone is insufficient: measured wall time changes on replay.
	 */
	async outcome(material: unknown, value: ChatOutcome): Promise<ChatOutcome> {
		const ordinal = this.#ordinal++
		return this.#guard(async () => {
			const claim = await this.journal.claim(ordinal, 'outcome', await journalDigest(material))
			if (claim.state === 'complete') {
				if (claim.value.kind !== 'outcome')
					throw new TurnRecoveryRequired('Unexpected outcome checkpoint.')
				return claim.value.result
			}
			if (claim.state === 'uncertain')
				throw new TurnRecoveryRequired('Outcome checkpoint is not recoverable.')
			const timing = await this.journal.timing()
			if (
				!Number.isFinite(timing.startedAt) ||
				(timing.durationMs !== undefined &&
					(!Number.isFinite(timing.durationMs) || timing.durationMs < 0))
			)
				throw new TurnRecoveryRequired('Invalid turn journal timing.')
			const { startedAt: _startedAt, durationMs: _durationMs, ...reply } = value.reply
			const result: ChatOutcome = JSON.parse(
				JSON.stringify({
					...value,
					reply: { ...reply, ...timing }
				})
			)
			await this.journal.complete(ordinal, { kind: 'outcome', result })
			return result
		})
	}
}
