import type { ViewDef } from '../../engine/types.js'

/** Files surface — brand-primitive card with a list of file rows. Presentational. */
export const filesView: ViewDef = {
	content: {
		class: 'brand-shell fl-shell',
		children: [
			{
				class: 'card fl-card',
				children: [
					{
						class: 'fl-head',
						children: [
							{
								children: [
									{ class: 'eyebrow', text: '$eyebrow' },
									{ tag: 'h1', class: 'fl-title', text: '$title' }
								]
							},
							{ class: 'fl-count', text: '$count' }
						]
					},
					{
						class: 'fl-list',
						children: [
							{ class: 'fl-empty', text: '$emptyMessage' },
							{
								$each: {
									items: '$files',
									template: {
										class: 'fl-row',
										children: [
											{ class: 'fl-icon', text: '$$icon' },
											{
												class: 'fl-body',
												children: [
													{ tag: 'span', class: 'fl-name', text: '$$name' },
													{ tag: 'span', class: 'fl-meta', text: '$$meta' }
												]
											},
											{ tag: 'span', class: 'fl-kind', text: '$$kind' }
										]
									}
								}
							}
						]
					}
				]
			}
		]
	}
}
