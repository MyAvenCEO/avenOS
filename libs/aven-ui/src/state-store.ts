export class StateStore {
	private value: Record<string, unknown>
	private listeners = new Set<(v: Record<string, unknown>) => void>()

	constructor(initial: Record<string, unknown> = {}) {
		this.value = { ...initial }
	}

	get(): Record<string, unknown> {
		return this.value
	}

	set(next: Record<string, unknown>): void {
		this.value = { ...next }
		this.notify()
	}

	patch(partial: Record<string, unknown>): void {
		this.value = { ...this.value, ...partial }
		this.notify()
	}

	subscribe(fn: (v: Record<string, unknown>) => void): () => void {
		this.listeners.add(fn)
		return () => this.listeners.delete(fn)
	}

	private notify(): void {
		for (const fn of this.listeners) fn(this.value)
	}
}
