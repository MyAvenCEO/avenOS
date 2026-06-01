import type { UiFixtureShell } from '@avenos/aven-ui'
import { createInvoiceShell } from '@avenos/aven-ui/fixtures/invoice'
import { createTodoShell } from '@avenos/aven-ui/fixtures/todo'

export type UiLabFixtureId = 'todo' | 'invoice'

export type UiLabFixtureEntry = {
	id: UiLabFixtureId
	labelKey: 'uiLab.fixtureTodo' | 'uiLab.fixtureInvoice'
	descriptionKey: 'uiLab.fixtureTodoDesc' | 'uiLab.fixtureInvoiceDesc'
	shell: UiFixtureShell
	containerName: string
	interactive: boolean
}

const FIXTURES: UiLabFixtureEntry[] = [
	{
		id: 'todo',
		labelKey: 'uiLab.fixtureTodo',
		descriptionKey: 'uiLab.fixtureTodoDesc',
		shell: createTodoShell(),
		containerName: 'aven-ui-todo',
		interactive: true,
	},
	{
		id: 'invoice',
		labelKey: 'uiLab.fixtureInvoice',
		descriptionKey: 'uiLab.fixtureInvoiceDesc',
		shell: createInvoiceShell(),
		containerName: 'aven-ui-invoice',
		interactive: false,
	},
]

export function uiLabFixtures(): UiLabFixtureEntry[] {
	return FIXTURES
}

export function uiLabFixture(id: UiLabFixtureId): UiLabFixtureEntry {
	const entry = FIXTURES.find((f) => f.id === id)
	if (!entry) return FIXTURES[0]
	return entry
}
