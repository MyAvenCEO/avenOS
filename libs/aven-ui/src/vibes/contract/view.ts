import type { ViewDef } from '../../engine/types.js'

/** Contract vibe — structure only; all copy/data bound from initState output. */
export const contractView: ViewDef = {
	content: {
		class: 'cv-shell',
		children: [
			{
				class: 'cv-hero',
				children: [
					{ class: 'cv-hero-eyebrow', text: '$eyebrow' },
					{ tag: 'h1', class: 'cv-hero-title', text: '$title' },
					{
						class: 'cv-hero-meta',
						$each: {
							items: '$meta',
							template: {
								tag: 'span',
								children: [
									{ tag: 'strong', text: '$$label' },
									{ tag: 'span', text: '$$value' },
								],
							},
						},
					},
				],
			},
			{
				class: 'cv-parties',
				$each: {
					items: '$parties',
					template: {
						class: 'cv-party',
						attrs: { role: 'group' },
						children: [
							{ class: 'cv-party-role', text: '$$role' },
							{ class: 'cv-party-name', text: '$$name' },
							{
								$each: {
									items: '$$lines',
									template: { class: 'cv-party-line', text: '$$text' },
								},
							},
						],
					},
				},
			},
			{
				$each: {
					items: '$preamble',
					template: {
						class: 'cv-preamble',
						children: [
							{ tag: 'h3', text: 'Präambel' },
							{ class: 'cv-preamble-body', text: '$$text' },
						],
					},
				},
			},
			{
				$each: {
					items: '$defsSection',
					template: {
						class: 'cv-defs',
						children: [
							{ tag: 'h3', text: 'Begriffsbestimmungen' },
							{
								$each: {
									items: '$$rows',
									template: {
										class: 'cv-def-row',
										children: [
											{ class: 'cv-def-term', text: '$$term' },
											{ class: 'cv-def-body', text: '$$body' },
										],
									},
								},
							},
						],
					},
				},
			},
			{
				class: 'cv-clauses',
				children: [
					{
						$each: {
							items: '$clauses',
							template: {
								tag: 'article',
								class: 'cv-clause',
								children: [
									{
										class: 'cv-clause-head',
										children: [
											{ tag: 'span', class: 'cv-clause-num', text: '$$num' },
											{ tag: 'span', class: 'cv-clause-title', text: '$$title' },
										],
									},
									{ class: 'cv-clause-body', text: '$$body' },
									{
										$each: {
											items: '$$subclauses',
											template: {
												class: 'cv-subclause',
												children: [
													{ class: 'cv-subclause-label', text: '$$label' },
													{ class: 'cv-subclause-body', text: '$$body' },
												],
											},
										},
									},
								],
							},
						},
					},
					{
						$each: {
							items: '$clausesEmpty',
							template: { class: 'cv-footnote', text: '$$text' },
						},
					},
				],
			},
			{
				$each: {
					items: '$signSection',
					template: {
						class: 'cv-signatures',
						children: [
							{ tag: 'h3', text: 'Unterschriften / Kenntnisnahme' },
							{
								class: 'cv-sign-grid',
								$each: {
									items: '$$blocks',
									template: {
										class: 'cv-sign-block',
										children: [
											{ class: 'cv-sign-party', text: '$$party' },
											{ class: 'cv-sign-name', text: '$$name' },
											{ class: 'cv-sign-meta', text: '$$role' },
											{ class: 'cv-sign-meta', text: '$$meta' },
										],
									},
								},
							},
						],
					},
				},
			},
			{
				$each: {
					items: '$footnote',
					template: { class: 'cv-footnote', text: '$$text' },
				},
			},
		],
	},
}
