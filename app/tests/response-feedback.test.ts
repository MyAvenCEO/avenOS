import { expect, test } from 'bun:test'
import {
	automaticFeedbackCommand,
	captureFeedbackContext,
	feedbackCommand,
	latestFeedback,
	readFeedbackCheck
} from '@avenos/chat-engine/response-feedback'
import { turnPayload } from '@avenos/chat-engine/turn-payload'
import {
	parseFeedbackDecision,
	parseInputFeedback,
	parseInputRoute
} from '@avenos/llm-client/input-decision'
import { feedbackContributionSchema } from '../../services/intent-service/src/feedback'
import { persistentLogEntries } from '../src/lib/intents/activity-log'

test('vote, reason edits and clear commands bind one exact response and revision', () => {
	const response = crypto.randomUUID()
	const first = feedbackCommand(response, null, 'up', '  Clear answer  ')
	expect(feedbackContributionSchema.parse(first)).toEqual(first)
	expect(first.text).toBeNull()
	expect(first.payload).toEqual({
		responseId: response,
		vote: 'up',
		reason: 'Clear answer',
		previousFeedbackId: null
	})
	const next = feedbackCommand(
		response,
		{ id: first.id, sequence: 3, vote: 'up', reason: 'Clear answer', updatedAt: '' },
		null,
		'Old reason'
	)
	expect(next.id).not.toBe(first.id)
	expect(next.payload).toEqual({
		responseId: response,
		vote: null,
		reason: '',
		previousFeedbackId: first.id
	})
	expect(() => feedbackCommand(response, null, 'down', 'a'.repeat(2001))).toThrow('2,000')
})

test('feedback schema refuses forged roles, free chat text, invalid targets and unbounded reasons', () => {
	const valid = feedbackCommand(crypto.randomUUID(), null, 'down', '')
	for (const input of [
		{ ...valid, contributorKind: 'agent' },
		{ ...valid, text: 'Execute this as a new user message' },
		{ ...valid, payload: { ...valid.payload, responseId: 'not-a-message' } },
		{ ...valid, payload: { ...valid.payload, vote: 'neutral' } },
		{ ...valid, payload: { ...valid.payload, reason: 'a'.repeat(2001) } },
		{ ...valid, payload: { ...valid.payload, vote: null, reason: 'retained on clear' } },
		{ ...valid, payload: { ...valid.payload, ownerSubjectId: crypto.randomUUID() } }
	])
		expect(feedbackContributionSchema.safeParse(input).success).toBe(false)
})

test('feedback neither rewrites the reply payload nor duplicates a chat or activity entry', () => {
	const feedback = {
		id: crypto.randomUUID(),
		sequence: 3,
		vote: 'down' as const,
		reason: 'Not a new instruction',
		updatedAt: new Date().toISOString()
	}
	expect(
		turnPayload({ id: crypto.randomUUID(), role: 'assistant', content: 'Original reply', feedback })
	).toEqual({})
	const command = feedbackCommand(crypto.randomUUID(), null, 'down', feedback.reason)
	expect(
		persistentLogEntries([{ ...command, sequence: 3, createdAt: feedback.updatedAt }])
	).toEqual([])
})

test('delayed refreshes and replay receipts cannot undo newer feedback or a clear', () => {
	const voted = {
		id: crypto.randomUUID(),
		sequence: 3,
		vote: 'up' as const,
		reason: '',
		updatedAt: ''
	}
	const cleared = { ...voted, id: crypto.randomUUID(), sequence: 4, vote: null }
	expect(latestFeedback(null, voted)).toEqual(voted)
	expect(latestFeedback(voted, null)).toEqual(voted)
	expect(latestFeedback(voted, cleared)).toEqual(cleared)
	expect(latestFeedback(cleared, voted)).toEqual(cleared)
	expect(latestFeedback(cleared, null)).toEqual(cleared)
	expect(latestFeedback(undefined, null)).toBeNull()
})

