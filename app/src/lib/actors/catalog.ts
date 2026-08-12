import type { Manifest } from './actor'

/**
 * The catalog: every data-declared actor lives HERE, in code — the single
 * source of truth (0130). An entry is a manifest carrying its view/style
 * (validated JSON) and its logic (the sandboxed program); the boot wiring
 * registers it and the windows layer gives every view its window.
 *
 * The metric/imperial pair below is DELIBERATELY incompatible — one speaks
 * kilometres, the other requires miles. It exists so the Negotiator (0131)
 * has something real to bridge in front of a human: negotiate them, review
 * the drafted proxy, approve, and watch km flow as miles.
 */
/** One look for both demo gauges — a value card on brand tokens. */
const DEMO_STYLE = {
	selectors: {
		'.dm-shell': { width: '100%', maxWidth: '28rem' },
		'.dm-card': { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
		'.dm-row': { display: 'flex', alignItems: 'baseline', gap: '0.5rem' },
		'.dm-value': { fontSize: 'var(--fs-amount)', fontWeight: '600', lineHeight: '1' },
		'.dm-unit': {
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--fs-body)',
			color: 'var(--muted)'
		},
		'.dm-note': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' }
	}
}

export const catalog: Manifest[] = [
	{
		id: 'metric',
		name: 'Metric',
		description:
			'Measures distances in metric units. Every measurement produces one flat ' +
			'record {km: number} — kilometres, nothing else.',
		tags: ['demo'],
		logic: `
function initState(source) {
	return {
		measured: 0,
		display: '—',
		unit: 'km',
		note: 'Say a distance — I measure in kilometres.'
	}
}
function reduce(state, ev) {
	if (ev.send === 'MEASURE') {
		var km = typeof ev.payload.km === 'number' ? ev.payload.km : 42
		return {
			state: { measured: state.measured + 1, display: String(km), unit: 'km', note: state.note },
			said: 'measured ' + km + ' km',
			record: { ok: true, km: km }
		}
	}
	return state
}
function shape(state, rawText) {
	return null
}
`,
		view: {
			content: {
				class: 'brand-shell dm-shell',
				children: [
					{
						class: 'card dm-card',
						children: [
							{ class: 'eyebrow', text: 'Metric' },
							{
								class: 'dm-row',
								children: [
									{ class: 'dm-value', text: '$display' },
									{ class: 'dm-unit', text: '$unit' }
								]
							},
							{ class: 'dm-note', text: '$note' }
						]
					}
				]
			}
		},
		style: DEMO_STYLE,
		methods: [
			{
				name: 'metric_measure',
				description: 'Measures a distance in kilometres and produces a metric(M) record {km}.',
				parameters: {
					type: 'object',
					properties: { km: { type: 'number', description: 'Distance in kilometres.' } }
				},
				produces: ['metric(M)'],
				event: { send: 'MEASURE' }
			}
		]
	},
	{
		id: 'imperial-display',
		name: 'Imperial Display',
		description:
			'Shows distances in miles. Requires imperial payloads {miles: number} — it ' +
			'does NOT understand metric. Bridge it with the Negotiator.',
		tags: ['demo'],
		logic: `
function initState(source) {
	return {
		display: '—',
		unit: 'mi',
		note: 'Waiting for imperial data ({miles}). I do not speak metric — bridge me.'
	}
}
function reduce(state, ev) {
	if (ev.send === 'SHOW') {
		var miles =
			typeof ev.payload.miles === 'number'
				? ev.payload.miles
				: ev.payload.imperial && typeof ev.payload.imperial.miles === 'number'
					? ev.payload.imperial.miles
					: null
		if (miles === null) return state
		return {
			state: { display: String(miles), unit: 'mi', note: 'Latest distance, in miles.' },
			said: 'showing ' + miles + ' miles',
			record: { ok: true, shown: miles }
		}
	}
	return state
}
function shape(state, rawText) {
	return null
}
`,
		view: {
			content: {
				class: 'brand-shell dm-shell',
				children: [
					{
						class: 'card dm-card',
						children: [
							{ class: 'eyebrow', text: 'Imperial' },
							{
								class: 'dm-row',
								children: [
									{ class: 'dm-value', text: '$display' },
									{ class: 'dm-unit', text: '$unit' }
								]
							},
							{ class: 'dm-note', text: '$note' }
						]
					}
				]
			}
		},
		style: DEMO_STYLE,
		methods: [
			{
				name: 'imperial_show',
				description: 'Shows a distance given in miles ({miles} or {imperial: {miles}}).',
				parameters: {
					type: 'object',
					properties: { miles: { type: 'number', description: 'Distance in miles.' } }
				},
				requires: ['imperial(I)'],
				event: { send: 'SHOW' }
			}
		]
	}
]
