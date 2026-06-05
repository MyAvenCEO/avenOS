import type { PipelineContext, Stage } from './types'

/**
 * Run a single stage with timing, lifecycle events, and logging. Keeping each call
 * typed (rather than a fully-variadic chain) preserves end-to-end type-safety while
 * still giving uniform per-stage observability — the composing code awaits these in
 * series. After each stage we optionally await `ctx.yield()` so a host UI can repaint
 * between stages on large inputs.
 */
export async function runStage<I, O>(
	ctx: PipelineContext,
	step: Stage<I, O>,
	input: I
): Promise<O> {
	ctx.onStageEvent?.({ stage: step.name, phase: 'start' })
	ctx.logger.log('debug', step.name, 'start')
	const started = Date.now()
	try {
		const out = await step.run(input, ctx)
		const durationMs = Date.now() - started
		ctx.logger.log('debug', step.name, 'done')
		ctx.onStageEvent?.({ stage: step.name, phase: 'done', durationMs })
		if (ctx.yield) await ctx.yield()
		return out
	} catch (e) {
		const durationMs = Date.now() - started
		const error = e instanceof Error ? e.message : String(e)
		ctx.onStageEvent?.({ stage: step.name, phase: 'error', durationMs, error })
		throw e
	}
}
