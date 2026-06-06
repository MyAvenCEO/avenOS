/**
 * Deterministic serial pipeline — inspired by the AvenOS actor topology
 * (see docs/actors/developers/01-actor-system-capabilities.md). Each stage is a
 * small, typed message handler; a runner threads one stage's output into the next
 * and logs every step. Stages stay pure given their input + injected ports, so the
 * whole flow is reproducible and unit-testable without any host runtime.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
	log(level: LogLevel, stage: string, message: string, data?: unknown): void
}

/** A no-op logger; default when none is injected. */
export const silentLogger: Logger = {
	log() {}
}

/** Logger that forwards to console — handy in dev / tests. */
export const consoleLogger: Logger = {
	log(level, stage, message, data) {
		const line = `[${stage}] ${message}`
		if (data === undefined) console[level === 'debug' ? 'log' : level](line)
		else console[level === 'debug' ? 'log' : level](line, data)
	}
}

export type StagePhase = 'start' | 'done' | 'error'

export interface StageEvent {
	stage: string
	phase: StagePhase
	durationMs?: number
	error?: string
}

export interface PipelineContext {
	/** Stable id for one pipeline run (derived from content — deterministic). */
	readonly runId: string
	readonly logger: Logger
	/** Lifecycle callback per stage — lets a host render live flow progress. */
	readonly onStageEvent?: (event: StageEvent) => void
	/** Cooperative yield awaited after each stage, so a host UI can repaint. */
	readonly yield?: () => Promise<void>
}

/** A single deterministic step: typed input → typed output. */
export interface Stage<I, O> {
	readonly name: string
	run(input: I, ctx: PipelineContext): Promise<O> | O
}

export function stage<I, O>(
	name: string,
	run: (input: I, ctx: PipelineContext) => Promise<O> | O
): Stage<I, O> {
	return { name, run }
}
