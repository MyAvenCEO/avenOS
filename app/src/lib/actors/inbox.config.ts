import { type StyleDef, type ViewDef, withBrand } from '@avenos/aven-ui'
import type { Manifest } from './actor'
import inboxMachineSource from './inbox-machine.pl?raw'

/**
 * The inbox actor as DATA — DECLARED + MOCKED (0153): the intake queue
 * rendered from sample source items, the per-case machine and contracts
 * from `inbox-machine.pl`. The real mail/upload/LLM wiring is card 0157;
 * until then this actor shows exactly what the skill will feel like.
 */

const INBOX_LOGIC = `
function badge(intent) {
	return 'ib-badge ib-badge--' + intent
}

function row(item) {
	return {
		id: item.id,
		source: item.source,
		title: item.title,
		intent: item.intent,
		state: item.state,
		badgeClass: badge(item.intent)
	}
}

function present(domain) {
	var rows = []
	for (var i = 0; i < domain.items.length; i++) rows.push(row(domain.items[i]))
	return { items: domain.items, rows: rows, count: rows.length, empty: rows.length === 0 }
}

function initState(source) {
	var items = (source && source.items) || []
	return present({ items: items })
}

function reduce(state, ev) {
	if (ev.send === 'LIST') {
		return {
			state: present({ items: state.items }),
			said: 'inbox (' + state.items.length + ' items)',
			record: { ok: true, items: state.items }
		}
	}
	return state
}

function shape(state, rawText) {
	return null
}
`

const inboxView: ViewDef = {
	content: {
		class: 'brand-shell ib-shell',
		children: [
			{
				class: 'wi-head',
				children: [
					{
						children: [
							{ class: 'eyebrow', text: 'Inbox' },
							{ tag: 'h1', class: 'wi-title', text: 'Intake' }
						]
					}
				]
			},
			{
				tag: 'ul',
				class: 'ib-list',
				$each: {
					items: '$rows',
					template: {
						tag: 'li',
						class: 'ib-row',
						children: [
							{ class: 'ib-source', text: '$$source' },
							{ class: 'ib-title', text: '$$title' },
							{ class: '$$badgeClass', text: '$$intent' },
							{ class: 'ib-state', text: '$$state' }
						]
					}
				}
			}
		]
	}
}

const selectors: StyleDef['selectors'] = {
	'.ib-shell': { display: 'flex', flexDirection: 'column', gap: '16px' },
	'.ib-list': { display: 'flex', flexDirection: 'column', gap: '8px', listStyle: 'none' },
	'.ib-row': {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
		padding: '10px 14px',
		borderRadius: '12px',
		background: '#fffdf7',
		border: '1px solid rgba(30,41,59,0.08)'
	},
	'.ib-source': { fontSize: '11px', opacity: '0.5', minWidth: '64px' },
	'.ib-title': { flex: '1', fontSize: '14px' },
	'.ib-state': { fontSize: '11px', opacity: '0.5' },
	'.ib-badge': { fontSize: '11px', padding: '2px 8px', borderRadius: '999px' },
	'.ib-badge--todo': { background: 'rgba(47,93,80,0.12)', color: '#2f5d50' },
	'.ib-badge--document': { background: 'rgba(91,122,157,0.15)', color: '#46617f' },
	'.ib-badge--unknown': { background: 'rgba(193,91,64,0.12)', color: '#9c4832' }
}

export const inboxConfig: Manifest = {
	id: 'inbox',
	name: 'Inbox',
	description:
		'The one entrance: mail and uploads become cases, get classified once, and are ' +
		'routed by intent. Mocked — the flows are declared, the wiring lands in 0157.',
	tags: ['inbox'],
	machine: inboxMachineSource,
	logic: INBOX_LOGIC,
	view: inboxView,
	style: withBrand({ tokens: { 'max-w': '56rem' }, selectors }),
	// The mocked queue: what a fresh morning looks like.
	source: {
		items: [
			{
				id: 'i1',
				source: 'mail',
				title: 'Re: Miete August — bitte überweisen',
				intent: 'todo',
				state: 'routed'
			},
			{
				id: 'i2',
				source: 'upload',
				title: 'rechnung-buerostuhl.pdf',
				intent: 'document',
				state: 'routed'
			},
			{
				id: 'i3',
				source: 'mail',
				title: 'FWD: irgendwas mit Katzenbildern',
				intent: 'unknown',
				state: 'unknown'
			}
		]
	},
	methods: [
		{
			name: 'inbox_list',
			description: 'Lists what arrived in the inbox and where it was routed.',
			parameters: { type: 'object', properties: {} },
			event: { send: 'LIST' }
		}
	]
}
