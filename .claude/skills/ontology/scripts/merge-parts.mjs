// Merge LLM-enriched part files (parts/*.json) over the base gismu.json.
// Each part file is a JSON object keyed by gismu word, each value carrying enriched
// `name`/`places` (places: { x1: { role, definition, example, kind, type|references } }).
// Validates coverage + place completeness and reports gaps. Run:
//   bun .claude/skills/ontology/scripts/merge-parts.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const partsDir = join(root, 'parts')

const db = JSON.parse(readFileSync(join(root, 'gismu.base.json'), 'utf8'))

if (!existsSync(partsDir)) {
	console.error('no parts/ directory yet — run the enrichment agents first')
	process.exit(1)
}

let enriched = 0
const problems = []
for (const f of readdirSync(partsDir).filter((f) => f.endsWith('.json'))) {
	let part
	try {
		part = JSON.parse(readFileSync(join(partsDir, f), 'utf8'))
	} catch (e) {
		problems.push(`${f}: invalid JSON (${e.message})`)
		continue
	}
	for (const [word, entry] of Object.entries(part)) {
		if (!db.gismu[word]) {
			problems.push(`${f}: unknown gismu "${word}"`)
			continue
		}
		db.gismu[word] = { ...db.gismu[word], ...entry, gismu: word }
		enriched++
	}
}

// Coverage report
const stub = []
for (const [word, e] of Object.entries(db.gismu)) {
	const places = Object.values(e.places ?? {})
	if (places.length && places.some((p) => p.kind == null)) stub.push(word)
}

db.enriched = Object.keys(db.gismu).length - stub.length
writeFileSync(join(root, 'gismu.json'), `${JSON.stringify(db, null, 2)}\n`)

console.log(`merged ${enriched} enriched entries.`)
console.log(`enriched: ${db.enriched}/${db.count}  |  still stubbed: ${stub.length}`)
if (stub.length) console.log(`first stubbed: ${stub.slice(0, 20).join(', ')}${stub.length > 20 ? ' …' : ''}`)
if (problems.length) {
	console.log(`\nPROBLEMS (${problems.length}):`)
	for (const p of problems.slice(0, 40)) console.log(`  - ${p}`)
}
