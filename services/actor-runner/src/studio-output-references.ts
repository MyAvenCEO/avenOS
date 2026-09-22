/** Reject malformed or orphaned provenance rather than silently discarding it. */
type OutputReference = { role: string; id: string } | { role: string; local: string }
export function outputReferences(value: unknown): Record<string, OutputReference[]> {
	if (value === undefined) return {}
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw Error('STUDIO_OUTPUT_REFERENCES_INVALID')
	const result: Record<string, OutputReference[]> = Object.create(null)
	for (const [key, entries] of Object.entries(value)) {
		if (!Array.isArray(entries) || entries.length > 2048)
			throw Error('STUDIO_OUTPUT_REFERENCES_INVALID')
		result[key] = entries.map((entry: unknown) => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry))
				throw Error('STUDIO_OUTPUT_REFERENCES_INVALID')
			const reference = entry as Record<string, unknown>
			if (
				Object.keys(reference).some((key) => !['role', 'id', 'local'].includes(key)) ||
				typeof reference.role !== 'string' ||
				!reference.role.length ||
				reference.role.length > 128 ||
				'id' in reference === 'local' in reference ||
				typeof (reference.id ?? reference.local) !== 'string' ||
				!(reference.id ?? (reference.local as string)) ||
				('local' in reference && String(reference.local).length > 128)
			)
				throw Error('STUDIO_OUTPUT_REFERENCES_INVALID')
			return 'id' in reference
				? { role: reference.role, id: reference.id as string }
				: { role: reference.role, local: reference.local as string }
		})
	}
	return result
}

export function assertReferenceMembers(
	references: Record<string, OutputReference[]>,
	members: Set<string>
) {
	if (Object.keys(references).some((key) => !members.has(key)))
		throw Error('STUDIO_OUTPUT_REFERENCES_UNKNOWN_MEMBER')
	for (const entries of Object.values(references))
		if (entries.some((entry) => 'local' in entry && !members.has(entry.local)))
			throw Error('STUDIO_OUTPUT_REFERENCES_UNKNOWN_MEMBER')
}
