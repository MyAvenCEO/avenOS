import {
	composeCatalogOperation,
	type StudioCatalogEntry,
	type StudioCatalogPage,
	type StudioCompositionResult
} from '@avenos/actors'

type CatalogRequest = <Value>(operation: string, data: Record<string, unknown>) => Promise<Value>

/** Agent and visual composer share one fresh, authorized catalog lookup and wiring rule. */
export async function composeAuthorizedStudioOperation(
	definition: unknown,
	capabilityId: string,
	request: CatalogRequest
): Promise<StudioCompositionResult> {
	if (
		!/^[a-z0-9][a-z0-9._-]*:capability:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(
			capabilityId
		)
	)
		throw new Error('STUDIO_CAPABILITY_ID_INVALID')
	let page = await request<StudioCatalogPage>('catalog', {
		search: capabilityId,
		readyOnly: false,
		limit: 100
	})
	const entries: StudioCatalogEntry[] = [...page.entries]
	while (page.nextCursor) {
		if (entries.length >= 1000) throw new Error('CATALOG_TOO_LARGE')
		page = await request<StudioCatalogPage>('catalog', {
			search: capabilityId,
			readyOnly: false,
			limit: 100,
			cursor: page.nextCursor,
			viewToken: page.viewToken
		})
		entries.push(...page.entries)
	}
	const exact = entries.find((entry) => entry.capabilityId === capabilityId)
	if (!exact) throw new Error('STUDIO_OPERATION_NOT_VISIBLE')
	return composeCatalogOperation(definition, exact)
}
