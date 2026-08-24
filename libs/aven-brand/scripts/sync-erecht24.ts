/**
 * Sync the legal documents from the eRecht24 Projekt-API, so the published
 * pages always match what counsel maintains in the eRecht24 account:
 *
 *   bun run sync:legal
 *
 * Contract (from the official rechtstexte-sdk): GET https://api.e-recht24.de
 * /v2/imprint · /v2/privacyPolicy · /v2/privacyPolicySocialMedia with the
 * project key in the `eRecht24-api-key` header (optional integration key in
 * `eRecht24-plugin-key`); each answers { html_de, html_en, … }.
 *
 * The HTML is parsed into the structured LegalDocument shape and written
 * over src/imprint.ts, src/privacy.ts and src/social-media.ts — the same
 * files every surface already imports. Run it, review the diff, commit.
 * The key comes from the E-RECHT-API-KEY env var (see the root .env).
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LegalBlock, LegalDocument, LegalLang, LegalSection, LegalSlug } from '../src/legal.js'

const API = 'https://api.e-recht24.de/v2'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const apiKey = process.env.E_RECHT_API_KEY
const pluginKey = process.env.E_RECHT_PLUGIN_KEY

if (import.meta.main && !apiKey) {
	console.error(
		'E_RECHT_API_KEY is not set. Put your eRecht24 project API key into the root .env:\n\n' +
			'  E_RECHT_API_KEY=<key from your eRecht24 project>\n\n' +
			'then run `bun run sync:legal` again.'
	)
	process.exit(1)
}

// ── the three documents and where their pages live ─────────────────────────
interface DocSpec {
	endpoint: string
	slug: LegalSlug
	file: string
	constants: [string, string]
	paths: [string, string]
	label: string
}

const DOCS: DocSpec[] = [
	{
		endpoint: 'imprint',
		slug: 'impressum',
		file: 'imprint.ts',
		constants: ['IMPRESSUM_DE', 'SITE_NOTICE_EN'],
		paths: ['/de/impressum/', '/site-notice/'],
		label: 'Impressum / Site Notice'
	},
	{
		endpoint: 'privacyPolicy',
		slug: 'datenschutz',
		file: 'privacy.ts',
		constants: ['DATENSCHUTZ_DE', 'PRIVACY_POLICY_EN'],
		paths: ['/de/datenschutz/', '/privacy-policy/'],
		label: 'Datenschutzerklärung / Privacy Policy'
	},
	{
		endpoint: 'privacyPolicySocialMedia',
		slug: 'social-media',
		file: 'social-media.ts',
		constants: ['SOCIAL_MEDIA_DE', 'SOCIAL_MEDIA_EN'],
		paths: ['/de/datenschutz/social-media/', '/social-media-privacy/'],
		label: 'Social-Media-Datenschutz'
	}
]

// ── minimal HTML → LegalDocument parser (the counsel markup is a fixed,
//    simple dialect: h1–h5, p, br, ul/li, a with href==text, leading strong) ─
const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	shy: '­',
	auml: 'ä',
	ouml: 'ö',
	uuml: 'ü',
	Auml: 'Ä',
	Ouml: 'Ö',
	Uuml: 'Ü',
	szlig: 'ß',
	sect: '§',
	ndash: '–',
	mdash: '—',
	bdquo: '„',
	ldquo: '“',
	rdquo: '”',
	lsquo: '‘',
	rsquo: '’',
	eacute: 'é',
	agrave: 'à',
	Eacute: 'É',
	euro: '€',
	copy: '©'
}

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body: string) => {
		if (body.startsWith('#x') || body.startsWith('#X')) {
			return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
		}
		if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
		return ENTITIES[body] ?? whole
	})
}

export function parseLegalHtml(html: string): { title: string; sections: LegalSection[] } {
	let title = ''
	const sections: LegalSection[] = []
	let current: LegalSection | null = null
	let mode: 'h' | 'p' | 'li' | null = null
	let buf = ''
	let lines: string[] = []
	let lead: string | undefined
	let items: string[] | null = null
	let inLeadStrong = false

	const section = () => {
		if (!current) {
			current = { blocks: [] }
			sections.push(current)
		}
		return current
	}
	const flush = () => {
		// strip bidi control characters that sneak in from copy-paste sources
		const text = decodeEntities(buf).replace(/[\u{202a}-\u{202e}\u{200e}\u{200f}]/gu, '')
		buf = ''
		return text.replace(/[ \t\r\n]+/g, ' ').trim()
	}

	for (const token of html.split(/(<[^>]+>)/)) {
		if (!token) continue
		if (!token.startsWith('<')) {
			if (mode) buf += token
			continue
		}
		const close = token.startsWith('</')
		const tag = (/^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(token)?.[1] ?? '').toLowerCase()
		if (/^h[1-5]$/.test(tag)) {
			if (close) {
				const text = flush()
				if (tag === 'h1' && !title) {
					title = text
				} else {
					current = { level: Number(tag[1]) as 2 | 3 | 4 | 5, title: text, blocks: [] }
					sections.push(current)
				}
				mode = null
			} else {
				mode = 'h'
				buf = ''
			}
		} else if (tag === 'p') {
			if (close) {
				const last = flush()
				if (last) lines.push(last)
				const kept = lines.filter(Boolean)
				if (kept.length > 0 || lead) {
					const block: LegalBlock = lead ? { lead, lines: kept } : { lines: kept }
					section().blocks.push(block)
				}
				mode = null
			} else {
				mode = 'p'
				buf = ''
				lines = []
				lead = undefined
			}
		} else if (tag === 'br' && mode === 'p') {
			lines.push(flush())
		} else if (tag === 'ul' && !close) {
			items = []
		} else if (tag === 'ul' && close) {
			if (items && items.length > 0) section().blocks.push({ items })
			items = null
		} else if (tag === 'li') {
			if (close) {
				const item = flush()
				if (item) items?.push(item)
				mode = null
			} else {
				mode = 'li'
				buf = ''
			}
		} else if (tag === 'strong' && mode === 'p') {
			if (!close && lines.length === 0 && flush() === '') {
				// a paragraph-leading <strong> becomes the block's bold lead line
				inLeadStrong = true
				buf = ''
			} else if (close && inLeadStrong) {
				lead = flush()
				inLeadStrong = false
			}
		}
		// every other tag (a, span, em, …) is transparent: its text flows through
	}
	if (!title) throw new Error('document has no <h1> title')
	return { title, sections }
}

// ── fetch, convert, write ──────────────────────────────────────────────────
function render(spec: DocSpec, de: LegalDocument, en: LegalDocument): string {
	const stamp = new Date().toISOString().slice(0, 10)
	return (
		'/**\n' +
		` * ${spec.label} — GENERATED from the eRecht24 Projekt-API\n` +
		` * (https://api.e-recht24.de/v2/${spec.endpoint}) by scripts/sync-erecht24.ts\n` +
		` * on ${stamp}. Do not edit the prose here — change the text in the\n` +
		' * eRecht24 account and run `bun run sync:legal` again.\n' +
		' */\n' +
		"import type { LegalDocument } from './legal.js'\n\n" +
		`export const ${spec.constants[0]}: LegalDocument = ${JSON.stringify(de, null, '\t')}\n\n` +
		`export const ${spec.constants[1]}: LegalDocument = ${JSON.stringify(en, null, '\t')}\n`
	)
}

