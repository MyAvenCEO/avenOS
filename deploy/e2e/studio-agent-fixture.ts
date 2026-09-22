/** Scripted model responses for transport/tool-loop proof, NOT an intelligence benchmark.
 * IDs and definitions are obtained from real tool results; no database writes or canned programs here.
 */
export const studioStories = [
	{
		key: 'Nordton supplier review',
		title: 'Nordton review checklist',
		mode: 'written',
		question:
			'Remember the Nordton supplier review we handled manually? Find that procedure in my old Intents and help me turn it into a skill. Show me the evidence first.',
		build:
			'Build and publish the confirmed Nordton review checklist. Name it Nordton reusable review. Do not run it yet.',
		capability: 'ceo.aven:capability:artifacts.markdown:write@1',
		history:
			'Nordton supplier review: I manually opened the supplier invoice, checked the totals, confirmed receipt of the goods, and wrote a Markdown checklist. Payment approval always stays with me. The checklist text was:\n# Supplier review\n\n- [ ] Check invoice totals\n- [ ] Confirm receipt of goods\n- [ ] Approve payment manually\n',
		outcome:
			'Create the same reusable review checklist; do not claim that checks or payment approvals have happened.'
	},
	{
		key: 'Atlas Friday handover',
		title: 'Atlas email handover',
		mode: 'transcript',
		question:
			'We used to turn each Atlas Friday handover email into a short brief by hand. Find the old conversation and make that repeatable. Let me confirm that you found the right case first.',
		build:
			'Build and publish the confirmed Atlas email handover as Atlas reusable brief. Do not run it yet.',
		capability: 'ceo.aven:capability:studio.email-brief:create@1',
		history:
			'Atlas Friday handover: For each incoming project email I manually copied its sender, subject and message into a compact handover brief. I kept the source email attached. I did not send replies or create promises on anyone else’s behalf.',
		outcome:
			'Turn an incoming email into a compact brief with the source retained. No outbound messages.'
	},
	{
		key: 'Clara wedding capacity',
		title: 'Clara permit check',
		mode: 'written',
		question:
			'Find how we manually checked Clara wedding capacity with the city office. Could that become a skill? Show any missing pieces as hypothetical, not completed.',
		build: '',
		capability: '',
		history:
			'Clara wedding capacity: I read the signed date amendment and phoned the city office to check the separate capacity permit. The amendment did not approve capacity. We still have no online city-permit lookup or notification integration.',
		outcome:
			'Check the authoritative permit status for the signed event date, then notify me; never infer approval from the amendment.'
	}
] as const

type Message = {
	role?: string
	content?: unknown
	tool_call_id?: string
	tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
}
const text = (message: Message | undefined) =>
	typeof message?.content === 'string' ? message.content : ''
const originalQuestion = (value: string) =>
	value.split('\n\n[Input widget decision, recorded after composition:')[0]
