import type { ViewDef } from '../../engine/types.js'

/** Intent success screen — completion panel; copy bound from initState output. */
export const successView: ViewDef = {
	content: {
		class: 'st-panel st-panel--success',
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
		],
	},
}
