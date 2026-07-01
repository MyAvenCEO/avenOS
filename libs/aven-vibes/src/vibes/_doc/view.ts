import type { ViewDef } from '../../engine/types.js'

// The ONE structured-document view. Each section renders, in order, any of: party cards, a
// key/value list, and a table — each via its own $each, so an unused kind (empty array) renders
// nothing. No $if (the engine has none); visibility is "empty array ⇒ nothing". board 0064.
export const docView: ViewDef = {
	content: {
		class: 'doc-view',
		children: [
			{ tag: 'h2', class: 'doc-title', text: '$title' },
			{ class: 'doc-subtitle', text: '$subtitle' },
			{
				class: 'doc-sections',
				children: [
					{
						$each: {
							items: '$sections',
							template: {
								class: 'doc-section',
								children: [
									{ class: 'doc-section-title', text: '$$title' },
									// Party / address cards
									{
										class: 'doc-cards',
										$each: {
											items: '$$cards',
											template: {
												class: 'doc-card',
												children: [
													{ class: 'doc-card-title', text: '$$title' },
													{ class: 'doc-card-name', text: '$$name' },
													{
														class: 'doc-card-lines',
														$each: {
															items: '$$lines',
															template: { class: 'doc-card-line', text: '$$line' }
														}
													}
												]
											}
										}
									},
									// PANEL — the kv list + table wrapped as one card (board 0097). Empty panels
									// (e.g. the Parteien section, which only has cards) are hidden via CSS :has().
									{
										class: 'doc-panel',
										children: [
											// Key / value rows
											{
												class: 'doc-kv',
												$each: {
													items: '$$rows',
													template: {
														class: 'doc-kv-row',
														children: [
															{ class: 'doc-kv-k', text: '$$k' },
															{ class: 'doc-kv-v', text: '$$v' }
														]
													}
												}
											},
											// Table (header + body); empty columns/rows ⇒ nothing
											{
												tag: 'table',
												class: 'doc-table',
												children: [
													{
														tag: 'thead',
														class: 'doc-thead',
														children: [
															{
																tag: 'tr',
																class: 'doc-tr',
																$each: {
																	items: '$$columns',
																	template: { tag: 'th', class: '$$align', text: '$$label' }
																}
															}
														]
													},
													{
														tag: 'tbody',
														class: 'doc-tbody',
														$each: {
															items: '$$tableRows',
															template: {
																tag: 'tr',
																class: 'doc-tr',
																$each: {
																	items: '$$cells',
																	template: { tag: 'td', class: '$$align', text: '$$text' }
																}
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
					}
				]
			}
		]
	}
}
