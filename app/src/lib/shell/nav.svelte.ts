// board 0083 — tiny shared nav state so deep links (e.g. a flow input/output schema badge) can ask
// the shell to switch the top tab and the DB view to select a schema by name.
export const nav = $state<{ requestTab: string | null; dbSchema: string | null }>({
	requestTab: null,
	dbSchema: null
})

/** Open the DB tab and select the data-store schema with this name. */
export function openDbSchema(name: string): void {
	nav.dbSchema = name
	nav.requestTab = 'db'
}
