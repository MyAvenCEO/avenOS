import { type InputHost, InputInboxController, type PendingInput } from './input-inbox-controller'

export type { PendingInput } from './input-inbox-controller'

/** Reactive projection of the transport-neutral input state machine.
 * Snapshot data on entry: reactive UI objects must never enter controller state,
 * whose native persistence and async jobs require independently cloneable values. */
export class InputInbox {
	items = $state<PendingInput[]>([])
	activeId = $state('')
	readonly controller: InputInboxController
	constructor(host: InputHost) {
		this.controller = new InputInboxController(
			{
				...host,
				inspect: async (...args) => $state.snapshot(await host.inspect(...args))
			},
			() => {
				this.items = structuredClone(this.controller.items)
				this.activeId = this.controller.activeId
			}
		)
	}
	get active() {
		return this.items.find((i) => i.id === this.activeId) ?? this.items[0]
	}
	submit(...args: Parameters<InputInboxController['submit']>) {
		return this.controller.submit(...$state.snapshot(args))
	}
	choose(...args: Parameters<InputInboxController['choose']>) {
		return this.controller.choose(...$state.snapshot(args))
	}
	retry(...args: Parameters<InputInboxController['retry']>) {
		return this.controller.retry(...args)
	}
	discard(...args: Parameters<InputInboxController['discard']>) {
		return this.controller.discard(...args)
	}
	select(id: string) {
		this.controller.select(id)
	}
	addCandidates(...args: Parameters<InputInboxController['addCandidates']>) {
		this.controller.addCandidates(...$state.snapshot(args))
	}
	restore(...args: Parameters<InputInboxController['restore']>) {
		this.controller.restore(...$state.snapshot(args))
	}
	reset() {
		this.controller.reset()
	}
	setPersistence(...args: Parameters<InputInboxController['setPersistence']>) {
		this.controller.setPersistence(...args)
	}
	flush() {
		return this.controller.flush()
	}
	persist() {
		return this.controller.persist()
	}
	get recoveryGeneration() {
		return this.controller.recoveryGeneration
	}
	suspend() {
		return this.controller.suspend()
	}
	resume() {
		this.controller.resume()
	}
}
