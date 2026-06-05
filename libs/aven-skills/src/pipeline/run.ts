import type { PipelineContext, Stage } from './types'

/**
 * Run a single stage with timing + logging. Keeping each call typed (rather than a
 * fully-variadic chain) preserves end-to-end type-safety while still giving uniform
 * per-stage observability — the composing code awaits these in series.
 */
export async function runStage<I, O>(
	ctx: PipelineContext,
	step: Stage<I, O>,
	input: I
): Promise<O> {
	ctx.logger.log('debug', step.name, 'start')
	const out = await step.run(input, ctx)
	ctx.logger.log('debug', step.name, 'done')
	return out
}
