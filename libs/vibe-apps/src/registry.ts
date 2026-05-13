import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { bankStatementDemoToolArguments } from '../bank-statement/src/demo-bank-statement'
import { invoiceDemoToolArguments } from '../invoice/src/demo-invoice'

export type VibeAppId = 'todos' | 'invoice' | 'bank-statement'

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

/** Re-export demo payloads matching OCR headless schemas (`invoice`, `bank_statement`). */
export { bankStatementDemoToolArguments, invoiceDemoToolArguments }

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
		getToolArguments: () =>
			JSON.parse(JSON.stringify(invoiceDemoToolArguments)) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo invoice tool finished OK' }]
			})
	},
	{
		id: 'bank-statement',
		label: 'Bank statement',
		description: 'Kontoauszug-style viewer aligned with OCR bank_statement schema.',
		getToolArguments: () =>
			JSON.parse(JSON.stringify(bankStatementDemoToolArguments)) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo bank statement tool finished OK' }]
			})
	}
]

export function vibeAppById(id: VibeAppId): VibeAppDefinition {
	const d = vibeAppList.find((v) => v.id === id)
	if (!d) throw new Error(`Unknown vibe app: ${id}`)
	return d
}
