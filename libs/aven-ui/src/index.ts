import type { AvenUiEngineOptions, UiBundle, UiEvent } from './types.js'
import { StateStore } from './state-store.js'
import { ViewEngine } from './view/view-engine.js'

export class AvenUiEngine {
	private readonly container: HTMLElement
	private readonly onEvent?: (event: UiEvent) => void
	private readonly containerName: string
	private readonly viewEngine = new ViewEngine()
	private readonly stateStore = new StateStore()
	private shadowRoot: ShadowRoot | null = null
	private bundle: UiBundle | null = null
	private unsubState: (() => void) | null = null

	constructor(options: AvenUiEngineOptions) {
		this.container = options.container
		this.onEvent = options.onEvent
		this.containerName = options.containerName ?? 'aven-ui'
	}

	async mount(bundle: UiBundle): Promise<void> {
		await this.unmount()
		this.bundle = bundle
		this.stateStore.set(bundle.state)
		this.viewEngine.configure({
			onEvent: this.onEvent,
			slots: bundle.slots,
			containerName: this.containerName,
		})
		this.shadowRoot = await this.viewEngine.mount(
			this.container,
			bundle.view,
			bundle.state,
			bundle.style,
		)
		this.unsubState = this.stateStore.subscribe((state) => {
			void this.rerender(state)
		})
	}

	async replaceState(state: Record<string, unknown>): Promise<void> {
		this.stateStore.set(state)
	}

	async updateState(partial: Record<string, unknown>): Promise<void> {
		this.stateStore.patch(partial)
	}

	getState(): Record<string, unknown> {
		return this.stateStore.get()
	}

	getBundle(): UiBundle | null {
		return this.bundle
	}

	async unmount(): Promise<void> {
		this.unsubState?.()
		this.unsubState = null
		if (this.shadowRoot) {
			this.shadowRoot.innerHTML = ''
		}
		this.shadowRoot = null
		this.bundle = null
	}

	private async rerender(state: Record<string, unknown>): Promise<void> {
		if (!this.bundle || !this.shadowRoot) return
		await this.viewEngine.render(this.bundle.view, state, this.shadowRoot, this.shadowRoot.adoptedStyleSheets)
	}
}

export { AvenUiEngine as default }
export type { UiBundle, UiEvent, ViewDef, StyleDef, ViewNode, SlotRegistry, UiFixtureShell, InterfaceDef } from './types.js'
export { validateViewDef } from './view-validator.js'
export { validateStyleDef } from './style-validator.js'
export { StateStore } from './state-store.js'