const headers: Record<string, string> = {
	'content-type': 'application/json',
	'eRecht24-api-key': apiKey ?? ''
}
if (pluginKey) headers['eRecht24-plugin-key'] = pluginKey

let failures = 0
for (const spec of import.meta.main ? DOCS : []) {
	const response = await fetch(`${API}/${spec.endpoint}`, { headers })
	if (!response.ok) {
		console.error(`✗ ${spec.label}: HTTP ${response.status} ${await response.text()}`)
		if (response.status === 401 && !pluginKey) {
			console.error(
				'  ↳ The API also wants a DEVELOPER key (eRecht24 “plugin key”) for custom\n' +
					'    integrations — request one from eRecht24 (usage agreement, see\n' +
					'    github.com/eRecht24/external-integrators) and set E_RECHT_PLUGIN_KEY in .env.'
			)
		}
		failures++
		continue
	}
	const body = (await response.json()) as { html_de?: string; html_en?: string }
	if (!body.html_de || !body.html_en) {
		console.error(`✗ ${spec.label}: response carries no html_de/html_en`)
		failures++
		continue
	}
	const langs: [LegalLang, string, string][] = [
		['de', body.html_de, spec.paths[0]],
		['en', body.html_en, spec.paths[1]]
	]
	const [de, en] = langs.map(([lang, html, path]): LegalDocument => {
		const { title, sections } = parseLegalHtml(html)
		return { slug: spec.slug, lang, title, path, sections }
	}) as [LegalDocument, LegalDocument]
	writeFileSync(join(OUT, spec.file), render(spec, de, en))
	console.log(
		`✓ ${spec.label}: de ${de.sections.length} / en ${en.sections.length} sections → src/${spec.file}`
	)
}

if (import.meta.main) {
	spawnSync('bunx', ['biome', 'check', '--write', OUT], { stdio: 'ignore' })
	if (failures > 0) process.exit(1)
	console.log('\nReview the diff, then commit — every surface imports these files.')
}
