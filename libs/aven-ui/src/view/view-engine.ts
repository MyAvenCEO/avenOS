import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { RenderData, SlotRegistry, UiEvent, UiEventDef, ViewDef, ViewNode } from '../types.js'
import { Evaluator, validateViewDef } from '../view-validator.js'
import {
	BOOLEAN_ATTRS,
	SAFE_TAGS,
	URL_ATTRS,
	sanitizeAttributeWhitelist,
	sanitizePayloadForValidation,
} from '../security.js'
import { toKebabCase } from '../utils.js'
import { StyleEngine } from '../style/style-engine.js'

async function renderMarkdown(rawText: unknown): Promise<string> {
	if (rawText == null || typeof rawText !== 'string') return ''
	const html = await marked.parse(rawText)
	return DOMPurify.sanitize(String(html))
}

function setAttr(element: HTMLElement, name: string, value: unknown): void {
	if (value === undefined || value === null) return
	const lower = name.toLowerCase()
	if (URL_ATTRS.has(lower)) {
		const urlStr = String(value)
		if (/^(https?:|blob:|data:image\/|mailto:|tel:|\/|#)/.test(urlStr) || !urlStr.includes(':')) {
			element.setAttribute(name, sanitizeAttributeWhitelist(urlStr))
		}
		return
	}
	if (BOOLEAN_ATTRS.has(lower)) {
		const bool = Boolean(value)
		;(element as unknown as Record<string, boolean>)[name] = bool
		if (bool) element.setAttribute(name, '')
		else element.removeAttribute(name)
		return
	}
	const s = typeof value === 'boolean' ? String(value) : sanitizeAttributeWhitelist(value)
	element.setAttribute(name, s)
}

export type ViewEngineOptions = {
	onEvent?: (event: UiEvent) => void
	slots?: SlotRegistry
	containerName?: string
}

export class ViewEngine {
	private readonly evaluator = new Evaluator()
	private readonly styleEngine = new StyleEngine()
	private onEvent?: (event: UiEvent) => void
	private slots: SlotRegistry = {}
	private containerName = 'aven-ui'

	configure(options: ViewEngineOptions): void {
		this.onEvent = options.onEvent
		this.slots = options.slots ?? {}
		this.containerName = options.containerName ?? 'aven-ui'
	}

	async mount(
		container: HTMLElement,
		viewDef: ViewDef,
		state: Record<string, unknown>,
		style: import('../types.js').StyleDef,
	): Promise<ShadowRoot> {
		validateViewDef(viewDef)
		const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: 'open' })
		const styleSheets = await this.styleEngine.getStyleSheets(style, this.containerName)
		await this.render(viewDef, state, shadowRoot, styleSheets)
		return shadowRoot
	}

	async render(
		viewDef: ViewDef,
		state: Record<string, unknown>,
		shadowRoot: ShadowRoot,
		styleSheets: CSSStyleSheet[],
	): Promise<void> {
		shadowRoot.adoptedStyleSheets = styleSheets
		shadowRoot.innerHTML = ''
		const viewNode = viewDef.content ?? viewDef
		const data: RenderData = { state }
		const element = await this.renderNode(viewNode, data)
		if (element) shadowRoot.appendChild(element)
	}

	private async renderNode(node: ViewNode, data: RenderData): Promise<HTMLElement | null> {
		if (!node) return null

		const rawTag = (node.tag || 'div').toLowerCase()
		const tag = SAFE_TAGS.has(rawTag) ? rawTag : 'div'
		const element = document.createElement(tag)

		if (node.class) {
			const classValue = await this.evaluator.evaluate(node.class, data)
			if (classValue) element.className = sanitizeAttributeWhitelist(classValue)
		}

		if (node.attrs) {
			for (const [attrName, attrValue] of Object.entries(node.attrs)) {
				const resolved = await this.evaluator.evaluate(attrValue, data)
				setAttr(element, attrName, resolved)
			}
		}

		if (node.value !== undefined) {
			const resolvedValue = await this.evaluator.evaluate(node.value, data)
			if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
				element.value = String(resolvedValue ?? '')
			}
		}

		if (node.text !== undefined) {
			const textValue = await this.evaluator.evaluate(node.text, data)
			const formatMd = node.format === 'md' || node.format === 'markdown'
			if (formatMd && (typeof textValue === 'string' || textValue == null)) {
				element.innerHTML = await renderMarkdown(String(textValue || ''))
			} else {
				element.textContent = String(textValue ?? '')
			}
		}

		if (node.$each) {
			element.innerHTML = ''
			const fragment = await this.renderEach(node.$each, data)
			element.appendChild(fragment)
		} else if (node.$slot) {
			await this.renderSlot(node, data, element)
		} else if (node.children && !node.$each) {
			for (const child of node.children) {
				const childEl = await this.renderNode(child, data)
				if (childEl) element.appendChild(childEl)
			}
		}

		if (node.$on) {
			this.attachEvents(element, node.$on, data)
		}

		return element
	}

	private async renderEach(
		eachDef: { items: string; template: ViewNode },
		data: RenderData,
	): Promise<DocumentFragment> {
		const fragment = document.createDocumentFragment()
		const items = await this.evaluator.evaluate(eachDef.items, data)
		if (!items || !Array.isArray(items) || items.length === 0) return fragment

		for (let i = 0; i < items.length; i++) {
			const item = items[i]
			const itemData: RenderData = { state: data.state, item, index: i }
			const itemElement = await this.renderNode(eachDef.template, itemData)
			if (itemElement) fragment.appendChild(itemElement)
		}
		return fragment
	}

	private async renderSlot(node: ViewNode, data: RenderData, wrapper: HTMLElement): Promise<void> {
		const slotKey = node.$slot
		if (!slotKey?.startsWith('$')) return
		const registryKey = slotKey.slice(1)
		const slotView = this.slots[registryKey] ?? this.slots[slotKey]
		if (!slotView) return
		const slotNode = (slotView as ViewDef).content ?? slotView
		const child = await this.renderNode(slotNode as ViewNode, data)
		if (child) wrapper.appendChild(child)
	}

	private attachEvents(element: HTMLElement, events: Record<string, UiEventDef>, data: RenderData): void {
		for (const [eventName, eventDef] of Object.entries(events)) {
			element.addEventListener(eventName, () => {
				void this.deliverEvent(eventDef, data)
			})
		}
	}

	private async deliverEvent(eventDef: UiEventDef, data: RenderData): Promise<void> {
		const payload = eventDef.payload
			? await this.resolvePayload(eventDef.payload, data)
			: {}
		const sanitized = sanitizePayloadForValidation(payload)
		this.onEvent?.({ send: eventDef.send, payload: sanitized })
	}

	private async resolvePayload(
		payload: Record<string, unknown>,
		data: RenderData,
	): Promise<Record<string, unknown>> {
		const result: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(payload)) {
			result[key] = await this.evaluator.evaluate(value, data)
		}
		return result
	}
}
