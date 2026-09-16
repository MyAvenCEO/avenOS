import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { loadEnrichedPersonaCorpus } from '../e2e/corpus/enriched'

const root = join(import.meta.dir, '..', 'e2e', 'corpus', 'generated')

test('Qwen episodes cover 180 days of three connected lives with varied source formats and languages', async () => {
	const { corpus, episodes } = await loadEnrichedPersonaCorpus()
	expect(episodes).toHaveLength(180)
	expect(corpus.contacts.length).toBeGreaterThanOrEqual(36)
	for (const persona of corpus.personas) {
		const own = episodes.filter((episode) => episode.personaId === persona.id)
		expect(own).toHaveLength(60)
		expect(new Set(own.map((episode) => episode.period)).size).toBe(12)
		expect(new Set(own.map((episode) => episode.artifact.language)).size).toBeGreaterThanOrEqual(2)
		expect(new Set(own.map((episode) => episode.intentId)).size).toBeGreaterThan(6)
		const contacts = corpus.contacts.filter((contact) => contact.personaId === persona.id)
		expect(new Set(contacts.map((contact) => contact.role)).size).toBeGreaterThan(7)
		expect(new Set(contacts.map((contact) => contact.writingStyle)).size).toBeGreaterThan(3)
		const fullNameChat = own.filter((episode) =>
			contacts.some((contact) => episode.user.includes(contact.name))
		)
		expect(fullNameChat.length).toBeLessThan(own.length / 2)
	}
	expect(new Set(episodes.map((episode) => episode.kind))).toEqual(
		new Set([
			'email',
			'document',
			'calendar',
			'todo',
			'receipt',
			'transport-ticket',
			'event-ticket',
			'voucher',
			'booking',
			'transaction',
			'order',
			'return',
			'support',
			'legal',
			'invoice',
			'payment',
			'card-statement',
			'bank-statement'
		])
	)
	expect(corpus.messages.length).toBeGreaterThan(5_500)
	expect(corpus.artifacts.length).toBeGreaterThan(900)
})

test('every ordinary follow-up is dated after its source and grounded in a file available then', async () => {
	const { corpus, episodes } = await loadEnrichedPersonaCorpus()
	for (const episode of episodes) {
		expect(episode.askDayIndex).toBeGreaterThanOrEqual(episode.dayIndex)
		expect(episode.askDate).toBe(
			corpus.days.find(
				(day) => day.personaId === episode.personaId && day.dayIndex === episode.askDayIndex
			)?.date
		)
		expect(episode.artifact.body).toContain(episode.probe.answer)
		expect(episode.probe.question.length).toBeGreaterThan(12)
		expect(episode.probe.question).not.toMatch(
			/hidden|benchmark|find the source|encuentra la fuente/i
		)
		const source = corpus.artifacts.find((artifact) => artifact.id === `${episode.id}:artifact`)
		expect(source?.kind).toBe(episode.kind)
		expect(source?.dayIndex).toBe(episode.dayIndex)
		expect(source?.body).toContain(episode.probe.answer)
		expect(corpus.probes.find((probe) => probe.id === `${episode.id}:probe`)?.askDate).toBe(
			episode.askDate
		)
	}
	const early = corpus.artifacts.filter(
		(artifact) => artifact.personaId === 'lena-weber' && artifact.dayIndex < 14
	)
	expect(early.some((artifact) => /4[,.]20\s*Euro/i.test(artifact.body))).toBe(false)
})

test('each model-written record materializes to a unique readable synthetic asset', async () => {
	const { episodes } = await loadEnrichedPersonaCorpus()
	const rows = (await Bun.file(join(root, 'asset-manifest.jsonl')).text())
		.trim()
		.split('\n')
		.map(
			(line) =>
				JSON.parse(line) as {
					episodeId: string
					path: string
					sha256: string
					kind: string
					mediaType: string
				}
		)
	expect(rows).toHaveLength(episodes.length)
	expect(new Set(rows.map((row) => row.path)).size).toBe(rows.length)
	for (const row of rows) {
		const file = Bun.file(join(import.meta.dir, '..', '..', row.path))
		expect(await file.exists()).toBe(true)
		const content = await file.text()
		expect(createHash('sha256').update(content).digest('hex')).toBe(row.sha256)
		expect(content).toMatch(/synthetic/i)
	}
})

test('later records in one matter are developments, not copied templates with new dates', async () => {
	const { episodes } = await loadEnrichedPersonaCorpus()
	const grams = (value: string) => {
		const normalized = value.toLocaleLowerCase().replace(/\d/g, '0').replace(/\s+/g, ' ')
		return new Set(
			Array.from({ length: Math.max(0, normalized.length - 3) }, (_, index) =>
				normalized.slice(index, index + 4)
			)
		)
	}
	const overlap = (left: string, right: string) => {
		const a = grams(left)
		const b = grams(right)
		return [...a].filter((gram) => b.has(gram)).length / Math.max(1, new Set([...a, ...b]).size)
	}
	const collisions: string[] = []
	for (const episode of episodes) {
		for (const other of episodes) {
			if (episode.id >= other.id || episode.intentId !== other.intentId) continue
			if (overlap(episode.artifact.body, other.artifact.body) > 0.82)
				collisions.push(`${episode.id} <> ${other.id}`)
		}
	}
	expect(collisions).toEqual([])
})
