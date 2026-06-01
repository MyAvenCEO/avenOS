import type { ViewDef, ViewNode } from '../../engine/types.js'

function partyCard(prefix: string): ViewNode {
	return {
		class: 'invoice-card',
		children: [
			{ tag: 'h4', text: `$${prefix}.role` },
			{
				class: 'big inv-party-name-line',
				children: [{ tag: 'span', class: 'inv-party-name-text', text: `$${prefix}.name` }],
			},
			{
				class: 'party-representative-line',
				attrs: { role: 'group', 'aria-label': '$labels.contactPerson' },
				children: [
					{ class: 'party-representative-sublabel muted', text: '$labels.contactPerson' },
					{ class: 'inv-party-rep-name', text: `$${prefix}.contact` },
				],
			},
			{
				class: 'inv-party-address-block',
				$each: {
					items: `$${prefix}.addressLines`,
					template: { class: 'line inv-party-addr-line', text: '$$line' },
				},
			},
			{ class: 'muted', text: `$${prefix}.email` },
			{ class: 'muted', text: `$${prefix}.phone` },
			{
				$each: {
					items: `$${prefix}.identifiers`,
					template: {
						class: 'party-org-id-line',
						children: [
							{ tag: 'span', class: 'party-org-id-label', text: '$$label' },
							{ tag: 'span', class: 'party-org-id-value', text: '$$value' },
						],
					},
				},
			},
		],
	}
}

