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