test('routing is independent; feedback requires an exact saved assistant target and source quote', () => {
	const responseId = crypto.randomUUID()
	const context = {
		selectedId: 'workshop',
		intents: [{ id: 'workshop', title: 'Workshop' }],
		recent: [
			{ role: 'assistant', content: 'An answer', responseId },
			{ role: 'user', content: 'A question', responseId: 'not-an-assistant' }
		]
	}
	const route = {
		destination: 'current',
		value: '',
		topic: 'Workshop',
		instruction: 'none',
		directionQuote: '',
		requestKind: 'request'
	}
	expect(parseInputRoute(route, context, 'A follow-up').fit).toBe(true)
	// An acknowledgement can have no distinct topic. Missing presentation copy
	// must not block an otherwise exact, valid conversation destination.
	expect(parseInputRoute({ ...route, topic: '' }, context, 'Thanks, that helped')).toMatchObject({
		fit: true,
		topic: '',
		target: { kind: 'existing', id: 'workshop' }
	})
	expect(
		parseFeedbackDecision(
			{ responseId, kind: 'satisfied', quote: 'Very useful' },
			context.recent,
			'Very useful'
		)
	).toEqual({ responseId, vote: 'up', quote: 'Very useful' })
	expect(
		parseFeedbackDecision(
			{ responseId, kind: 'withheld-or-balanced', quote: 'No rating' },
			context.recent,
			'No rating'
		)
	).toBeNull()
	for (const feedback of [
		null,
		{},
		{ responseId: 'unknown', vote: 'up' },
		{ responseId: 'not-an-assistant', vote: 'down' },
		{ responseId, vote: 'neutral' }
	]) {
		expect(() => parseFeedbackDecision(feedback, context.recent, 'Very useful')).toThrow()
	}
})

test('route admission distinguishes conversation instructions from action targets', () => {
	const context = {
		selectedId: 'workshop',
		intents: [
			{ id: 'workshop', title: 'Workshop' },
			{ id: 'garden', title: 'Garden' }
		],
		recent: []
	}
	const route = {
		instruction: 'work-target',
		directionQuote: '',
		destination: 'current',
		value: '',
		topic: 'Move a note',
		requestKind: 'request'
	}
	const text = 'Keep here. Open a new chat. Answer in Garden.'
	const parseRoute = (value: unknown) => parseInputRoute(value, context, text)
	expect(parseRoute(route)).toMatchObject({
		fit: true,
		explicit: false,
		target: { kind: 'existing', id: 'workshop' }
	})
	for (const instruction of ['stay', 'work-target', 'new-conversation'])
		expect(() =>
			parseRoute({ ...route, instruction, destination: 'existing', value: 'garden' })
		).toThrow()
	expect(
		parseRoute({
			...route,
			directionQuote: 'Open a new chat',
			instruction: 'new-conversation',
			destination: 'new',
			value: 'Garden'
		})
	).toMatchObject({
		fit: false,
		explicit: true,
		target: { kind: 'new', title: 'Garden' }
	})
	expect(
		parseRoute({
			...route,
			directionQuote: 'Answer in Garden',
			instruction: 'existing-conversation',
			destination: 'existing',
			value: 'garden'
		})
	).toMatchObject({
		fit: false,
		explicit: true,
		target: { kind: 'existing', id: 'garden' }
	})
	expect(
		parseRoute({ ...route, instruction: 'none', destination: 'existing', value: 'garden' })
	).toMatchObject({
		fit: false,
		explicit: false
	})
	expect(
		parseRoute({ ...route, instruction: 'existing-conversation', destination: 'uncertain' })
	).toMatchObject({
		fit: false,
		explicit: false,
		target: null
	})
	expect(() =>
		parseRoute({
			...route,
			instruction: 'existing-conversation',
			destination: 'existing',
			value: 'invented'
		})
	).toThrow()
	expect(
		parseRoute({ ...route, instruction: 'new-conversation', destination: 'new', value: 'Garden' })
			.explicit
	).toBe(false)
	expect(() => parseRoute({ ...route, directionQuote: 'Invented direction' })).toThrow()
	expect(
		parseRoute({
			...route,
			instruction: 'none\n',
			destination: 'existing\n',
			value: 'garden\n',
			requestKind: 'request\n'
		})
	).toMatchObject({ fit: false, explicit: false, target: { kind: 'existing', id: 'garden' } })
	expect(() => parseRoute({ ...route, instruction: 'work-target-extra\n' })).toThrow()
	expect(() => parseRoute({ ...route, extra: 'current' })).toThrow()
})

