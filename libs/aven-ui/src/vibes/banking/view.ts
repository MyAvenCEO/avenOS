import type { ViewDef } from '../../engine/types.js'

// Banking vibe (board 0088) — admin-only aEUR wallet: address + balance, an admin-only mint
// panel, a send form (pick a recipient, enter an amount), and the signed/hash-chained tx
// history. Mirrors a real wallet so a real chain can swap in behind it later.
export const bankingView: ViewDef = {
	content: {
		class: 'bk-ui-container',
		children: [
			// ── Wallet header: address + aEUR balance + total supply ────────────────────
			{
				class: 'bk-card bk-wallet',
				children: [
					{
						class: 'bk-wallet-head',
						children: [
							{
								children: [
									{ class: 'bk-eyebrow', text: '$labels.walletEyebrow' },
									{ tag: 'h1', class: 'bk-balance', text: '$balanceDisplay' }
								]
							},
							{
								class: 'bk-wallet-meta',
								children: [
									{ class: 'bk-field-label', text: '$labels.addressLabel' },
									{ tag: 'code', class: 'bk-address', text: '$addressShort' },
									{ class: 'bk-supply', text: '$supplyDisplay' }
								]
							}
						]
					}
				]
			},
			// ── Mint panel (admin only — hidden via [data-admin="false"]) ────────────────
			{
				class: 'bk-card bk-card--admin',
				attrs: { 'data-admin': '$isAdmin' },
				children: [
					{ tag: 'h4', text: '$labels.mintTitle' },
					{
						class: 'bk-form-row',
						children: [
							{
								tag: 'input',
								class: 'bk-input',
								attrs: {
									type: 'text',
									inputmode: 'decimal',
									placeholder: '$labels.amountPlaceholder',
									value: '$mintAmount',
									'aria-label': '$labels.mintTitle'
								},
								$on: { input: { send: 'SET_MINT_AMOUNT', payload: { value: '$value' } } }
							},
							{
								tag: 'button',
								class: 'bk-btn bk-btn--primary',
								attrs: { type: 'button' },
								text: '$labels.mintButton',
								$on: { click: { send: 'MINT' } }
							}
						]
					}
				]
			},
			// ── Send panel: recipient picker + amount ────────────────────────────────────
			{
				class: 'bk-card',
				children: [
					{ tag: 'h4', text: '$labels.sendTitle' },
					{ class: 'bk-field-label', text: '$labels.recipientLabel' },
					{
						class: 'bk-recipients',
						children: [
							{
								tag: 'span',
								class: 'bk-empty bk-empty--inline',
								text: '$labels.noRecipients',
								attrs: { 'data-empty': 'true' }
							},
							{
								$each: {
									items: '$recipients',
									template: {
										tag: 'button',
										class: '$$recipientClass',
										attrs: { type: 'button', 'data-address': '$$address' },
										text: '$$email',
										$on: {
											click: {
												send: 'SET_RECIPIENT',
												payload: { address: '$$address', email: '$$email' }
											}
										}
									}
								}
							}
						]
					},
					{
						class: 'bk-form-row',
						children: [
							{
								tag: 'input',
								class: 'bk-input',
								attrs: {
									type: 'text',
									inputmode: 'decimal',
									placeholder: '$labels.amountPlaceholder',
									value: '$sendAmount',
									'aria-label': '$labels.sendTitle'
								},
								$on: { input: { send: 'SET_SEND_AMOUNT', payload: { value: '$value' } } }
							},
							{
								tag: 'button',
								class: 'bk-btn bk-btn--primary',
								attrs: { type: 'button' },
								text: '$labels.sendButton',
								$on: { click: { send: 'SEND' } }
							}
						]
					},
					{ class: 'bk-note', text: '$notice' }
				]
			},
			// ── Ledger: signed, hash-chained tx history ─────────────────────────────────
			{
				class: 'bk-card bk-card--list',
				children: [
					{
						class: 'bk-list-head',
						children: [
							{ tag: 'h4', text: '$labels.historyTitle' },
							{ class: 'bk-chain-tag', text: '$labels.chainTag' }
						]
					},
					{
						tag: 'ul',
						class: 'bk-list',
						children: [
							{
								tag: 'li',
								class: 'bk-empty',
								text: '$labels.emptyHistory',
								attrs: { 'data-empty': 'true' }
							},
							{
								$each: {
									items: '$txs',
									template: {
										tag: 'li',
										class: '$$rowClass',
										children: [
											{
												class: 'bk-tx-main',
												children: [
													{ tag: 'span', class: 'bk-tx-label', text: '$$label' },
													{ tag: 'span', class: '$$amountClass', text: '$$amountDisplay' }
												]
											},
											{
												class: 'bk-tx-sub',
												children: [
													{ tag: 'span', class: 'bk-tx-party', text: '$$counterparty' },
													{ tag: 'span', class: '$$verifiedClass', text: '$$verifiedLabel' }
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
		]
	}
}
