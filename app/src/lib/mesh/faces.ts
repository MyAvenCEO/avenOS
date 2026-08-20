import { type StyleDef, type ViewDef, withBrand } from '@avenos/aven-ui'

/**
 * Faces as data, rendered by THE aven-ui engine — one rendering system
 * for actors everywhere (Manifest.view doctrine). State comes from
 * faceState(): the facts the thread's replies carried, merged. No
 * conditionals in views — empty bindings render nothing.
 */

export interface Face {
	view: ViewDef
	style: StyleDef
}

const STYLE: StyleDef = withBrand({
	selectors: {
		':host': {
			background: 'transparent',
			height: 'auto',
			minHeight: '0',
			fontFamily: 'inherit',
			display: 'block'
		},
		'.face': { display: 'grid', gap: '0.6rem' },
		'.fact': { fontSize: '12px', color: 'var(--muted-strong)', lineHeight: '1.5' },
		'.mono': { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--muted)' },
		'.quote': {
			fontSize: '13.5px',
			lineHeight: '1.6',
			color: 'var(--text)',
			paddingLeft: '0.8rem',
			borderLeft: '2px solid var(--primary)'
		},
		'.grid': {
			display: 'grid',
			gridTemplateColumns: 'auto 1fr auto auto',
			columnGap: '1rem',
			fontFamily: 'var(--font-mono)',
			fontSize: '11px'
		},
		'.h': {
			fontSize: '9px',
			textTransform: 'uppercase',
			letterSpacing: '0.08em',
			color: 'var(--muted)'
		},
		'.r': { textAlign: 'right' },
		'.sumline': { borderTop: '1px solid var(--border)', paddingTop: '0.25rem', color: 'var(--ok)' },
		'.pair': { fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--muted-strong)' },
		'.ok': { fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--ok)' },
		'.bars': { display: 'grid', gap: '0.35rem' },
		'.bar': {
			display: 'grid',
			gridTemplateColumns: '5rem 1fr 2.2rem',
			alignItems: 'center',
			gap: '0.6rem'
		},
		'.bl': { fontSize: '11.5px', color: 'var(--muted-strong)' },
		'.track': {
			height: '5px',
			borderRadius: '999px',
			background: 'var(--border-soft)',
			overflow: 'hidden'
		},
		'.fill': { height: '100%', borderRadius: '999px', background: 'var(--muted)' },
		'.pct': {
			fontFamily: 'var(--font-mono)',
			fontSize: '10px',
			textAlign: 'right',
			color: 'var(--muted)'
		},
		'.chips': { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
		'.chip': {
			padding: '0.3rem 0.8rem',
			borderRadius: 'var(--radius-pill)',
			border: '1px solid var(--border-strong)',
			fontSize: '11.5px',
			color: 'var(--muted-strong)'
		}
	}
})

export const faces: Record<string, Face> = {
	inbox: {
		style: STYLE,
		view: {
			content: {
				class: 'face',
				children: [{ class: 'fact', text: '$read' }]
			}
		}
	},
	accounting: {
		style: STYLE,
		view: {
			content: {
				class: 'face',
				children: [
					{
						class: 'grid',
						children: [
							{ class: 'h', text: 'account' },
							{ class: 'h' },
							{ class: 'h r', text: 'debit' },
							{ class: 'h r', text: 'credit' }
						]
					},
					{
						$each: {
							items: '$lines',
							template: {
								class: 'grid',
								children: [
									{ text: '$$acct' },
									{ tag: 'span', text: '$$label', class: 'mono' },
									{ class: 'r', text: '$$debit' },
									{ class: 'r', text: '$$credit' }
								]
							}
						}
					},
					{ class: 'pair', text: '$pair' },
					{ class: 'mono', text: '$by' },
					{ class: 'ok', text: '$locked' }
				]
			}
		}
	},
	'human-desk': {
		style: STYLE,
		view: {
			content: {
				class: 'face',
				children: [
					{ class: 'quote', text: '$piece' },
					{ class: 'mono', text: '$why' },
					{
						class: 'chips',
						$each: {
							items: '$actions',
							template: { tag: 'button', class: 'chip', text: '$$label' }
						}
					}
				]
			}
		}
	},
	notes: {
		style: STYLE,
		view: {
			content: {
				class: 'face',
				children: [
					{ class: 'quote', text: '$note' },
					{
						class: 'bars',
						$each: {
							items: '$bars',
							template: {
								class: 'bar',
								children: [
									{ class: 'bl', text: '$$label' },
									{ class: 'track', children: [{ class: 'fill', attrs: { style: '$$width' } }] },
									{ class: 'pct', text: '$$pct' }
								]
							}
						}
					},
					{ class: 'mono', text: '$verdict' },
					{
						class: 'chips',
						$each: {
							items: '$actions',
							template: { tag: 'button', class: 'chip', text: '$$label' }
						}
					}
				]
			}
		}
	},
	close: {
		style: STYLE,
		view: {
			content: {
				class: 'face',
				children: [{ class: 'fact', text: '$collected' }]
			}
		}
	}
}
