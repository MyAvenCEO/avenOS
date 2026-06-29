// Build the BASE gismu lexicon (auto-parsed) from gismu.tsv.
// This produces structure + stubbed places; the per-place semantics (role/kind/
// example/references) are written by the LLM enrichment pass and merged in via
// merge-parts.mjs. Run: bun .claude/skills/ontology/scripts/build-gismu.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const raw = readFileSync(join(root, 'gismu.tsv'), 'utf8')

const norm = (s) => s.replace(/x_\{(\d)\}/g, 'x$1').replace(/\s+/g, ' ').trim()

const gismu = {}
let count = 0
for (const line of raw.split('\n')) {
	if (!line.trim()) continue
	const parts = line.split('\t')
	const word = (parts[0] ?? '').trim()
	if (!/^[a-z']{5}$/.test(word)) continue
	const definition = norm(parts[1] ?? '')
	const kwRaw = (parts[2] ?? '').trim()
	const keywords =
		!kwRaw || kwRaw === 'undefined'
			? []
			: kwRaw
					.split('<br>')
					.map((k) => k.replace(/^\s*-\s*/, '').trim())
					.filter(Boolean)
	const arity = Math.max(0, ...[...definition.matchAll(/x(\d)/g)].map((m) => Number(m[1])))
	// English name from the first keyword's primary token, else the gismu itself.
	const name = (keywords[0]?.split(';')[0].trim() || word).toLowerCase()
	// Stub one place object per position; the enrichment pass fills these.
	const places = {}
	for (let i = 1; i <= arity; i++) {
		places[`x${i}`] = { role: null, definition: null, example: null, kind: null }
	}
	gismu[word] = { gismu: word, name, source: 'lojban', description: definition, keywords, arity, places }
	count++
}

const out = {
	source:
		'Lojban gismu (canonical root words + place structures). Reference vocabulary for ontology / predicate place-structures.',
	note: 'Predicate NAMES are pragmatic English; their x1–x5 place structures REUSE the matching gismu here (recorded as `gismu`). See board 0084. Places carry role/definition/example/kind(value|ref)/type|references once enriched.',
	count,
	enriched: 0,
	gismu
}
writeFileSync(join(root, 'gismu.base.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`base: wrote ${count} gismu → gismu.base.json (places stubbed; run merge-parts to produce gismu.json)`)
