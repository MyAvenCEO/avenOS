import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { invoiceDemoToolArguments } from '../invoice/src/demo-invoice'

export type VibeAppId = 'todos' | 'invoice'

export interface VibeAppDefinition {
	id: VibeAppId
	label: string
	description: string
	getToolArguments(): Record<string, unknown>
	getToolResult(): Promise<CallToolResult>
}

/** Default payload for the todos mini-app (`toolArguments` / structured content shape). */
export const todosDemoToolArguments = {
	title: 'Workspace todos',
	items: [
		{ id: '1', text: 'Ship vibe-app sandbox', done: true },
		{ id: '2', text: 'Wire Jazz-backed artifacts', done: false },
		{ id: '3', text: 'Harden CSP for production', done: false }
	]
} as const

/** Re-export: demo invoice body matching OCR `extracted` for doctype `invoice`. */
export { invoiceDemoToolArguments }

export const vibeAppList: VibeAppDefinition[] = [
	{
		id: 'todos',
		label: 'Todos',
		description: 'Minimal task list with host ↔ sandbox sync.',
		getToolArguments: () => ({ ...todosDemoToolArguments }),
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo tool finished OK' }]
			})
	},
	{
		id: 'invoice',
		label: 'Invoice',
		description: 'Invoice viewer (legacy layout) with a schema-shaped demo document.',
		getToolArguments: () => JSON.parse(JSON.stringify(invoiceDemoToolArguments)) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo invoice tool finished OK' }]
			})
	}
]

export function vibeAppById(id: VibeAppId): VibeAppDefinition {
	const d = vibeAppList.find((v) => v.id === id)
	if (!d) throw new Error(`Unknown vibe app: ${id}`)
	return d
}
