import type { ActorHandler } from './types'

export class ActorRegistry {
	private readonly handlers = new Map<string, ActorHandler>()

	register(handler: ActorHandler): void {
		const existing = this.handlers.get(handler.kind)
		if (existing) {
			throw new Error(`Actor handler already registered for kind: ${handler.kind}`)
		}

		this.handlers.set(handler.kind, handler)
	}

	get(kind: string): ActorHandler | undefined {
		return this.handlers.get(kind)
	}
}