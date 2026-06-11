import type { ViewDef } from '../../engine/types.js'

/** Settings surface — sections of label/value rows, brand primitives. Presentational. */
export const settingsView: ViewDef = {
	content: {
		class: 'brand-shell set-shell',
		children: [
			{
				children: [
					{ class: 'eyebrow', text: '$eyebrow' },
					{ tag: 'h1', class: 'set-title', text: '$title' }
				]
			},
			{
				$each: {
					items: '$sections',
					template: {
						class: 'set-section',
						children: [
							{ class: 'eyebrow set-section-label', text: '$$label' },
							{
								class: 'card set-group',
								children: [
									{
										$each: {
											items: '$$items',
											template: {
												class: 'set-row',
												children: [
													{
														class: 'set-row-main',
														children: [
															{ tag: 'span', class: 'set-label', text: '$$label' },
															{ tag: 'span', class: 'set-hint', text: '$$hint' }
														]
													},
													{ tag: 'span', class: 'set-value', text: '$$value' }
												]
											}
										}
									}
								]
							}
						]
					}
				}
			}
		]
	}
}
