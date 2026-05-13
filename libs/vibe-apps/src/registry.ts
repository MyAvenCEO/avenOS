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
	title: 'Arbeitsaufträge',
	items: [
		{ id: '1', text: 'Vibe-App-Sandbox ausliefern', done: true },
		{ id: '2', text: 'Jazz-gestützte Artefakte anbinden', done: false },
		{ id: '3', text: 'CSP für Produktion schärfen', done: false }
	]
} as const

/** Re-export demo payloads matching OCR headless schemas (`invoice`, `bank_statement`). */
export { bankStatementDemoToolArguments, invoiceDemoToolArguments }

export const vibeAppList: VibeAppDefinition[] = [
	{
		id: 'invoice',
		label: 'Rechnung',
		description: 'Rechnungsansicht (Legacy-Layout) mit schema-geprägter Demo.',
		getToolArguments: () =>
			JSON.parse(JSON.stringify(invoiceDemoToolArguments)) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo-Rechnungstool beendet.' }]
			})
	},
	{
		id: 'bank-statement',
		label: 'Kontoauszug',
		description: 'Kontoauszug-Ansicht, angeglichen an das OCR-Schema bank_statement.',
		getToolArguments: () =>
			JSON.parse(JSON.stringify(bankStatementDemoToolArguments)) as Record<string, unknown>,
		getToolResult: () =>
			Promise.resolve({
				content: [{ type: 'text', text: 'Demo-Kontoauszug beendet.' }]
			})
	},
	{
		id: 'todos',
		label: 'Aufgaben',
		description: 'Kleine Aufgabenliste mit Host- und Sandbox-Sync.',
		getToolArguments: () => ({ ...todosDemoToolArguments }),
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