/** Invoice vibe UI — structure only; all copy bound from state.labels / data fields. */
export const invoiceView: ViewDef = {
	content: {
		class: 'invoice-ui-container',
		children: [
			{
				class: 'invoice-doc-banner',
				children: [
					{
						class: 'inv-banner-hero-row',
						children: [
							{
								class: 'inv-banner-hero-left inv-banner-hero-invoice',
								children: [
									{ class: 'inv-banner-value inv-banner-kind', text: '$invoiceNumber' },
									{ class: 'inv-banner-sublabel', text: '$labels.invoiceNumber' },
								],
							},
							{
								class: 'inv-banner-hero-right',
								children: [
									{ class: 'inv-banner-value inv-banner-money', text: '$grandTotal' },
									{ class: 'inv-banner-sublabel', text: '$labels.grandTotal' },
								],
							},
						],
					},
					{
						class: 'inv-banner-mid inv-banner-mid--compact',
						children: [
							{
								class: 'inv-banner-mid-left',
								children: [
									{ class: 'inv-banner-compact-value', text: '$docKind' },
									{ class: 'inv-banner-compact-sublabel', text: '$labels.docKind' },
								],
							},
							{
								class: 'inv-banner-mid-dates inv-banner-mid-dates--merged',
								children: [
									{
										class: 'inv-banner-field',
										children: [
											{ class: 'inv-banner-value inv-banner-field-value', text: '$dueDate' },
											{ class: 'inv-banner-sublabel', text: '$labels.dueDate' },
										],
									},
									{
										class: 'inv-banner-field',
										children: [
											{ class: 'inv-banner-value inv-banner-field-value', text: '$issueDate' },
											{ class: 'inv-banner-sublabel', text: '$labels.issueDate' },
										],
									},
								],
							},
						],
					},
					{
						class: 'inv-banner-fields-row',
						children: [
							{
								class: 'inv-banner-field',
								children: [
									{ class: 'inv-banner-value inv-banner-field-value', text: '$orderNumber' },
									{ class: 'inv-banner-sublabel', text: '$labels.orderNumber' },
								],
							},
							{
								class: 'inv-banner-field',
								children: [
									{ class: 'inv-banner-value inv-banner-field-value', text: '$customerNumber' },
									{ class: 'inv-banner-sublabel', text: '$labels.customerNumber' },
								],
							},
						],
					},
				],
			},
			{
				class: 'invoice-grid',
				children: [partyCard('vendor'), partyCard('buyer')],
			},
			{
				$each: {
					items: '$sections',
					template: {
						class: 'invoice-block',
						children: [
							{
								class: 'invoice-items-wrap invoice-items-wrap--unified',
								children: [
									{
										class: 'invoice-items-cap invoice-items-cap--statement',
										children: [
											{
												class: 'invoice-items-cap-title-row',
												children: [
													{
														class: 'invoice-cap-block invoice-cap-block--title',
														text: '$$sectionTitle',
													},
													{
														class: 'invoice-items-cap-subline',
														children: [
															{
																class: 'invoice-cap-kv',
																attrs: { role: 'group', 'aria-label': '$labels.servicePeriod' },
																children: [
																	{ tag: 'span', class: 'invoice-cap-k', text: '$labels.servicePeriod' },
																	{ tag: 'span', class: 'invoice-cap-v', text: '$$servicePeriod' },
																],
															},
														],
													},
												],
											},
										],
									},
									{
										tag: 'table',
										class: 'invoice-items',
										attrs: { 'aria-label': '$labels.lineItemsAria' },
										children: [
											{
												tag: 'thead',
												children: [
													{
														tag: 'tr',
														$each: {
															items: '$labels.tableColumns',
															template: {
																tag: 'th',
																class: '$$class',
																text: '$$label',
															},
														},
													},
												],
											},
											{
												tag: 'tbody',
												$each: {
													items: '$$lineItems',
													template: {
														tag: 'tr',
														class: '$$rowClass',
														children: [
															{ tag: 'td', class: 'idx', text: '$$idx' },
															{ tag: 'td', text: '$$position' },
															{ tag: 'td', text: '$$article' },
															{
																tag: 'td',
																children: [
																	{ class: 'inv-line-item-primary', text: '$$title' },
																	{ class: 'inv-line-item-secondary', text: '$$description' },
																],
															},
															{ tag: 'td', class: 'num', text: '$$quantity' },
															{ tag: 'td', text: '$$unit' },
															{ tag: 'td', class: 'num', text: '$$unitPrice' },
															{ tag: 'td', class: 'num', text: '$$tax' },
															{ tag: 'td', class: 'num', text: '$$amount' },
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
				},
			},
			{
				class: 'invoice-financials',
				attrs: { role: 'group', 'aria-label': '$labels.financialsAria' },
				children: [
					{
						class: 'invoice-financials__section invoice-financials__section--totals',
						children: [
							{
								class: 'invoice-totals invoice-totals--embedded',
								$each: {
									items: '$totalRows',
									template: {
										class: '$$rowClass',
										children: [
											{ tag: 'span', text: '$$label' },
											{ tag: 'span', class: 'num', text: '$$value' },
										],
									},
								},
							},
						],
					},
					{
						class: 'invoice-financials__section invoice-financials__section--payments',
						children: [
							{
								class: 'invoice-bundle-label',
								attrs: { style: 'margin:0 0 6px 0' },
								text: '$labels.payments',
							},
							{
								$each: {
									items: '$payments',
									template: {
										class: 'row',
										children: [
											{ tag: 'span', text: '$$left' },
											{ tag: 'span', class: 'num', text: '$$amount' },
										],
									},
								},
							},
						],
					},
					{
						class: 'invoice-financials__outstanding',
						attrs: { role: 'group', 'aria-label': '$labels.outstanding' },
						children: [
							{
								class: 'invoice-root-outstanding-inner',
								children: [
									{ tag: 'span', class: 'invoice-root-outstanding-label', text: '$labels.outstanding' },
									{ tag: 'span', class: 'invoice-root-outstanding-value', text: '$outstanding' },
								],
							},
						],
					},
				],
			},
			{
				class: 'invoice-card',
				attrs: { style: 'margin-top:16px' },
				children: [
					{ tag: 'h4', text: '$labels.paymentInfo' },
					{ class: 'line', attrs: { style: 'white-space:pre-line' }, text: '$paymentInstructions' },
				],
			},
		],
	},
}
