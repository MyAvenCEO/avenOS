import type { ViewDef } from '../../engine/types.js'

// board 0112 — the inventory "stock ledger" view: an ochre eyebrow + count, then a bordered ledger where
// every row is `name … [location tag] [quantity badge]`. Mirrors the inv-* style namespace.
export const inventoryView: ViewDef = {
	content: {
		class: 'inv-root',
		children: [
			{
				class: 'inv-head',
				children: [
					{ class: 'inv-eyebrow', text: 'Inventar' },
					{ class: 'inv-meta', text: '$count' }
				]
			},
			{ text: '$emptyMsg', class: 'inv-empty' },
			{
				class: 'inv-list',
				children: [
					{
						$each: {
							items: '$items',
							template: {
								class: 'inv-row',
								children: [
									{ class: 'inv-name', text: '$$name' },
									{
										class: 'inv-right',
										children: [
											{ class: 'inv-loc', text: '$$location' },
											{ class: 'inv-qty', text: '$$qty' }
										]
									}
								]
							}
						}
					}
				]
			}
		]
	}
}
