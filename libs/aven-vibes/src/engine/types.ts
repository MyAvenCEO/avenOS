export type ViewNode = {
	tag?: string
	class?: string
	text?: string
	value?: string
	format?: 'md' | 'markdown'
	attrs?: Record<string, string>
	children?: ViewNode[]
	$each?: { items: string; template: ViewNode }
	$slot?: string
	$on?: Record<string, UiEventDef>
}

export type ViewDef = {
	content?: ViewNode
} & ViewNode

export type StyleDef = {
	/** board 0115 — REFERENCE another vibe_style row as the base layer (e.g. 'brand'): the server
	 *  composes base-under-own at serve time, so shared styling lives in ONE row instead of being
	 *  baked into every style. */
	extends?: string
	tokens?: Record<string, unknown>
	components?: Record<string, Record<string, unknown>>
	selectors?: Record<string, Record<string, unknown>>
}

export type SlotRegistry = Record<string, ViewDef | ViewNode>

export type UiEventDef = {
	send: string
	payload?: Record<string, unknown>
}

export type UiEvent = {
	send: string
	payload: Record<string, unknown>
}

export type UiBundle = {
	view: ViewDef
	style: StyleDef
	state: Record<string, unknown>
	slots?: SlotRegistry
}

export type InterfaceDef = {
	properties?: Record<string, Record<string, unknown>>
}

/** Fixture assets passed to sandbox-quickjs; state comes from QJS initState. */
export type UiFixtureShell = {
	view: ViewDef
	style: StyleDef
	source: Record<string, unknown>
	interface: InterfaceDef
	logic: string
}

export type RenderData = {
	state: Record<string, unknown>
	item?: unknown
	index?: number
}

export type AvenUiEngineOptions = {
	container: HTMLElement
	containerName?: string
	onEvent?: (event: UiEvent) => void
}
