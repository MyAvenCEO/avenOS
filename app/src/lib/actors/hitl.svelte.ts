import { bus, type HeldMessage } from './bus'
import { singleton } from './singleton'

/**
 * The one HITL queue (universal): every held message — a destructive tool
 * call, a drafted bridge — surfaces in the SAME bar above the voice pill,
 * and resolves ONLY by a physical button press. Voice cannot confirm:
 * confirming is not a tool, it is these two functions, wired to buttons.
 */
class HitlQueue {
	items = $state<HeldMessage[]>([])
}

export const hitlQueue = singleton('aven.hitl', () => new HitlQueue())

bus.onHold = (held) => {
	hitlQueue.items.push(held)
}
bus.onHeldResolved = (id) => {
	hitlQueue.items = hitlQueue.items.filter((h) => h.id !== id)
}

export function confirmHeld(id: string): void {
	void bus.confirmHeld(id)
}

export function rejectHeld(id: string): void {
	bus.rejectHeld(id)
}
