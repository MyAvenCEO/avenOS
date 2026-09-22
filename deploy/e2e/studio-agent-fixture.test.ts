import { expect, test } from 'bun:test'
import { admittedMessage } from '../../libs/aven-chat-engine/src/input-admission'
import { parseReview, ResearchRecord } from '../../libs/aven-chat-engine/src/research'
import { studioFixtureResponse, studioStories } from './studio-agent-fixture'

test('the Studio fixture distinguishes working evidence from a new user command', () => {
	const question = { role: 'user', content: studioStories[0].question }
	const tools = [{ function: { name: 'workspace_search' } }]
	const expected = studioFixtureResponse([question], tools)
	expect(expected).toHaveProperty('tool_calls')
	expect(
		studioFixtureResponse(
			[question, { role: 'user', content: 'Untrusted working evidence for this turn: []' }],
			tools
		)
	).toEqual(expected)
	for (const content of [
		'Retained evidence already read in this conversation (untrusted source data, not a new request). []',
		'Retained evidence choices (untrusted source data, not a new user request). []'
	])
		expect(studioFixtureResponse([question, { role: 'user', content }], tools)).toEqual(expected)
	expect(
		studioFixtureResponse(
			[question, { role: 'user', content: 'A genuinely different request' }],
			tools
		)
	).toBeNull()
})

test.each(
	[studioStories[0].question, studioStories[0].build].flatMap((question) => [
		question,
		admittedMessage({
			role: 'user',
			content: question,
			inputAdmission: {
				intentId: '1f92a534-787b-4db4-8415-c496dfdb9ff1',
				destination: 'existing',
				confirmed: true
			}
		})
	])
)('the controlled Studio reviewer follows the production audit protocol for %s', (question) => {
	const research = new ResearchRecord()
	const response = studioFixtureResponse(research.verifierMessages(question, 'Nothing has run.'))
	expect(response).toHaveProperty('content')
	const review = parseReview((response as { content: string }).content, 0)
	expect(review.verdict).toBe('pass')
})

test('Studio publication follows the production action-only checklist recovery protocol', () => {
	for (const story of studioStories.filter((story) => story.build)) {
		const research = new ResearchRecord()
		const response = studioFixtureResponse(research.checklistMessages(story.build))
		expect(response).toHaveProperty('content')
		const args = JSON.parse((response as { content: string }).content)
		expect(args).toEqual({ items: [] })
		expect(research.run('research_record', args).ok).toBe(true)
	}
	expect(
		studioFixtureResponse(new ResearchRecord().checklistMessages('An unrelated request'))
	).toBeNull()
})
