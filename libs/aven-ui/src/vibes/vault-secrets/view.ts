import type { ViewDef } from '../../engine/types.js'

export const vaultSecretsView: ViewDef = {
	content: {
		class: 'vs-ui-container',
		children: [
			{
				class: 'vs-header',
				children: [
					{ tag: 'h1', class: 'vs-title', text: '$title' },
					{ class: 'vs-description', text: '$description' },
				],
			},
			{ class: '$errorClass', text: '$errorMessage' },
			{
				class: 'vs-add-card',
				children: [
					{ tag: 'h2', class: 'vs-section-title', text: '$labels.addTitle' },
					{
						tag: 'form',
						class: 'vs-add-form',
						$on: {
							submit: {
								send: 'ADD_SECRET',
								payload: { id: '$field:newId', value: '$field:newValue' },
							},
						},
						children: [
							{
								class: 'vs-field',
								children: [
									{ tag: 'span', class: 'vs-field-label', text: '$labels.idLabel' },
									{
										tag: 'input',
										class: 'vs-input',
										attrs: {
											type: 'text',
											autocomplete: 'off',
											required: 'true',
											'data-aven-field': 'newId',
										},
									},
								],
							},
							{
								class: 'vs-field',
								children: [
									{ tag: 'span', class: 'vs-field-label', text: '$labels.valueLabel' },
									{
										tag: 'input',
										class: 'vs-input',
										attrs: {
											type: 'password',
											autocomplete: 'off',
											required: 'true',
											'data-aven-field': 'newValue',
										},
									},
								],
							},
							{
								tag: 'button',
								class: 'vs-btn vs-btn--primary',
								attrs: { type: 'submit', disabled: '$busy' },
								text: '$labels.addButton',
							},
						],
					},
				],
			},
			{
				class: 'vs-list-card',
				children: [
					{ tag: 'h2', class: 'vs-section-title', text: '$labels.listTitle' },
					{ class: '$loadingClass', text: '$loadingMessage' },
					{
						tag: 'p',
						class: 'vs-empty',
						text: '$emptyMessage',
						attrs: { 'data-empty': 'true' },
					},
					{
						tag: 'ul',
						class: 'vs-list',
						children: [
							{
								$each: {
									items: '$items',
									template: {
										tag: 'li',
										class: '$$rowClass',
										children: [
											{
												class: 'vs-row-main',
												children: [
													{ class: 'vs-row-id', text: '$$displayId' },
													{ class: '$$revealedClass', text: '$$revealedText' },
												],
											},
											{
												class: 'vs-row-actions',
												children: [
													{
														tag: 'button',
														class: 'vs-btn vs-btn--link',
														attrs: { type: 'button' },
														text: '$$revealLabel',
														$on: {
															click: { send: 'TOGGLE_REVEAL', payload: { id: '$$id' } },
														},
													},
													{
														tag: 'button',
														class: 'vs-btn vs-btn--danger',
														attrs: { type: 'button' },
														text: '$labels.delete',
														$on: {
															click: { send: 'DELETE_SECRET', payload: { id: '$$id' } },
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
		],
	},
}
