import type { Manifest } from './actor'
import type { MessageBus } from './bus'
import { FlowActor } from './flow.actor'
import type { Recipe } from './flow-recipe'

/**
 * The Composer (0137) — RECIPE #1 of the flow engine. The six phases live
 * as six full step actors (composer-steps.ts); this file is only the
 * declared chain and the thin manifest naming the composer's tools. The
 * hand-rolled phase state machine of 0136 is gone — the generic FlowActor
 * runs the recipe, the prover validates it against the mesh at boot, and
 * every hop is a real commit on the continuation pump.
 *
 * Holds, as lived before: clarify may HOLD for the human (compose_answer
 * resumes), stage holds for the button-only Promote/Discard. The scrum
 * cycle is the declared onFail seam: draft and probe fall back to draft
 * with the membrane error riding in the brief — three runs, then the flow
 * fails for good with its full history.
 */

/**
 * The composer's model lane: designing is slow, careful work — every
 * composer completion runs kimi-k3; the voice lane stays fast.
 */
export const COMPOSER_SETTINGS = {
	model: 'moonshotai/kimi-k3',
	temperature: 0.3,
	json: true
}

export const COMPOSER_RECIPE: Recipe = {
	id: 'composer',
	name: 'Composer',
	inputs: ['wish(W)'],
	steps: [
		{ actor: 'clarify', label: 'Clarify', hold: 'human' },
		{ actor: 'scout', label: 'Scout' },
		// A plan that dies (lane failure, degeneration loop) gets ONE resample
		// — it shares the run's failure budget with the scrum cycle below.
		{ actor: 'plan', label: 'Plan', onFail: { backTo: 'plan', maxRuns: 2 } },
		// The face first (0138): shown live, iterated by voice (resume:'self'
		// re-enters with the feedback), validator failures re-enter silently.
		{
			actor: 'mockup',
			label: 'Mockup',
			hold: 'human',
			resume: 'self',
			onFail: { backTo: 'mockup', maxRuns: 3 }
		},
		{ actor: 'draft', label: 'Draft', onFail: { backTo: 'draft', maxRuns: 3 } },
		{ actor: 'probe', label: 'Probe', onFail: { backTo: 'draft', maxRuns: 3 } },
		{ actor: 'stage', label: 'Stage', hold: 'button' }
	]
}

const COMPOSER_MANIFEST: Manifest = {
	id: 'composer',
	name: 'Composer',
	description:
		'The ObjectCreator as recipe #1 of the flow engine: clarifies the wish ' +
		'with the HUMAN first, scouts the mesh (reuse before negotiate before ' +
		'compose), writes measurable proofs, lets the model design against them ' +
		'in scrum rounds, proves each draft behind the membrane, and stages the ' +
		'result as a live "next" instance. Promote (button-only) makes it ' +
		'production with a code export. Every phase is its own step actor.',
	tags: ['system'],
	methods: [
		{
			name: 'compose',
			description:
				'Turns a wish into a new actor through the composer recipe: it may ' +
				'first HOLD and ask the user clarify questions (the result carries ' +
				'clarifying=[...]) — relay the answer with compose_answer. It scouts ' +
				'the mesh first (an existing actor may simply be spawned instead), ' +
				'writes measurable proofs, designs in up to three rounds, and stages ' +
				'the result as a LIVE instance. Promotion happens ONLY by button — ' +
				'there is no promote tool, so never claim you promoted.',
			parameters: {
				type: 'object',
				properties: {
					wish: {
						type: 'string',
						description: 'What should exist, in the words of the human.'
					}
				},
				required: ['wish']
			},
			event: { send: 'START' }
		},
		{
			name: 'compose_answer',
			description:
				"The human's answer to the composer's clarify questions, verbatim. Call " +
				'this when the composer asked questions and the user just answered them ' +
				'— it resumes the compose flow.',
			parameters: {
				type: 'object',
				properties: {
					text: {
						type: 'string',
						description: "The user's answer, in their words."
					}
				},
				required: ['text']
			},
			event: { send: 'ANSWER' }
		}
	]
}

export class ComposerActor extends FlowActor {
	constructor(bus: MessageBus) {
		super(bus, COMPOSER_MANIFEST, COMPOSER_RECIPE)
	}
}
