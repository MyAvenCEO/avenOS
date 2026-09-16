import { expect, test } from 'bun:test'
import { generatePersonaCorpus } from '../e2e/corpus/persona-model'
import { pageMessages } from '../src/lib/chat/history-selection'
import { lookupIntents, selectContextIntents } from '../src/lib/intents/context-selection'

const corpus = generatePersonaCorpus()

test('three synthetic lives cover every day for 180 days with both personal and business activity', () => {
	expect(corpus.personas.map((persona) => persona.language).sort()).toEqual(['de', 'en', 'es'])
	expect(corpus.days).toHaveLength(540)
	expect(corpus.intents.length).toBeGreaterThanOrEqual(300)
	expect(corpus.messages.length).toBeGreaterThan(4_000)
	for (const persona of corpus.personas) {
		const days = corpus.days.filter((day) => day.personaId === persona.id)
		expect(days.map((day) => day.dayIndex)).toEqual(Array.from({ length: 180 }, (_, day) => day))
		for (const day of days) {
			const domains = new Set(
				day.touchedIntentIds.map((id) => corpus.intents.find((intent) => intent.id === id)?.domain)
			)
			expect(domains.has('personal')).toBe(true)
			expect(domains.has('business')).toBe(true)
			expect(day.createdArtifactIds.length).toBeGreaterThan(0)
		}
	}
})

test('emails and documents are dated, linked to work, and have coherent revisions', () => {
	expect(corpus.artifacts.length).toBeGreaterThan(550)
	expect(corpus.artifacts.filter((artifact) => artifact.kind === 'email').length).toBeGreaterThan(
		250
	)
	expect(
		corpus.artifacts.filter((artifact) => artifact.kind === 'document').length
	).toBeGreaterThan(250)
	for (const kind of ['calendar', 'todo', 'receipt'] as const) {
		expect(corpus.artifacts.filter((artifact) => artifact.kind === kind)).toHaveLength(60)
	}
	const byId = new Map(corpus.artifacts.map((artifact) => [artifact.id, artifact]))
	expect(byId.size).toBe(corpus.artifacts.length)
	for (const artifact of corpus.artifacts) {
		expect(artifact.body.length).toBeGreaterThan(30)
		expect(
			corpus.intents.some(
				(intent) => intent.id === artifact.intentId && intent.personaId === artifact.personaId
			)
		).toBe(true)
		if (!artifact.supersedesId) continue
		const previous = byId.get(artifact.supersedesId)
		expect(previous).toBeDefined()
		expect(previous?.intentId).toBe(artifact.intentId)
		expect(previous?.dayIndex).toBeLessThan(artifact.dayIndex)
	}
})

test('old archived and cross-language evidence stays retrievable beyond default context', () => {
	const personaId = 'sofia-morales'
	const intents = corpus.intents.filter((intent) => intent.personaId === personaId)
	const finalDay = corpus.days.find((day) => day.personaId === personaId && day.dayIndex === 179)
	expect(finalDay).toBeDefined()
	const recent = selectContextIntents(
		intents,
		finalDay?.selectedIntentId ?? '',
		finalDay?.recentIntentIds ?? []
	)
	expect(recent).toHaveLength(8)
	expect(recent.some((intent) => intent.id === `${personaId}:valencia-wedding`)).toBe(false)
	const found = lookupIntents(
		intents,
		'SOL-983',
		0,
		20,
		(id, query) =>
			corpus.messages.some(
				(message) => message.intentId === id && message.content.includes(query)
			) ||
			corpus.artifacts.some((artifact) => artifact.intentId === id && artifact.body.includes(query))
	)
	expect(found.rows.map((intent) => intent.id)).toContain(`${personaId}:valencia-wedding`)
	const weddingMessages = corpus.messages.filter(
		(message) => message.intentId === `${personaId}:valencia-wedding`
	)
	expect(weddingMessages.slice(-24).some((message) => message.content.includes('SOL-983'))).toBe(
		false
	)
	expect(
		pageMessages(weddingMessages, 'SOL-983', 0, 20).rows.some((message) =>
			message.content.includes('SOL-983')
		)
	).toBe(true)
	const englishMail = corpus.artifacts.find(
		(artifact) => artifact.id === 'sofia-orange-shipment-mail'
	)
	expect(englishMail?.language).toBe('en')
	expect(englishMail?.body).toContain('ORANGE-64')
})

test('answer probes point to evidence, including revised documents and explicit unknowns', () => {
	expect(corpus.probes.length).toBeGreaterThanOrEqual(20)
	for (const probe of corpus.probes) {
		if (probe.answerMode === 'not-found') {
			expect(probe.expectedAnswer).toBeNull()
			continue
		}
		expect(probe.expectedAnswer).not.toBeNull()
		const linkedMessages = corpus.messages.filter(
			(message) => message.intentId === probe.targetIntentId
		)
		const linkedArtifacts = corpus.artifacts.filter(
			(artifact) => artifact.intentId === probe.targetIntentId
		)
		expect(
			[
				...linkedMessages.map((message) => message.content),
				...linkedArtifacts.map((artifact) => artifact.body)
			].some((content) => content.includes(probe.expectedAnswer ?? ''))
		).toBe(true)
		if (probe.targetArtifactId) {
			const artifact = corpus.artifacts.find((item) => item.id === probe.targetArtifactId)
			expect(artifact?.intentId).toBe(probe.targetIntentId)
			expect(artifact?.body).toContain(probe.expectedAnswer ?? '')
		}
	}
})
