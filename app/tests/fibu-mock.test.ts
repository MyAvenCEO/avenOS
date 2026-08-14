import { describe, expect, test } from 'bun:test'
import { rechnungen, summe } from '../src/lib/fibu/mock-data'

/**
 * The mock data must itself be correct bookkeeping — the view only renders
 * what these invariants prove: balance, position-level tax consistency, and
 * the Härtetest's asymmetry (Geschenke-USt never reaches a Vorsteuer line).
 */

describe('fibu mock data', () => {
	test('every invoice balances: Σ Soll = Σ Haben = brutto', () => {
		for (const r of rechnungen) {
			expect(summe(r, 'soll')).toBe(r.brutto)
			expect(summe(r, 'haben')).toBe(r.brutto)
		}
	})

	test('every position is tax-consistent: ust = netto × satz', () => {
		for (const r of rechnungen) {
			for (const p of r.positionen) {
				expect(p.ust).toBe(Math.round((p.netto * p.ustSatz) / 100))
			}
			// The positions also carry the whole invoice: Σ(netto + ust) = brutto.
			const positionsBrutto = r.positionen.reduce((sum, p) => sum + p.netto + p.ust, 0)
			expect(positionsBrutto).toBe(r.brutto)
		}
	})

	test('every Buchungszeile references existing positions — n:m, never dangling', () => {
		for (const r of rechnungen) {
			const ids = new Set(r.positionen.map((p) => p.id))
			for (const z of r.buchungszeilen) {
				expect(z.positionIds.length).toBeGreaterThan(0)
				for (const id of z.positionIds) expect(ids.has(id)).toBe(true)
			}
		}
	})

	test('Härtetest: 4 Positionen fächern in exakt 7 Soll-Zeilen + 1 Haben-Zeile auf', () => {
		const r = rechnungen[0]
		expect(r.positionen.length).toBe(4)
		expect(r.buchungszeilen.filter((z) => z.seite === 'soll').length).toBe(7)
		expect(r.buchungszeilen.filter((z) => z.seite === 'haben').length).toBe(1)
		// The 70/30 split: two Soll lines drawing on the same Catering position.
		const catering = r.buchungszeilen.filter(
			(z) => z.seite === 'soll' && z.positionIds.includes('p-catering') && !z.vorsteuer
		)
		expect(catering.map((z) => z.betrag).sort((a, b) => a - b)).toEqual([45000, 105000])
	})

	test('Härtetest: abziehbare Vorsteuer = 665,00 + 56,00 — die Geschenke-USt taucht nirgends auf', () => {
		const r = rechnungen[0]
		const vorsteuer = r.buchungszeilen.filter((z) => z.vorsteuer)
		expect(vorsteuer.reduce((sum, z) => sum + z.betrag, 0)).toBe(66500 + 5600)
		// No Vorsteuer line may ever reference the Geschenke position: its USt
		// became acquisition cost (§ 15 Abs. 1a UStG) …
		for (const z of vorsteuer) expect(z.positionIds.includes('p-geschenke')).toBe(false)
		// … so the expense line carries brutto: 600,00 + 114,00.
		const geschenke = r.buchungszeilen.find(
			(z) => z.seite === 'soll' && z.positionIds.includes('p-geschenke')
		)
		expect(geschenke?.betrag).toBe(71400)
	})
})
