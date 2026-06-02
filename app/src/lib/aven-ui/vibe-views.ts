import type { UiFixtureShell } from '@avenos/aven-ui'
import { createBankStatementShell } from '@avenos/aven-ui/vibes/bank-statement'
import { createBankTransfersShell } from '@avenos/aven-ui/vibes/bank-transfers'
import { createContractShell } from '@avenos/aven-ui/vibes/contract'
import { createErrorShell } from '@avenos/aven-ui/vibes/error'
import { createInvoiceShell } from '@avenos/aven-ui/vibes/invoice'
import { createSuccessShell } from '@avenos/aven-ui/vibes/success'
import { createTodosShell } from '@avenos/aven-ui/vibes/todos'

/**
 * Single catalog of aven-ui views. Replaces both the old `@avenos/aven-vibes`
 * registry (HTML vibe apps) and `ui-lab-fixtures.ts`. Feeds the docs kitchen
 * sink (`UiLabPanel`), the intent HITL `DisplayView`, and the random HITL pool
 * on the home page.
 */
export type VibeViewId =
	| 'invoice'
	| 'bank-transfers'
	| 'bank-statement'
	| 'contract'
	| 'todos'
	| 'error'
	| 'success'

export interface VibeView {
	id: VibeViewId
	label: string
	description: string
	shell: UiFixtureShell
	containerName: string
	interactive: boolean
}

export const vibeViewList: VibeView[] = [
	{
		id: 'invoice',
		label: 'Rechnung',
		description: 'Rechnungsansicht mit Positionen, Summen und Zahlungsinformationen.',
		shell: createInvoiceShell(),
		containerName: 'aven-ui-invoice',
		interactive: false,
	},
	{
		id: 'bank-transfers',
		label: 'Überweisungen',
		description:
			'Geteilte Ansicht: links die Liste der Überweisungen/Zahlungen mit Status-Indikator, rechts die Rechnung zur ausgewählten Transaktion.',
		shell: createBankTransfersShell(),
		containerName: 'aven-ui-bank-transfers',
		interactive: true,
	},
	{
		id: 'bank-statement',
		label: 'Kontoauszug',
		description: 'Kontoauszug-Ansicht, angeglichen an das OCR-Schema bank_statement.',
		shell: createBankStatementShell(),
		containerName: 'aven-ui-bank-statement',
		interactive: false,
	},
	{
		id: 'contract',
		label: 'Vertrag',
		description: 'Mehrparteien-Vertrag mit Präambel, Begriffen, Klauseln und Signaturen.',
		shell: createContractShell(),
		containerName: 'aven-ui-contract',
		interactive: false,
	},
	{
		id: 'todos',
		label: 'Aufgaben',
		description: 'Kleine Aufgabenliste mit Host- und Sandbox-Sync.',
		shell: createTodosShell(),
		containerName: 'aven-ui-todos',
		interactive: true,
	},
	{
		id: 'error',
		label: 'Fehler-Ansicht',
		description: 'Diagnose-Panel für gestoppte Automatisierungen (HITL-Fehlerzustand).',
		shell: createErrorShell(),
		containerName: 'aven-ui-error',
		interactive: false,
	},
	{
		id: 'success',
		label: 'Erfolg-Ansicht',
		description: 'Abschluss-Panel für erfolgreich beendete Intents.',
		shell: createSuccessShell(),
		containerName: 'aven-ui-success',
		interactive: false,
	},
]

/** Views used as live HITL placeholders (excludes the error/success screens). */
export const HITL_VIEW_IDS: VibeViewId[] = [
	'invoice',
	'bank-transfers',
	'bank-statement',
	'contract',
	'todos',
]

export function vibeViewById(id: VibeViewId): VibeView {
	const view = vibeViewList.find((v) => v.id === id)
	if (!view) throw new Error(`Unknown vibe view: ${id}`)
	return view
}