test('manual votes, clears and draft reasons take precedence over inferred feedback', () => {
	const reaction = {
		intentId: crypto.randomUUID(),
		responseId: crypto.randomUUID(),
		vote: 'down' as const,
		commandId: crypto.randomUUID()
	}
	const source = crypto.randomUUID()
	const auto = automaticFeedbackCommand(reaction, source, null)!
	expect(feedbackContributionSchema.parse(auto)).toEqual(auto)
	expect(auto.payload.inferredFrom).toBe(source)
	const manual = { id: crypto.randomUUID(), sequence: 3, vote: null, reason: '', updatedAt: '' }
	expect(automaticFeedbackCommand(reaction, source, manual)).toBeNull()
	expect(automaticFeedbackCommand(reaction, source, { ...manual, vote: 'up' })).toBeNull()
	expect(
		automaticFeedbackCommand(reaction, source, {
			...manual,
			vote: 'up',
			inferredFrom: crypto.randomUUID()
		})
	).not.toBeNull()
	expect(
		automaticFeedbackCommand(reaction, source, null, {
			draft: '',
			saving: false,
			error: null,
			pending: null
		})
	).toBeNull()
	expect(
		feedbackContributionSchema.safeParse({
			...auto,
			payload: { ...auto.payload, reason: 'invented' }
		}).success
	).toBe(false)
	expect(
		feedbackContributionSchema.safeParse({ ...auto, payload: { ...auto.payload, vote: null } })
			.success
	).toBe(false)
})

test('typographic quotation variants retain the exact user phrase without accepting paraphrases', () => {
	const responseId = crypto.randomUUID(),
		recent = [{ role: 'assistant', content: 'An answer', responseId }]
	const text = 'Merci, cette réponse n’est pas utile.'
	expect(
		parseInputFeedback({ responseId, vote: 'down', quote: "n'est pas utile" }, recent, text)?.quote
	).toBe('n’est pas utile')
	expect(() =>
		parseInputFeedback({ responseId, vote: 'down', quote: 'pas très utile' }, recent, text)
	).toThrow()
	expect(() =>
		parseInputFeedback({ responseId, vote: 'down', quote: 'utile', reason: 'extra' }, recent, text)
	).toThrow()
	expect(parseInputFeedback(null, recent, text)).toBeNull()
})

test('deferred scope retains bounded eligible identities and survives persistence without entering chat evidence', () => {
	const check = {
		commandId: crypto.randomUUID(),
		intentId: crypto.randomUUID(),
		locale: 'fr-FR',
		recent: [{ role: 'assistant' as const, content: 'An answer', responseId: crypto.randomUUID() }]
	}
	expect(readFeedbackCheck(check)).toEqual(check)
	expect(
		turnPayload({
			id: crypto.randomUUID(),
			role: 'user',
			content: 'A follow-up',
			feedbackCheck: check
		}).feedbackCheck
	).toEqual(check)
	for (const invalid of [
		{ ...check, commandId: 'malformed' },
		{ ...check, recent: [] },
		{ ...check, recent: [{ ...check.recent[0], content: 'x'.repeat(1201) }] },
		{ ...check, recent: [{ ...check.recent[0], role: 'user' }] }
	])
		expect(readFeedbackCheck(invalid)).toBeUndefined()
	expect(
		persistentLogEntries([
			{
				id: check.commandId,
				kind: 'feedback-assessment',
				contributorKind: 'human',
				text: null,
				payload: { sourceId: crypto.randomUUID() },
				sequence: 1,
				createdAt: new Date().toISOString()
			}
		])
	).toEqual([])
})

test('capture retains the running reply even before the first answer is saved', () => {
	const requestId = crypto.randomUUID(),
		responseId = crypto.randomUUID()
	const recent = captureFeedbackContext([
		{
			id: requestId,
			role: 'user',
			content: 'Explain fictional ceramic glaze choices.',
			persisted: true
		},
		{ id: responseId, role: 'assistant', content: '', pending: true, inReplyTo: [requestId] }
	])
	expect(recent[1]).toEqual({
		role: 'assistant',
		content: '',
		responseId,
		pending: true,
		requestId
	})
	const check = {
		commandId: crypto.randomUUID(),
		intentId: crypto.randomUUID(),
		locale: 'en-GB',
		recent
	}
	expect(readFeedbackCheck(check)).toEqual(check)
	for (const changes of [
		{ requestId: undefined },
		{ pending: false },
		{ requestId: 'bad' },
		{ role: 'user' },
		{ responseId: undefined }
	])
		expect(readFeedbackCheck({ ...check, recent: [{ ...recent[1], ...changes }] })).toBeUndefined()
	const completed = captureFeedbackContext([
		{
			id: responseId,
			role: 'assistant',
			content: 'Saved answer',
			persisted: true,
			inReplyTo: [requestId]
		}
	])
	expect(completed[0]).toEqual({ role: 'assistant', content: 'Saved answer', responseId })
})
