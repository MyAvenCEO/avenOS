import type { ViewDef, ViewNode } from '../../engine/types.js'
import { invoiceView } from '../invoice/view.js'

/**
 * Re-prefix a binding expression so the invoice view (which binds to top-level
 * `$field`) reads from `$detail.field` instead. Item bindings (`$$field`) and
 * plain literals are left untouched.
 */
function prefixExpr(value: string): string {
	if (value.startsWith('$$')) return value
	if (value.startsWith('$')) return `$detail.${value.slice(1)}`
	return value
}

/** Deep-clone a view node, re-prefixing every state binding to `$detail.*`. */
function prefixNode(node: ViewNode): ViewNode {
	const out: ViewNode = {}
	if (node.tag !== undefined) out.tag = node.tag
	if (node.class !== undefined) out.class = prefixExpr(node.class)
	if (node.text !== undefined) out.text = prefixExpr(node.text)
	if (node.value !== undefined) out.value = prefixExpr(node.value)
	if (node.format !== undefined) out.format = node.format
	if (node.$slot !== undefined) out.$slot = node.$slot
	if (node.attrs) {
		const attrs: Record<string, string> = {}
		for (const [k, v] of Object.entries(node.attrs)) attrs[k] = prefixExpr(v)
		out.attrs = attrs
	}
	if (node.$each) {
		out.$each = { items: prefixExpr(node.$each.items), template: prefixNode(node.$each.template) }
	}
	if (node.children) out.children = node.children.map(prefixNode)
	return out
}

/** Invoice document, bound to the selected transfer's `$detail` payload. */
const invoiceDetailNode: ViewNode = prefixNode(invoiceView.content ?? (invoiceView as ViewNode))

/** Bank-transfers vibe — split view: payment list (left) + invoice detail (right). */
export const bankTransfersView: ViewDef = {
	content: {
		class: 'bt-ui-container',
		children: [
			{
				class: 'bt-split',
				children: [
					{
						class: 'bt-list-pane',
						children: [
							{
								class: 'bt-list-header',
								children: [
									{ class: 'bt-eyebrow', text: '$labels.listEyebrow' },
									{
										class: 'bt-list-head-row',
										children: [
											{ tag: 'h1', class: 'bt-list-title', text: '$title' },
											{
												class: 'bt-count',
												children: [
													{ tag: 'span', class: 'bt-count-value', text: '$count' },
													{ tag: 'span', class: 'bt-count-label', text: '$labels.countLabel' }
												]
											}
										]
									}
								]
							},
							{
								tag: 'ul',
								class: 'bt-list',
								attrs: { 'aria-label': '$labels.listEyebrow' },
								children: [
									{
										tag: 'li',
										class: 'bt-empty',
										text: '$emptyMessage',
										attrs: { 'data-empty': 'true' }
									},
									{
										$each: {
											items: '$transfers',
											template: {
												tag: 'li',
												children: [
													{
														tag: 'button',
														class: '$$rowClass',
														attrs: {
															type: 'button',
															'aria-current': '$$ariaCurrent',
															'data-id': '$$id'
														},
														$on: {
															click: { send: 'SELECT_TX', payload: { id: '$$id' } }
														},
														children: [
															{
																tag: 'span',
																class: '$$dotClass',
																attrs: { 'aria-hidden': 'true' }
															},
															{
																class: 'bt-row-body',
																children: [
																	{
																		class: 'bt-row-line bt-row-line--top',
																		children: [
																			{ tag: 'span', class: 'bt-row-payee', text: '$$payee' },
																			{ tag: 'span', class: '$$amountClass', text: '$$amount' }
																		]
																	},
																	{
																		class: 'bt-row-line bt-row-line--sub',
																		children: [
																			{ tag: 'span', class: 'bt-row-ref', text: '$$reference' },
																			{ tag: 'span', class: 'bt-row-date', text: '$$date' }
																		]
																	},
																	{ tag: 'span', class: 'bt-row-status', text: '$$statusLabel' }
																]
															}
														]
													}
												]
											}
										}
									}
								]
							}
						]
					},
					{
						class: 'bt-detail-pane',
						attrs: { 'data-has-selection': '$hasSelection' },
						children: [
							{
								class: 'bt-detail-empty',
								children: [
									{
										class: 'bt-detail-empty-inner',
										children: [
											{ class: 'bt-eyebrow', text: '$labels.detailEyebrow' },
											{ class: 'bt-detail-empty-text', text: '$detailEmptyMessage' }
										]
									}
								]
							},
							{
								class: 'bt-detail-doc',
								children: [invoiceDetailNode]
							}
						]
					}
				]
			}
		]
	}
}
