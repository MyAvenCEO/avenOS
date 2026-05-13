/**
 * Catalog of vibe apps. Each entry points to a single self-contained
 * `index.html` (pure HTML/CSS/JS, no per-app build step) plus a
 * co-located `demo.json` payload for the host's demo `tools/call`
 * round-trip.
 */
import bankStatementDemo from '../bank-statement/demo.json'
import invoiceDemo from '../invoice/demo.json'
import todosDemo from '../todos/demo.json'

export type VibeAppId = 'todos' | 'invoice' | 'bank-statement'

/** Minimal subset of the MCP `CallToolResult` shape the host actually sends back. */
export interface VibeToolResult {
	content: { type: 'text'; text: string }[]
	isError?: boolean
	structuredContent?: Record<string, unknown>
}

export interface VibeAppDefinition {
	id: VibeAppId
	label: string
	description: string
	getToolArguments(): Record<string, unknown>
	getToolResult(): Promise<VibeToolResult>
}

function clone<T>(x: T): T {
	return JSON.parse(JSON.stringify(x)) as T
}

export const todosDemoToolArguments = todosDemo
export const invoiceDemoToolArguments = invoiceDemo
export const bankStatementDemoToolArguments = bankStatementDemo

export const vibeAppList: VibeAppDefinition[] = [
	{
		id: 'invoice',
		label: 'Rechnung',
		description: 'Rechnungsansicht (Legacy-Layout) mit schema-geprägter Demo.',
		getToolArguments: () => clone(invoiceDemo) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo-Rechnungstool beendet.' }]
			})
	},
	{
		id: 'bank-statement',
		label: 'Kontoauszug',
		description: 'Kontoauszug-Ansicht, angeglichen an das OCR-Schema bank_statement.',
		getToolArguments: () => clone(bankStatementDemo) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo-Kontoauszug beendet.' }]
			})
	},
	{
		id: 'todos',
		label: 'Aufgaben',
		description: 'Kleine Aufgabenliste mit Host- und Sandbox-Sync.',
		getToolArguments: () => clone(todosDemo) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo beendet.' }]
			})
	}
]

export function vibeAppById(id: VibeAppId): VibeAppDefinition {
	const d = vibeAppList.find((v) => v.id === id)
	if (!d) throw new Error(`Unknown vibe app: ${id}`)
	return d
}
