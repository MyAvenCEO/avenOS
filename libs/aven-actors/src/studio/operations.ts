/** Read-only Studio operations shared by transport admission and the agent Actor.
 * Authoring (including its preview variant) uses the write door deliberately.
 */
export const STUDIO_READ_OPERATIONS = [
	'run-status',
	'case-what-if',
	'state',
	'items',
	'catalog',
	'present',
	'inspect',
	'explore',
	'preview',
	'compare'
] as const

export function isStudioReadOperation(operation: string): boolean {
	return (STUDIO_READ_OPERATIONS as readonly string[]).includes(operation)
}
