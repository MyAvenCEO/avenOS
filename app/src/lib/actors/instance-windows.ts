import type { Manifest } from './actor'

/**
 * What windows a spawned instance gets — PURE, so the svelte wiring stays a
 * thin subscriber and tests read the same truth (0133). One window for the
 * default view, one per named view; keys carry the instance name so window
 * ids and toggle tools stay unique per instance.
 */
export interface InstanceWindow {
	key: string
	name: string
	view: NonNullable<Manifest['view']>
	style?: Manifest['style']
}

export function instanceWindows(manifest: Manifest, instanceName: string): InstanceWindow[] {
	if (!manifest.view) return []
	const windows: InstanceWindow[] = [
		{ key: instanceName, name: instanceName, view: manifest.view, style: manifest.style }
	]
	for (const named of manifest.views ?? []) {
		windows.push({
			key: `${instanceName}-${named.key}`,
			name: `${instanceName} ${named.name}`,
			view: named.view,
			style: named.style ?? manifest.style
		})
	}
	return windows
}

/** The window ids a disposed instance takes with it. */
export function instanceWindowIds(manifest: Manifest, instanceName: string): string[] {
	return instanceWindows(manifest, instanceName).map((w) => `${w.key}-window`)
}
