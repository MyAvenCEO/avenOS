import type { ViewDef, ViewNode } from '../../engine/types.js'

function partyCard(prefix: string): ViewNode {
	return {
		class: 'bs-card',
		children: [
			{ tag: 'h4', text: `$${prefix}.role` },
			{ class: 'big', text: `$${prefix}.name` },
			{
				$each: {
					items: `$${prefix}.lines`,
					template: { class: '$$cls', text: '$$text' },
				},
			},
		],
	}
}

/** Bank-statement vibe — structure only; all copy/data bound from initState output. */
export const bankStatementView: ViewDef = {
	content: {
		class: 'bs-ui-container',
		children: [
			{
				class: 'bs-banner',
				children: [
					{
						tag: 'header',
						class: 'bs-banner-header',
						children: [
							{
								class: 'bs-banner-hero',
								children: [
									{
										children: [
											{ class: 'bs-banner-title', text: '$heroTitle' },
											{ class: 'bs-banner-sub', text: '$heroSub' },
										],
									},
									{
										class: 'bs-banner-money',
										$each: {
											items: '$heroRight',
											template: {
												children: [
													{ tag: 'div', text: '$$money' },
													{ class: 'bs-banner-sub', text: '$$sub' },
												],
											},
										},
									},
								],
							},
						],
					},
					{
						class: 'bs-banner-subheader',
						children: [
							{
								class: 'bs-banner-fields bs-banner-fields--compact',
								$each: {
									items: '$fieldsLine2',
									template: {
										class: '$$cellClass',
										children: [
											{ class: 'bs-field-val', text: '$$val' },
											{ class: 'bs-field-label', text: '$$label' },
										],
									},
								},
							},
							{
								class: 'bs-banner-fields bs-banner-fields--compact',
								$each: {
									items: '$fieldsLine3',
									template: {
										class: '$$cellClass',
										children: [
											{ class: 'bs-field-val', text: '$$val' },
											{ class: 'bs-field-label', text: '$$label' },
										],
									},
								},
							},
						],
					},
				],
			},
			{
				class: 'bs-grid',
				children: [partyCard('holder'), partyCard('institution')],
			},
			{
				class: 'bs-items-wrap',
				children: [
					{
						tag: 'table',
						class: 'bs-items',
						attrs: { 'aria-label': 'Umsätze' },
						children: [
							{
								tag: 'thead',
								children: [
									{
										tag: 'tr',
										$each: {
											items: '$columns',
											template: { tag: 'th', class: '$$cls', text: '$$label' },
										},
									},
								],
							},
							{
								tag: 'tbody',
								$each: {
									items: '$rows',
									template: {
										tag: 'tr',
										children: [
											{ tag: 'td', text: '$$booking' },
											{ tag: 'td', text: '$$value' },
											{
												tag: 'td',
												children: [
													{ class: 'bs-desc-title', text: '$$descTitle' },
													{ class: 'bs-desc-body', text: '$$descBody' },
													{ class: 'bs-fx-hint', text: '$$fx' },
												],
											},
											{ tag: 'td', class: '$$amountClass', text: '$$amount' },
											{ tag: 'td', class: 'num', text: '$$balance' },
											{ tag: 'td', class: 'num', text: '$$rate' },
										],
									},
								},
							},
						],
					},
				],
			},
			{
				$each: {
					items: '$notes',
					template: {
						class: 'bs-card',
						children: [
							{ tag: 'h4', text: 'Hinweise' },
							{ class: 'bs-notes', text: '$$text' },
						],
					},
				},
			},
		],
	},
}
