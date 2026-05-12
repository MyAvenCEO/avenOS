import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type { DispatcherState, IntentState, UserAttachment } from '@jaensen/conversation-actors'

export interface DispatcherPromptInput {
	state: DispatcherState
	envelope: EnvelopeRecord
	userInput: {
		text: string
		attachments: UserAttachment[]
	}
}

export interface IntentPromptInput {
	state: IntentState
	envelope: EnvelopeRecord
	availableSkills: Array<{
		id: string
		description: string
	}>
}

export function buildDispatcherPrompt(input: DispatcherPromptInput): string {
	return [
		'Role: dispatcher',
		'Return only a structured decision matching the provided schema.',
		'Do not invent extra keys.',
		'',
		'Current DispatcherState:',
		jsonBlock(input.state),
		'',
		'Active intents list:',
		jsonBlock(Object.values(input.state.activeIntents)),
		'',
		'Incoming user text:',
		input.userInput.text,
		'',
		'Attachments metadata:',
		jsonBlock(input.userInput.attachments.map(toAttachmentMetadata)),
		'',
		'Incoming envelope:',
		jsonBlock(input.envelope),
		'',
		'Hard rules:',
		'- decide route_existing_intent or create_intent',
		'- create intent only for a distinct user goal',
		'- do not solve the task',
		'- do not call skills',
		'- do not ask user questions'
	].join('\n')
}

export function buildIntentPrompt(input: IntentPromptInput): string {
	return [
		'Role: intent controller',
		'Return only a structured decision matching the provided schema.',
		'Do not invent extra keys.',
		'Do not return prose, markdown fences, or a string summary.',
		'',
		'Current IntentState:',
		jsonBlock(input.state),
		'',
		'Incoming envelope:',
		jsonBlock(input.envelope),
		'',
		'Available skills (id + description only):',
		jsonBlock(input.availableSkills),
		'',
		'Pending skill calls:',
		jsonBlock(Object.values(input.state.pendingSkillCalls)),
		'',
		'Required output shape:',
		jsonBlock({
			state: {
				intentId: input.state.intentId,
				title: input.state.title,
				goal: input.state.goal,
				status: input.state.status,
				summary: input.state.summary,
				pendingSkillCalls: input.state.pendingSkillCalls
			},
			events: [
				{ eventType: 'optional.event_type', event: { note: 'optional event payload' } }
			],
			actions: [
				{ type: 'call_skill', skillId: '<skill-id>', callId: '<unique-call-id>', request: '<request>', payload: {} },
				{ type: 'reply_user', message: '<message>' },
				{ type: 'ask_user', question: '<question>' },
				{ type: 'complete', summary: '<summary>', message: '<optional final user message>' },
				{ type: 'fail', reason: '<reason>', message: '<optional final user message>' }
			]
		}),
		'',
		'Hard rules:',
		'- you own the user intent',
		'- you may call skills only',
		'- you may not call workers/tools/shell/filesystem',
		'- only ask user when blocked',
		'- continue work after skill results',
		'- always return full updated state',
		'- actions must be objects, never strings',
		'- every action.type must be exactly one of: call_skill, reply_user, ask_user, complete, fail',
		'- if you call a skill, include skillId, callId, request, and payload',
		'- do not wrap output in data/result/decision/output'
	].join('\n')
}

function toAttachmentMetadata(attachment: UserAttachment) {
	return {
		id: attachment.id,
		path: attachment.path,
		mimeType: attachment.mimeType,
		name: attachment.name
	}
}

function jsonBlock(value: unknown): string {
	return JSON.stringify(value, null, 2)
}