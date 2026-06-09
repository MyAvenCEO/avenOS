import type { ViewDef } from '../../engine/types.js'

/** Chat / conversation surface — role-based bubbles, brand primitives. Presentational. */
export const chatView: ViewDef = {
	content: {
		class: 'brand-shell ch-shell',
		children: [
			{
				children: [
					{ class: 'eyebrow', text: '$eyebrow' },
					{ tag: 'h1', class: 'ch-title', text: '$title' },
					{ class: 'ch-subtitle', text: '$subtitle' },
				],
			},
			{
				class: 'ch-thread',
				children: [
					{
						$each: {
							items: '$messages',
							template: {
								class: '$$rowClass',
								children: [
									{
										class: 'ch-meta',
										children: [
											{ tag: 'span', class: 'ch-author', text: '$$author' },
											{ tag: 'span', class: 'ch-time', text: '$$time' },
										],
									},
									{ class: '$$bubbleClass', text: '$$body' },
								],
							},
						},
					},
				],
			},
		],
	},
}
