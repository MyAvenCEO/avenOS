export interface ArtifactLineageInput {
	role: string
	ordinal: number
	artifactId: string
}

export interface BrowsedArtifact {
	artifactId: string
	localKey: string
	publicationOrdinal: number
	typeKey: string
	typeVersion: number
	artifactSha256: string
	producerRunId: string | null
	output: unknown
	inputs: ArtifactLineageInput[]
	publicationId: string
	scopeSequence: number
	publicationKind: string
	runId: string | null
	committedAt: string
}

export interface ArtifactTreeRow {
	artifact: BrowsedArtifact
	depth: number
	primaryParentId: string | null
	parentCount: number
	missingParentCount: number
	hasChildren: boolean
}

function chronology(left: BrowsedArtifact, right: BrowsedArtifact): number {
	return (
		left.scopeSequence - right.scopeSequence ||
		left.publicationOrdinal - right.publicationOrdinal ||
		left.artifactId.localeCompare(right.artifactId)
	)
}

function newestAvailableParent(
	artifact: BrowsedArtifact,
	artifactsById: ReadonlyMap<string, BrowsedArtifact>
): BrowsedArtifact | undefined {
	return artifact.inputs
		.map((input) => artifactsById.get(input.artifactId))
		.filter((parent): parent is BrowsedArtifact => Boolean(parent))
		.filter((parent) => parent.artifactId !== artifact.artifactId)
		.sort(chronology)
		.at(-1)
}

function searchableText(artifact: BrowsedArtifact): string {
	const output = artifact.output as { role?: unknown; ordinal?: unknown } | null
	return [
		artifact.typeKey,
		artifact.artifactId,
		artifact.localKey,
		artifact.publicationId,
		artifact.runId ?? '',
		artifact.producerRunId ?? '',
		typeof output?.role === 'string' ? output.role : '',
		...artifact.inputs.flatMap((input) => [input.role, input.artifactId])
	]
		.join('\n')
		.toLowerCase()
}

/**
 * Project the immutable lineage DAG into a deterministic tree-grid.
 *
 * A run may consume several artifacts, so there is not always one canonical tree
 * parent. The newest available input is the visual parent, while parentCount and
 * the retained input list keep every causal edge visible to the UI.
 */
export function artifactTreeRows(
	artifacts: readonly BrowsedArtifact[],
	collapsedIds: ReadonlySet<string> = new Set(),
	query = ''
): ArtifactTreeRow[] {
	const artifactsById = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]))
	const primaryParentById = new Map<string, string>()
	const childrenById = new Map<string, BrowsedArtifact[]>()

	for (const artifact of artifacts) {
		const parent = newestAvailableParent(artifact, artifactsById)
		if (!parent) continue
		primaryParentById.set(artifact.artifactId, parent.artifactId)
		const children = childrenById.get(parent.artifactId) ?? []
		children.push(artifact)
		childrenById.set(parent.artifactId, children)
	}
	for (const children of childrenById.values()) children.sort(chronology)

	const needle = query.trim().toLowerCase()
	const matchingIds = new Set<string>()
	if (needle) {
		for (const artifact of artifacts) {
			if (!searchableText(artifact).includes(needle)) continue
			let current: BrowsedArtifact | undefined = artifact
			const path = new Set<string>()
			while (current && !path.has(current.artifactId)) {
				path.add(current.artifactId)
				matchingIds.add(current.artifactId)
				current = artifactsById.get(primaryParentById.get(current.artifactId) ?? '')
			}
		}
	}

	const roots = artifacts
		.filter((artifact) => !primaryParentById.has(artifact.artifactId))
		.sort((left, right) => chronology(right, left))
	const rows: ArtifactTreeRow[] = []
	const visited = new Set<string>()
	const reachableFromRoot = new Set<string>()
	function markReachable(artifact: BrowsedArtifact): void {
		if (reachableFromRoot.has(artifact.artifactId)) return
		reachableFromRoot.add(artifact.artifactId)
		for (const child of childrenById.get(artifact.artifactId) ?? []) markReachable(child)
	}
	for (const root of roots) markReachable(root)

	function visit(artifact: BrowsedArtifact, depth: number): void {
		if (visited.has(artifact.artifactId)) return
		visited.add(artifact.artifactId)
		if (needle && !matchingIds.has(artifact.artifactId)) return
		const children = childrenById.get(artifact.artifactId) ?? []
		rows.push({
			artifact,
			depth,
			primaryParentId: primaryParentById.get(artifact.artifactId) ?? null,
			parentCount: artifact.inputs.length,
			missingParentCount: artifact.inputs.filter((input) => !artifactsById.has(input.artifactId))
				.length,
			hasChildren: children.length > 0
		})
		if (!needle && collapsedIds.has(artifact.artifactId)) return
		for (const child of children) visit(child, depth + 1)
	}

	for (const root of roots) visit(root, 0)
	// Fail visibly and deterministically if retained data ever contains a cycle.
	for (const artifact of [...artifacts].sort(chronology)) {
		if (!reachableFromRoot.has(artifact.artifactId)) visit(artifact, 0)
	}
	return rows
}

export function artifactBranchIds(artifacts: readonly BrowsedArtifact[]): Set<string> {
	const artifactsById = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]))
	const branches = new Set<string>()
	for (const artifact of artifacts) {
		const parent = newestAvailableParent(artifact, artifactsById)
		if (parent) branches.add(parent.artifactId)
	}
	return branches
}