export function studioFixtureResponse(
	messages: Message[],
	tools: Array<{ function?: { name?: string } }> = []
) {
	// Chat appends a bounded evidence summary after the actual user turn. It is
	// working context, not a new command (and must not select a different story).
	const lastUser = messages.findLastIndex(
		(m) =>
			m.role === 'user' &&
			![
				'Untrusted working evidence for this turn: ',
				'Retained evidence already read in this conversation (untrusted source data, not a new request).',
				'Retained evidence choices (untrusted source data, not a new user request).'
			].some((prefix) => text(m).startsWith(prefix))
	)
	const question = originalQuestion(text(messages[lastUser]))
	const story = studioStories.find(
		(s) => s.question === question || (s.build && s.build === question)
	)
	const answer = (content: string) => ({ content })
	// Building/publishing uses observed action receipts, not document quotations.
	// Exercise the production checklist-recovery phase as well as the final audit.
	if (text(messages[0]).startsWith('Prepare the factual source checklist')) {
		let data: any
		try {
			data = JSON.parse(text(messages[1]))
		} catch {
			return null
		}
		if (studioStories.some((s) => s.build && s.build === originalQuestion(data.question)))
			return answer(JSON.stringify({ items: [] }))
		return null
	}
	// The production chat loop requires an evidence review after reading history.
	if (text(messages[0]).startsWith('You are an internal answer auditor')) {
		let data: any
		try {
			data = JSON.parse(question)
		} catch {
			return null
		}
		const reviewedQuestion = originalQuestion(data.question)
		if (
			!studioStories.some(
				(s) => s.question === reviewedQuestion || (s.build && s.build === reviewedQuestion)
			)
		)
			return null
		const grounded = data.checklist.every(
			(item: any) =>
				item.sources.length &&
				item.sources.every((citation: any) =>
					data.sources.some(
						(source: any) =>
							source.sourceId === citation.sourceId && source.content.includes(citation.quote)
					)
				)
		)
		return answer(
			JSON.stringify({
				verdict: grounded ? 'pass' : 'revise',
				requestChecks: Object.fromEntries(
					['language', 'timeScope', 'outcome', 'presentation'].map((key) => [
						key,
						{
							verdict: grounded ? 'pass' : 'revise',
							reason: 'Controlled wiring fixture; live-model quality is qualified separately.'
						}
					])
				),
				issues: grounded ? [] : ['Missing exact history quote'],
				checks: data.checklist.map((_: unknown, item: number) => ({
					item,
					verdict: grounded ? 'pass' : 'revise',
					reason:
						'Synthetic fixture review checked exact quotations against the retrieved original conversation.'
				}))
			})
		)
	}
	if (!story) return null
	const round = messages.slice(lastUser + 1)
	const results = round
		.filter((m) => m.role === 'tool')
		.map((m) => {
			const call = round.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === m.tool_call_id)
			let value: any
			try {
				value = JSON.parse(text(m))
			} catch {
				value = { error: text(m) }
			}
			return {
				name: call?.function.name,
				args: JSON.parse(call?.function.arguments ?? '{}'),
				value
			}
		})
	const got = (name: string) => results.findLast((r) => r.name === name)?.value
	const call = (name: string, args: unknown) => {
		if (!tools.some((t) => t.function?.name === name))
			throw Error(`Studio fixture missing real tool ${name}`)
		return {
			tool_calls: [
				{
					index: 0,
					id: `studio-${results.length}`,
					type: 'function',
					function: { name, arguments: JSON.stringify(args) }
				}
			]
		}
	}
	if (results.some((r) => r.value.ok === false || r.value.error))
		return answer('Studio fixture failed: ' + JSON.stringify(results.at(-1)))
	if (question === story.build) {
		if (!got('studio_state')) return call('studio_state', {})
		const confirmed = got('studio_state').artifacts.find(
			(a: any) =>
				a.typeKey === 'studio.case' &&
				a.payload.status === 'confirmed' &&
				a.payload.case.title === story.title
		)
		if (!confirmed) return answer('Please confirm the proposed case in Studio first.')
		if (!got('studio_case_build'))
			return call('studio_case_build', { artifactId: confirmed.artifactId })
		const draft = got('studio_case_build')
		const definition = draft.definition
		const name = story.key.startsWith('Nordton')
			? 'Nordton reusable review'
			: 'Atlas reusable brief'
		const edits: any[] = [
			{
				kind: 'rename',
				name
			}
		]
		if (story.key.startsWith('Nordton'))
			edits.push(
				{
					kind: 'set-parameter-binding',
					stepId: definition.steps[0].id,
					parameter: 'title',
					binding: { kind: 'literal', value: 'Supplier review' }
				},
				{
					kind: 'set-parameter-binding',
					stepId: definition.steps[0].id,
					parameter: 'content',
					binding: {
						kind: 'literal',
						value: story.history.slice(story.history.indexOf('# Supplier review'))
					}
				},
				{ kind: 'remove-public-parameter', name: 'title' },
				{ kind: 'remove-public-parameter', name: 'content' }
			)
		if (!got('studio_author'))
			return call('studio_author', {
				id: draft.id,
				revision: draft.revision,
				action: { kind: 'edit', edits }
			})
		if (!got('studio_publish'))
			return call('studio_publish', { id: draft.id, revision: got('studio_author').revision })
		return answer(`Published ${name}. Nothing has run yet.`)
	}
	if (!got('workspace_search'))
		return call('workspace_search', { kind: 'message', query: story.key })
	const match = got('workspace_search').messages?.find((m: any) =>
		m.content.includes(story.history.slice(0, 90))
	)
	if (!match) return answer('Studio fixture failed: original manual procedure was not found.')
	if (!got('workspace_read')) return call('workspace_read', { kind: 'message', id: match.id })
	const source = got('workspace_read')
	if (!source.content?.includes(story.history))
		return answer('Studio fixture failed: full procedure is missing.')
	if (!got('studio_catalog'))
		return call('studio_catalog', { search: story.capability || 'city permit', limit: 100 })
	if (
		story.capability &&
		!got('studio_catalog').entries.some(
			(e: any) => e.capabilityId === story.capability && e.canAuthor
		)
	)
		return answer('Studio fixture failed: installed Actor is not authorable.')
	if (!got('studio_case_propose'))
		return call('studio_case_propose', {
			case: {
				title: story.title,
				situation: story.key,
				outcome: story.outcome,
				evidence: [
					{
						id: 'manual-procedure',
						kind: 'message',
						sourceId: source.sourceId,
						locator: source.intentId,
						quote: story.history,
						interpretation: 'Recorded manual process, not an automated execution receipt.'
					}
				],
				steps: [
					story.capability
						? {
								id: 'prepare',
								label: story.title,
								kind: 'action',
								capabilityId: story.capability,
								evidenceIds: ['manual-procedure']
							}
						: {
								id: 'permit',
								label: 'Check the city permit',
								kind: 'ideal',
								needs: 'Signed event date and permit reference',
								produces: 'Authoritative permit status',
								acceptance: 'Read the city record; no inferred approval',
								evidenceIds: ['manual-procedure']
							}
				],
				uncertainties: story.capability ? [] : ['No city-permit integration is installed.']
			}
		})
	if (!got('research_record'))
		return call('research_record', {
			items: [
				{
					requirement: 'Identify the previous manual procedure',
					finding: story.outcome,
					status: 'supported',
					sources: [{ sourceId: source.sourceId, quote: story.history }]
				}
			]
		})
	return answer(
		`I found the recorded ${story.key} procedure. Please confirm the case in Studio. ${story.capability ? 'Nothing has run.' : 'The permit lookup is an ideal step, not an implemented action.'}`
	)
}
