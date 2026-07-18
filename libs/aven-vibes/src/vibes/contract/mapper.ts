import { arr, card, kvList, rec, section, str, txt } from '../_doc/map.js'
import type { DocCard, DocSection, DocView } from '../_doc/types.js'

// Map a raw extracted CONTRACT (doctype.json schema) → the generic DocView. board 0064.

function contractParty(raw: unknown): DocCard {
	const p = rec(raw)
	const role = str(p.role)
	const lines = [
		str(p.legal_form) || null,
		str(p.registration) || null,
		...(typeof p.address === 'string' ? p.address.split('\n').map((l) => str(l)) : []),
		str(p.representative) ? `Vertreten durch: ${str(p.representative)}` : null,
		str(p.email) || null
	]
	return card(role || str(p.name) || 'Partei', lines, str(p.name))
}

export function mapContractToView(raw: unknown): DocView {
	const d = rec(raw)
	const sections: DocSection[] = []

	sections.push(
		section('Vertrag', {
			rows: kvList([
				['Art', d.contract_type],
				['Aktenzeichen', d.contract_id],
				['Wirksam ab', d.effective_date],
				['Recht / Gerichtsstand', d.jurisdiction],
				['Sprache', d.language]
			])
		})
	)

	if (str(d.preamble)) {
		sections.push(section('Präambel', { cards: [card('', [str(d.preamble)], 'Präambel')] }))
	}

	const parties = arr(d.parties)
	if (parties.length) {
		sections.push(section('Parteien', { cards: parties.map(contractParty) }))
	}

	const defs = arr(d.definitions)
	if (defs.length) {
		sections.push(
			section('Definitionen', {
				rows: defs.map((rawDef) => {
					const def = rec(rawDef)
					return { k: txt(def.term), v: txt(def.definition) }
				})
			})
		)
	}

	for (const rawClause of arr(d.clauses)) {
		const c = rec(rawClause)
		const head = [str(c.number), str(c.title)].filter(Boolean).join(' ')
		const subs = arr(c.subclauses).map((rawSub) => {
			const s = rec(rawSub)
			return `${str(s.label)} ${str(s.text)}`.trim()
		})
		sections.push(
			section(head || 'Klausel', {
				cards: [card('', [str(c.body) || null, ...subs], head || 'Klausel')]
			})
		)
	}

	return {
		title: txt(d.title) === '—' ? 'Vertrag' : String(d.title),
		subtitle: 'Vertrag',
		sections
	}
}
