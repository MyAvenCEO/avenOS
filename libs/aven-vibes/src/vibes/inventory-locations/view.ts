import type { ViewDef } from '../../engine/types.js'

// board 0112 — the locations "bins" grid: an ochre ▦ eyebrow + count, then a responsive grid of bin tiles
// (place name + item count). Mirrors the loc-* style namespace.
export const locationsView: ViewDef = {
	content: {
		class: 'loc-root',
		children: [
			{
				class: 'loc-eyebrow',
				children: [{ text: 'Lagerorte' }, { text: '$count', class: 'loc-meta' }]
			},
			{ text: '$emptyMsg', class: 'loc-empty' },
			{
				class: 'loc-grid',
				children: [
					{
						$each: {
							items: '$locations',
							template: {
								class: 'loc-card',
								children: [
									{ text: '$$name', class: 'loc-name' },
									{ text: '$$countLabel', class: 'loc-count' }
								]
							}
						}
					}
				]
			}
		]
	}
}
