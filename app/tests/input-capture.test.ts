import { expect, test } from 'bun:test'
import { admissionDigest } from '@avenos/intents/admission'
import {
	admissionFromPending,
	captureInputContext,
	screenReferences
} from '../src/lib/chat/input-capture'
import { InputInboxController, type PendingInput } from '../src/lib/chat/input-inbox-controller'

const id = () => crypto.randomUUID()
const origin = id(),
	artifact = id(),
	draft = id(),
	caseId = id()

test('screen capture retains only versioned identities, never mutable definitions or secrets', () => {
	const references = screenReferences(
		{
			view: 'compose',
			draftId: draft,
			draftRevision: 4,
			artifactId: artifact,
			rootArtifactId: artifact,
			definition: { privateDraft: 'not an admission prompt' },
			credential: 'never admission material'
		},
		caseId
	)
	expect(references).toEqual([
		{ kind: 'case', id: caseId },
		{ kind: 'skill-draft', id: draft, revision: 4 },
		{ kind: 'artifact', id: artifact }
	])
	expect(screenReferences({ view: 'explore', draftId: draft, draftRevision: 4 })).toEqual([])
	expect(() => screenReferences({ view: 'compose', draftId: draft, draftRevision: null })).toThrow()
	expect(() => screenReferences({ artifactId: '../foreign' })).toThrow()
})

test('pending capture survives navigation, private serialization and reconstruction unchanged', async () => {
	const original = captureInputContext(
		{
			prompt: 'An unsaved display draft, not permission to execute it.',
			references: [{ kind: 'skill-draft', id: draft, revision: 4 }]
		},
		'Pacific/Auckland'
	)
	let saved: PendingInput[] = []
	const make = () =>
		new InputInboxController(
			{
				inspect: async () => ({
					intents: [],
					route: {
						fit: false,
						explicit: false,
						target: null,
						topic: 'Draft review',
						responseMode: 'work'
					}
				}),
				reply: async () => 'clarify',
				assign: async () => {
					throw Error('No assignment in this capture contract test')
				},
				save: async (items) => {
					saved = JSON.parse(JSON.stringify(items))
				}
			},
			() => {}
		)
	const first = make()
	void first.submit(
		'Review this draft, without publishing it.',
		origin,
		0,
		undefined,
		id(),
		'en-NZ',
		undefined,
		undefined,
		original
	)
	original.references[0] = { kind: 'artifact', id: id() }
	original.prompt = 'Different screen after the user navigated.'
	await first.flush()
	expect(saved[0].capture!.references).toEqual([{ kind: 'skill-draft', id: draft, revision: 4 }])
	const snapshot = JSON.parse(JSON.stringify(saved))
	first.reset()
	const recovered = make()
	recovered.restore(snapshot)
	const pending = recovered.active!
	const input = admissionFromPending(pending, { kind: 'existing', id: origin })
	expect(input.timezone).toBe('Pacific/Auckland')
	expect(input.references).toEqual([{ kind: 'skill-draft', id: draft, revision: 4 }])
	expect(JSON.stringify(input)).not.toContain('display draft')
	expect(input).not.toHaveProperty('prompt')
	expect(input).not.toHaveProperty('capture')
	expect(await admissionDigest(input)).toBe(
		await admissionDigest(admissionFromPending(pending, input.target))
	)
	recovered.reset()
})

test('admission preserves original feedback scope but carries source dialogue only across Intents', () => {
	const item: PendingInput = {
		id: id(),
		revision: 1,
		text: 'Discuss it here.',
		originalText: 'Discuss it here.',
		corrections: [],
		locale: 'fr-FR',
		createdAt: new Date().toISOString(),
		defaultId: origin,
		selectionEpoch: 0,
		stage: 'choice',
		intents: [],
		suggestion: null,
		topic: '',
		error: null,
		confirmed: true,
		decisionId: id(),
		capture: captureInputContext({}, 'Europe/Paris'),
		sourceContext: {
			intentId: origin,
			capturedAt: new Date().toISOString(),
			messages: [
				{ id: id(), role: 'user', content: 'A fictional exhibition idea.', shortened: false }
			]
		},
		feedbackCheck: {
			commandId: id(),
			intentId: origin,
			locale: 'fr-FR',
			recent: [{ role: 'assistant', responseId: id(), content: 'A fictional display suggestion.' }]
		}
	}
	expect(admissionFromPending(item, { kind: 'existing', id: origin }).sourceContext).toBeUndefined()
	const moved = admissionFromPending(item, { kind: 'existing', id: id() })
	expect(moved.sourceContext).toEqual(item.sourceContext)
	expect(moved.feedbackCheck!.intentId).toBe(origin)
	expect(
		admissionFromPending(item, { kind: 'new', title: 'New discussion' }).sourceContext
	).toEqual(item.sourceContext)
	delete item.capture
	expect(() => admissionFromPending(item, { kind: 'existing', id: origin })).toThrow(
		'Review and resubmit'
	)
})

test('bad captures fail before removing the words from the composer', () => {
	expect(() => captureInputContext({}, 'invented/timezone')).toThrow()
	expect(() => captureInputContext({ prompt: 'x'.repeat(32001) })).toThrow()
	expect(() =>
		captureInputContext({
			references: Array.from({ length: 9 }, () => ({ kind: 'artifact', id: id() }))
		})
	).toThrow()
})
