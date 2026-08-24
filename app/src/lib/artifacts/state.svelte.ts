import { singleton } from '$lib/actors/singleton'

/**
 * The artifacts shelf's cross-surface selection: billing deep-links a fresh
 * invoice here (switch the shell tab, preselect the file), the shelf reads
 * and writes it as its selected tile. Null = nothing selected.
 */
class ArtifactsState {
	selected = $state<string | null>(null)
}

export const artifactsState = singleton('aven.artifacts', () => new ArtifactsState())
