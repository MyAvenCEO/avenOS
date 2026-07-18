import { describe, expect, test } from 'bun:test'
import {
	enrichFields,
	matchContact,
	normalizeName,
	partiesFromDoc,
	partyToContactFields
} from '../src/contact-match.js'

// board 0082 — harvest + match-make addressbook identities from an extracted doc.

describe('contact match', () => {
	test('normalizeName strips legal forms', () => {
		expect(normalizeName('WaizmannTabelle GmbH')).toBe('waizmanntabelle')
		expect(normalizeName('Müller & Co. KG')).toBe('müller')
		expect(normalizeName('ActiveCampaign, LLC')).toBe('activecampaign')
	})

	test('partyToContactFields maps tax_id, postal_code, banking', () => {
		const f = partyToContactFields({
			name: 'Acme',
			postal_code: '10115',
			tax_id: 'DE123456789',
			banking_accounts: [{ iban: 'DE89 3704', bic: 'COBADEFF' }]
		})
		expect(f.zip).toBe('10115')
		expect(f.vat_id).toBe('DE123456789') // looks like a USt-IdNr
		expect(f.iban).toBe('DE89 3704')
		expect(f.bic).toBe('COBADEFF')
	})

	test('matchContact: by vat_id, then by normalized name', () => {
		const contacts = [
			{ id: 'a', name: 'WaizmannTabelle GmbH', vat_id: 'DE111', short_id: 'AAAA1111' },
			{ id: 'b', name: 'Andere AG', vat_id: 'DE222', short_id: 'BBBB2222' }
		]
		expect(matchContact({ name: 'X', vat_id: 'DE222' }, contacts)?.id).toBe('b') // vat wins
		expect(matchContact({ name: 'waizmanntabelle' }, contacts)?.id).toBe('a') // name normalized
		expect(matchContact({ name: 'Unknown GmbH' }, contacts)).toBeNull()
	})

	test('enrichFields only fills what is missing', () => {
		const existing = { id: 'a', name: 'Acme', city: 'Berlin', vat_id: null }
		const patch = enrichFields(existing, { name: 'Acme GmbH', city: 'Köln', vat_id: 'DE9', email: 'x@y.de' })
		expect(patch.vat_id).toBe('DE9') // was missing → filled
		expect(patch.email).toBe('x@y.de') // missing → filled
		expect(patch.city).toBeUndefined() // already set → NOT overwritten
		expect(patch.name).toBeUndefined() // already set
	})

	test('partiesFromDoc pulls vendor + self from an invoice', () => {
		const { vendor, self } = partiesFromDoc('invoice', {
			vendor: { name: 'Lieferant GmbH' },
			buyer: { name: 'Meine Firma UG' }
		})
		expect(vendor?.name).toBe('Lieferant GmbH')
		expect(self?.name).toBe('Meine Firma UG') // the buyer is the user's own company candidate
		expect(partiesFromDoc('bank_statement', { account_holder: { name: 'Ich' } }).self?.name).toBe(
			'Ich'
		)
	})
})
