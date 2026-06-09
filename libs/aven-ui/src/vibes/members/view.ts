import type { ViewDef } from '../../engine/types.js'

/**
 * Members / access surface — the first reference vibe built entirely from the
 * shared brand primitives (.brand-shell, .card, .eyebrow, .btn) plus a few
 * members-specific classes. Presentational; copy bound from initState output.
 */
export const membersView: ViewDef = {
	content: {
		class: 'brand-shell mb-shell',
		children: [
			// Invite / grant card
			{
				class: 'card mb-invite',
				children: [
					{ class: 'mb-did-field', text: '$didPlaceholder' },
					{ class: 'eyebrow mb-access-label', text: '$accessEyebrow' },
					{
						class: 'mb-segment',
						children: [
							{
								$each: {
									items: '$accessLevels',
									template: { tag: 'span', class: '$$pillClass', text: '$$label' },
								},
							},
						],
					},
					{ class: 'mb-hint', text: '$hint' },
					{ tag: 'button', class: 'btn mb-grant', attrs: { type: 'button' }, text: '$grantLabel' },
					{ class: 'mb-note', text: '$note' },
				],
			},

			// Who has access
			{ class: 'eyebrow mb-who-label', text: '$whoEyebrow' },
			{
				class: 'mb-entries',
				children: [
					{
						$each: {
							items: '$entries',
							template: {
								class: 'card mb-entry',
								children: [
									{
										class: 'mb-entry-head',
										children: [
											{ class: 'eyebrow mb-kind', text: '$$kind' },
											{ tag: 'span', class: 'mb-name', text: '$$name' },
										],
									},
									{ class: 'mb-did', text: '$$did' },
									{
										class: 'mb-chips',
										children: [
											{
												$each: {
													items: '$$perms',
													template: { tag: 'span', class: '$$chipClass', text: '$$label' },
												},
											},
										],
									},
								],
							},
						},
					},
				],
			},
		],
	},
}
