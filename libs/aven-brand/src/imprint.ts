/**
 * Impressum / Site Notice — the one legal document still TEMPLATED from
 * [[COMPANY]] rather than fetched: its content IS the company facts. The
 * eRecht24 sync (`bun run sync:legal`) OVERWRITES this file with the
 * API-served text once a project key is configured; until then the
 * COMPANY-derived version below is the shipped truth.
 */
import { COMPANY } from './company.js'
import type { LegalDocument } from './legal.js'

/** Soft hyphen — break opportunities inside the long compound headings. */
const SHY = '­'

const c = COMPANY
const address = [c.legalName, c.street, c.city]

export const IMPRESSUM_DE: LegalDocument = {
	slug: 'impressum',
	lang: 'de',
	title: 'Impressum',
	path: '/de/impressum/',
	sections: [
		{
			blocks: [
				{ lines: address },
				{ lines: [`Handelsregister: ${c.register}`, `Registergericht: ${c.registerCourt}`] },
				{ lead: 'Vertreten durch:', lines: [c.representative] }
			]
		},
		{
			level: 2,
			title: 'Kontakt',
			blocks: [{ lines: [`Telefon: ${c.phone}`, `E-Mail: ${c.email}`] }]
		},
		{
			level: 2,
			title: 'Umsatzsteuer-ID',
			blocks: [
				{
					lines: ['Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:', c.vatId]
				}
			]
		},
		{
			level: 2,
			title: `Wirtschafts${SHY}identifikations${SHY}nummer`,
			blocks: [{ lines: [c.businessId] }]
		},
		{
			level: 2,
			title: 'Redaktionell verantwortlich',
			blocks: [{ lines: [c.representative, c.street, c.city] }]
		},
		{
			level: 2,
			title: `Verbraucher${SHY}streit${SHY}beilegung/Universal${SHY}schlichtungs${SHY}stelle`,
			blocks: [
				{
					lines: [
						'Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.'
					]
				}
			]
		},
		{
			level: 2,
			title:
				'Zentrale Kontaktstelle nach dem Digital Services Act - DSA (Verordnung (EU) 2022/2065)',
			blocks: [
				{
					lines: [
						'Unsere zentrale Kontaktstelle für Nutzer und Behörden nach Art. 11, 12 DSA erreichen Sie wie folgt:'
					]
				},
				{ lines: [`E-Mail: ${c.email}`] },
				{
					lines: [
						`Die für den Kontakt zur Verfügung stehenden Sprachen sind: ${c.contactLanguages.de}.`
					]
				}
			]
		}
	]
}

export const SITE_NOTICE_EN: LegalDocument = {
	slug: 'impressum',
	lang: 'en',
	title: 'Site Notice',
	path: '/site-notice/',
	sections: [
		{
			blocks: [
				{ lines: address },
				{ lines: [`Commercial Register: ${c.register}`, `Registration court: ${c.registerCourt}`] },
				{ lead: 'Represented by:', lines: [c.representative] }
			]
		},
		{
			level: 2,
			title: 'Contact',
			blocks: [{ lines: [`Phone: ${c.phone}`, `E-mail: ${c.email}`] }]
		},
		{
			level: 2,
			title: 'VAT ID',
			blocks: [
				{
					lines: [
						'Sales tax identification number according to Sect. 27 a of the Sales Tax Law:',
						c.vatId
					]
				}
			]
		},
		{
			level: 2,
			title: 'Business identification number',
			blocks: [{ lines: [c.businessId] }]
		},
		{
			level: 2,
			title: 'Person responsible for editorial',
			blocks: [{ lines: [c.representative, c.street, c.city] }]
		},
		{
			level: 2,
			title: 'Dispute resolution proceedings in front of a consumer arbitration board',
			blocks: [
				{
					lines: [
						'We are not willing or obliged to participate in dispute resolution proceedings in front of a consumer arbitration board.'
					]
				}
			]
		},
		{
			level: 2,
			title:
				'Central contact point according to the Digital Services Act - DSA (Regulation (EU) 2022/2065)',
			blocks: [
				{
					lines: [
						'You can reach our central contact point for users and authorities in accordance with Art. 11, 12 DSA as follows:'
					]
				},
				{ lines: [`E-mail: ${c.email}`] },
				{
					lines: [`The languages available for contact are: ${c.contactLanguages.en}.`]
				}
			]
		}
	]
}
