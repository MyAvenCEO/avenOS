import {
	ACTOR_RUN_PROTOCOL,
	assertPortableRunValue,
	type PlanRunStartCommand
} from '@avenos/actors/run'
import { z } from 'zod'

const qualifiedResource = z
	.string()
	.regex(/^[a-z][a-z0-9.-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9.-]*:[a-z][a-z0-9-]*@[1-9][0-9]*$/)
const predicate = z
	.string()
	.min(3)
	.max(2_048)
	.regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+\(.+\)$/)

const planRunStartCommandSchema = z
	.object({
		protocol: z.literal(ACTOR_RUN_PROTOCOL),
		requestId: z.string().min(1).max(255),
		idempotencyKey: z.string().min(1).max(512),
		requestedAt: z.iso.datetime({ offset: true }),
		skillRef: qualifiedResource,
		executionEnvironment: z.literal('server'),
		ingredients: z
			.array(
				z
					.object({
						predicate,
						artifactId: z.uuid().optional()
					})
					.strict()
			)
			.max(256),
		goals: z.array(predicate).min(1).max(64),
		parameters: z.record(z.string(), z.unknown())
	})
	.strict()

/** Parse the external command. `.strict()` makes asserted `security` fail closed. */
export function parsePlanRunStartCommand(value: unknown): PlanRunStartCommand {
	const command = planRunStartCommandSchema.parse(value) as PlanRunStartCommand
	assertPortableRunValue(command)
	return command
}
