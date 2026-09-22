import {
	type Actor,
	type ActorCallContext,
	type HandlerResult,
	isPureTransformation,
	type Manifest
} from '@avenos/actors'
import type { ToolResolution } from '@avenos/chat-engine/journal'
import type { ChatTurnSession } from './chat-executor.js'

type Invocation = ActorCallContext & { operationId: string }
export interface ChatActorBinding {
	manifest: Manifest
	create(context: Invocation): Actor
	receipt?(context: Invocation, name: string, args: string): Promise<HandlerResult | null>
}

/** Compose installed Actors, not tool-name switches or another execution loop.
 * Declared observations can be read again and pure transforms recomputed. Every mutation
 * needs its original operation receipt; idempotent does not mean blindly retryable.
 */
export function createChatActorTools(host: {
	actors: ChatActorBinding[]
	context(operationId: string): Invocation
	assertActive(): Promise<void>
}): Pick<ChatTurnSession, 'specs' | 'execute' | 'resolve'> {
	const entries = new Map<
		string,
		{ binding: ChatActorBinding; replay?: 'read-again' | 'recomputed' }
	>()
	for (const binding of host.actors)
		for (const method of binding.manifest.methods) {
			if (entries.has(method.name)) throw Error('Installed chat tool names must be unique.')
			entries.set(method.name, {
				binding,
				replay:
					method.mode === 'observe'
						? 'read-again'
						: isPureTransformation(method)
							? 'recomputed'
							: undefined
			})
		}
	const context = async (operationId: string) => {
		const value = host.context(operationId)
		value.signal?.throwIfAborted()
		await host.assertActive()
		value.signal?.throwIfAborted()
		return value
	}
	const execute = async (name: string, args: string, operationId: string) => {
		const entry = entries.get(name)
		if (!entry) throw Error('This chat tool is not installed.')
		const invocation = await context(operationId)
		const actor = entry.binding.create(invocation)
		try {
			return await actor.deliver(name, JSON.parse(args), invocation)
		} finally {
			actor.dispose()
		}
	}
	return {
		specs: host.actors.flatMap((binding) =>
			binding.manifest.methods.map(({ name, description, parameters }) => ({
				name,
				description,
				parameters
			}))
		),
		execute,
		async resolve(operationId, name, args): Promise<ToolResolution | null> {
			const entry = entries.get(name)
			if (!entry) return null
			if (entry.replay)
				return { result: await execute(name, args, operationId), basis: entry.replay }
			const result = await entry.binding.receipt?.(await context(operationId), name, args)
			return result ? { result, basis: 'receipt-check' } : null
		}
	}
}
