import type { ViewDef } from '../../engine/types.js'

export const todoView: ViewDef = {
	content: {
		class: 'td-ui-container',
		children: [
			{
				class: 'td-card',
				children: [
					{
						class: 'td-banner-grid',
						children: [
							{
								children: [
									{ class: 'td-eyebrow', text: '$labels.listEyebrow' },
									{ tag: 'h1', class: 'td-banner-title', text: '$title' },
								],
							},
							{
								class: 'td-banner-stat',
								children: [
									{ class: 'td-field-label', text: '$labels.openLabel' },
									{ class: 'td-banner-accent', text: '$openCount' },
								],
							},
						],
					},
				],
			},
			{
				class: 'td-card td-card--list',
				children: [
					{
						tag: 'ul',
						class: 'td-list',
						children: [
							{
								tag: 'li',
								class: 'empty',
								text: '$emptyMessage',
								attrs: { 'data-empty': 'true' },
							},
							{
								$each: {
									items: '$items',
									template: {
										tag: 'li',
										class: '$$rowClass',
										attrs: { 'data-id': '$$id' },
										children: [
											{
												tag: 'input',
												attrs: {
													type: 'checkbox',
													'aria-label': '$labels.toggleAria',
													checked: '$$done',
												},
												$on: {
													change: { send: 'TOGGLE_ITEM', payload: { id: '$$id' } },
												},
											},
											{ class: 'td-row-text', text: '$$text' },
											{
												tag: 'button',
												class: 'td-btn td-btn--icon delete',
												attrs: { type: 'button', 'aria-label': '$labels.deleteAria' },
												text: '×',
												$on: {
													click: { send: 'DELETE_ITEM', payload: { id: '$$id' } },
												},
											},
										],
									},
								},
							},
						],
					},
				],
			},
		],
	},
}
