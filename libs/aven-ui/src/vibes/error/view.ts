import type { ViewDef } from '../../engine/types.js'

/** Intent error screen — diagnostic panel; copy bound from initState output. */
export const errorView: ViewDef = {
	content: {
		class: 'st-panel st-panel--error',
		children: [
			{
				class: 'st-badge-row',
				children: [{ tag: 'span', class: 'st-badge', text: '$badge' }],
			},
			{
				class: 'st-headline',
				children: [
					{ class: 'st-eyebrow', text: '$eyebrow' },
					{ tag: 'h2', class: 'st-title', text: '$title' },
				],
			},
			{
				class: 'st-message',
				children: [
					{ tag: 'span', class: 'st-message-label', text: '$messageLabel' },
					{ tag: 'span', class: 'st-message-text', text: '$message' },
				],
			},
			{ class: 'st-hint', text: '$hint' },
		],
	},
}
