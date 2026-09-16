import { expect, test } from 'bun:test'
import { gradeRubric, parseRubricReview, rubricFingerprint } from '../e2e/retrieval-grading'

test('rubric grading requires every criterion and actual answer evidence', () => {
	const answer = 'The May 21 night is not covered by a booking beginning May 22.'
	const check = {
		item: 0,
		passed: true,
		quote: 'May 21 night is not covered',
		reason: 'Explicitly identifies the first-night gap.'
	}
	expect(parseRubricReview(JSON.stringify({ checks: [check] }), answer, 1)).toEqual([check])
	expect(
		parseRubricReview(
			JSON.stringify({ checks: [check] }),
			answer.replace('May 21', '**May 21**'),
			1
		)
	).toEqual([check])
	for (const checks of [
		[],
		[check, check],
		[{ ...check, quote: 'Dates align fully' }],
		[{ ...check, item: 2 }],
		[{ ...check, quote: '' }]
	])
		expect(() => parseRubricReview(JSON.stringify({ checks }), answer, 1)).toThrow()
	expect(
		parseRubricReview(
			JSON.stringify({ checks: [{ ...check, passed: false, quote: '' }] }),
			answer,
			1
		)[0].passed
	).toBe(false)
})

test('cached rubric judgments are invalidated by any evidence or criterion change', () => {
	const original = rubricFingerprint('question', 'answer', ['criterion'])
	expect(rubricFingerprint('question', 'answer', ['criterion'])).toBe(original)
	expect(rubricFingerprint('question', 'answer', ['criterion'], 'another-model')).not.toBe(original)
	for (const inputs of [
		['changed', 'answer', ['criterion']],
		['question', 'changed', ['criterion']],
		['question', 'answer', ['changed']]
	] as const)
		expect(rubricFingerprint(inputs[0], inputs[1], [...inputs[2]])).not.toBe(original)
})

test('model grading cites actual numbered passages rather than rewriting quotes', async () => {
	const stream = async function* () {
		yield {
			kind: 'text' as const,
			text: JSON.stringify({
				checks: [
					{ item: 0, passed: true, quoteIndex: 1, reason: 'Second passage records the gap.' }
				]
			})
		}
		yield { kind: 'finish' as const, reason: 'stop' }
	}
	const result = await gradeRubric(
		'When?',
		'**Booking**\nCoverage begins tomorrow.',
		['Do not cover today'],
		stream
	)
	expect(result.checks[0].quote).toBe('Coverage begins tomorrow.')
	expect(result.pass).toBe(true)
	await expect(gradeRubric('When?', 'Only one passage.', ['Coverage'], stream)).rejects.toThrow(
		'unknown answer passage'
	)
})
