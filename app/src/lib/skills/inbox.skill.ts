import inboxMachineSource from '../actors/inbox-machine.pl?raw'
import type { SkillDef } from './skill'

/**
 * The inbox skill — DECLARED + MOCKED: the one entrance. Mail and uploads
 * become intake cases, get classified once, and are routed by intent to
 * their destination skill — todo_intent(I) to todos, doc(D) to docs,
 * entity(E) to the brain; the unclear goes to a human. The flow and the
 * mocked intake view are real; the wiring to actual mail/OCR/LLM comes in
 * a later card (0157).
 */
export const inboxSkill: SkillDef = {
	id: 'inbox',
	name: 'Inbox',
	about:
		'The one entrance: mail and uploads become cases, get classified once, and are ' +
		'routed by intent to their destination skill — only the unclear goes to a human.',
	tags: ['inbox'],
	views: [{ key: 'inbox', name: 'Inbox' }],
	workflows: [
		{
			id: 'intake',
			name: 'Intake',
			about: 'Arrive → normalize → classify → route by intent.',
			nodes: [
				{
					id: 'mail-trigger',
					kind: 'trigger',
					name: 'E-mail',
					about: 'Watches the mailbox; every message and attachment becomes intake.',
					type: 'trigger:mail',
					provides: ['mail(M)'],
					config: { dedupe: 'message-id' }
				},
				{
					id: 'upload-trigger',
					kind: 'trigger',
					name: 'Upload',
					about: 'Drag & drop and share-sheet: the manual door into the same lane.',
					type: 'trigger:upload',
					provides: ['upload(U)']
				},
				{
					id: 'normalize',
					kind: 'op',
					name: 'Normalize',
					about: 'Whatever arrived becomes one clean envelope: source, time, text, files.',
					type: 'op:normalize',
					requires: ['mail(M)', 'upload(U)'],
					provides: ['intake(I)'],
					machine: inboxMachineSource,
					config: { envelope: ['source', 'time', 'text', 'attachments'], dedupe: 'hash' }
				},
				{
					id: 'classify',
					kind: 'op',
					name: 'Classify',
					about: 'One intent per case, measured against a threshold — below it: unknown.',
					type: 'llm:classify',
					requires: ['intake(I)'],
					provides: ['intent(I, Class)'],
					config: {
						classes: ['todo', 'document', 'entity'],
						threshold: 0.8,
						belowThreshold: 'unknown'
					}
				},
				{
					id: 'route',
					kind: 'op',
					name: 'Route by intent',
					about: 'Exactly one branch fires per case — the intent decides, nobody else.',
					type: 'route:intent',
					requires: ['intent(I, Class)'],
					provides: ['todo_intent(I)', 'doc(D)', 'entity(E)', 'unknown_item(I)']
				},
				{
					id: 'queue-view',
					kind: 'output',
					name: 'Intake queue',
					about: 'What arrived and where it went — the unclear waiting for a human.',
					type: 'view:queue',
					requires: ['unknown_item(I)'],
					provides: ['queued']
				}
			]
		}
	]
}
