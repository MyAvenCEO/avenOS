/**
 * Hardcoded "sparks" sub-grid for an aven (no peer-sync / ACL wiring yet).
 *
 * Conceptually each aven exposes the sparks it has access to (admin / owner /
 * any AC). For now we hardcode a single "H&H" spark; the existing aven views
 * (orders, banking, …) are scoped underneath it.
 */

export type AvenSparkMeta = {
	/** URL-safe segment used in the route. */
	id: string
	/** Display name, e.g. "H&H". */
	name: string
	/** Eyebrow label shown on the grid card. */
	kind: string
	subtitle: string
}

/** Sparks each aven has access to. Hardcoded for now. */
const SPARKS_BY_AVEN: Record<string, AvenSparkMeta[]> = {
	avenvictorio: [
		{
			id: 'hh',
			name: 'H&H',
			kind: 'Restaurant',
			subtitle: 'Dine-in & to-go · POS journal',
		},
	],
}

export function sparksForAven(avenId: string): AvenSparkMeta[] {
	return SPARKS_BY_AVEN[avenId.trim().toLowerCase()] ?? []
}

export function avenSparkById(avenId: string, sparkId: string): AvenSparkMeta | undefined {
	const norm = sparkId.trim().toLowerCase()
	return sparksForAven(avenId).find((s) => s.id.toLowerCase() === norm)
}
