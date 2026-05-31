import type { ViewDef } from '../../types.js'

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
				class: 'td-card',
				children: [
					{ tag: 'h4', text: '$labels.newSection' },
					{
						tag: 'form',
						class: 'td-add-form',
						$on: {
							submit: { send: 'ADD_ITEM', payload: { text: '$field:draft' } },
						},
						children: [
							{
								tag: 'input',
								class: 'td-input',
								attrs: {
									type: 'text',
									placeholder: '$labels.addPlaceholder',
									autocomplete: 'off',
									required: 'true',
									'data-aven-field': 'draft',
								},
							},
							{
								tag: 'button',
								class: 'td-btn td-btn--primary',
								attrs: { type: 'submit' },
								text: '$labels.addButton',
							},
						],
					},
				],
			},
			{
				class: 'td-card td-card--list',
				children: [
					{ tag: 'h4', text: '$labels.entriesSection' },
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
					{
						class: 'td-list-footer',
						children: [
							{
								tag: 'button',
								class: 'td-btn td-btn--ghost',
								attrs: { type: 'button' },
								text: '$labels.clearDone',
								$on: {
									click: { send: 'CLEAR_DONE', payload: {} },
								},
							},
						],
					},
				],
			},
		],
	},
}
