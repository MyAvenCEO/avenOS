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
									{ tag: 'h1', class: 'td-banner-title', text: '$title' }
								]
							},
							{
								class: 'td-banner-stat',
								children: [
									{ class: 'td-field-label', text: '$labels.openLabel' },
									{ class: 'td-banner-accent', text: '$openCount' }
								]
							}
						]
					}
				]
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
								attrs: { 'data-empty': 'true' }
							},
							{
								$each: {
									items: '$items',
									template: {
										tag: 'li',
										class: '$$rowClass',
										attrs: { 'data-id': '$$id' },
										children: [
											// read-only status dot (done/open) — todos are managed via prompts only
											{ class: 'td-status' },
											{ class: 'td-row-text', text: '$$text' },
											// inline brand chips; empty ones hide via CSS :empty
											{ class: 'td-chip td-chip--due', text: '$$due' },
											{ class: 'td-chip td-chip--prio', text: '$$priority' }
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
