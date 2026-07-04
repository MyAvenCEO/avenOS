// board 0113 — the PROMOTION step actors: skillify's stepwise flow (one actor per step, each with its
// own reactable card — the Planner-mode pattern): plan_app → mint_data → wire_actors → seed_data →
// promote. Steps are STATELESS across turns (keyed by the mockup name) and idempotent — the human reacts
// to each card in chat ("go on" / "change X" / "skip seeding") and the model calls the next step.

import type { ToolActor, ToolDefinition, ToolResult } from './types'

const nameParam = {
	name: { type: 'string', description: 'The mockup being promoted (kebab-case or plain words).' },
	response: { type: 'string', description: 'A short human-facing reply to show the user.' }
}

function def(name: string, description: string, extra: Record<string, unknown> = {}): ToolDefinition {
	return {
		type: 'function',
		function: {
			name,
			description,
			parameters: { type: 'object', properties: { ...nameParam, ...extra }, required: ['name'] }
		}
	}
}

const noCap: ToolResult = { content: { ok: false, error: 'promote capability not available' } }
type Raw = { name?: string; response?: string; skip?: boolean }
const said = (raw: Raw): string => (typeof raw.response === 'string' ? raw.response.trim() : '')
/** board 0113 — a FAILED step is spoken out loud and the model is told to stay on this step: silent
 *  errors made gemma wander off to other tools ("mint failed" → listed mockups) instead of retrying. */
/** The pipeline STEPPER card, shown on EVERY promotion step (Samuel: the progress bar must ride
 *  along) — same skill-plan vibe, only `step` advances; the card's DB logic maps it to done/current. */
type Skeleton = {
	app: string
	entities: { key: string; type: string; fields: string[] }[]
	aggregates: string[]
}
const stepper = (sk: Skeleton, source: Record<string, unknown>, step: string) => ({
	schema: 'skill-plan',
	data: {
		app: sk.app,
		step,
		entities: sk.entities.map((e) => ({
			type: e.type,
			fields: e.fields,
			seedRows: Array.isArray(source[e.key]) ? (source[e.key] as unknown[]).length : 0
		})),
		aggregates: sk.aggregates
	}
})
const stepFailed = (step: string, error: string): ToolResult => ({
	detail: `${step} failed`,
	content: {
		ok: false,
		error,
		note: `Step "${step}" FAILED. Do NOT call any other tool. Tell the user the error verbatim and that saying "nochmal" retries this step.`
	},
	reply: `⚠️ Schritt „${step}" fehlgeschlagen: ${error} — sag „nochmal", um es erneut zu versuchen.`
})

export const planApp: ToolActor = {
	definition: def(
		'plan_app',
		'STEP 1 of promoting a mockup to a real skill: derive + show the APP PLAN (entities from the ' +
			'example data, their fields, computed aggregates, seed counts). Use when the user says ' +
			'"skillify/promote the X mockup". The next step after the user agrees is mint_data.'
	),
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.promote) return noCap
		const r = raw as Raw
		const got = await ctx.promote.skeletonOf(String(r.name ?? ''))
		if (!got)
			return stepFailed(
				'plan_app',
				`no mockup named "${r.name}". Existing mockups: ${(await ctx.promote.available()).join(', ') || '(none)'} — retry with the exact name.`
			)
		const { skeleton, source } = got
		// the pipeline's MEMORY: the card + the model both get the TRUE progress derived from the DB,
		// so re-planning after a derail resumes where the promotion actually stands.
		const p = await ctx.promote.progress(skeleton)
		const card = stepper(skeleton, source, p.step)
		const plan = { app: card.data.app, entities: card.data.entities, aggregates: card.data.aggregates }
		const resumed = p.step !== 'plan'
		return {
			detail: `plan ${skeleton.app}`,
			content: {
				ok: true,
				plan,
				progress: p,
				next_step: p.next,
				note: resumed
					? `This promotion is ALREADY at "${p.step}" — do NOT restart. The next step is ${p.next ?? 'nothing (live)'}.`
					: 'The plan card is shown. Summarize in ONE sentence and ask whether to continue with mint_data.'
			},
			reply:
				said(r) ||
				(p.next === null
					? `"${skeleton.app}" ist bereits live — fertig promotet. 🎉`
					: resumed
						? `„${skeleton.app}" steht schon bei „${p.step}" — nächster Schritt: ${p.next}. Weiter?`
						: `Here is the plan for "${skeleton.app}" — continue with the data layer?`),
			vibe: card
		}
	}
}

export const mintData: ToolActor = {
	definition: def(
		'mint_data',
		'STEP 2: mint the DATA layer for the app being promoted — Lojban predicates (reuse or mint via ' +
			'the Ontology engine) + the bundle + the derived CRUD ops. Run only after plan_app was agreed.'
	),
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.promote) return noCap
		const r = raw as Raw
		const got = await ctx.promote.skeletonOf(String(r.name ?? ''))
		if (!got)
			return stepFailed(
				'mint_data',
				`no mockup named "${r.name}". Existing mockups: ${(await ctx.promote.available()).join(', ') || '(none)'} — retry with the exact name.`
			)
		const res = await ctx.promote.mintData(got.skeleton, got.source)
		if (res.error) return stepFailed('mint_data', res.error)
		// the x1–x5 VOCABULARY card (board 0113): full place structures for every MINTED predicate +
		// the reused ones — the ontology-created card renders exactly this detail.
		return {
			detail: `mint ${got.skeleton.app} data`,
			content: {
				ok: true,
				types: res.types,
				minted: res.minted?.map((d) => d.predicate),
				reused: res.reused,
				next_step: 'wire_actors',
				note: 'The vocabulary card (x1–x5 places) is shown. ONE sentence; next step is wire_actors.'
			},
			reply:
				said(r) ||
				`Data layer ready: type ${res.types?.map((t) => t.type).join(', ')} — ${res.minted?.length ?? 0} predicates minted, ${res.reused?.length ?? 0} reused. Wire the actors next?`,
			vibe: [
				stepper(got.skeleton, got.source, 'data'),
				{ schema: 'ontology-created', data: { created: res.minted ?? [], reused: res.reused ?? [] } }
			]
		}
	}
}

export const wireActors: ToolActor = {
	definition: def(
		'wire_actors',
		'STEP 3: create the new SKILL row + its actors — the generic data_crud and the SANDBOXED overview ' +
			'actor (GLM-authored code, smoke-run gated). Run only after mint_data succeeded.'
	),
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.promote) return noCap
		const r = raw as Raw
		const got = await ctx.promote.skeletonOf(String(r.name ?? ''))
		if (!got)
			return stepFailed(
				'wire_actors',
				`no mockup named "${r.name}". Existing mockups: ${(await ctx.promote.available()).join(', ') || '(none)'} — retry with the exact name.`
			)
		const pre = await ctx.promote.progress(got.skeleton)
		if (!pre.data)
			return stepFailed('wire_actors', `die Datenschicht fehlt noch — nächster Schritt: ${pre.next}.`)
		const res = await ctx.promote.wire(got.skeleton, got.source)
		if (res.error) return stepFailed('wire_actors', res.error)
		return {
			detail: `wire ${res.skillId}`,
			content: {
				ok: true,
				skillId: res.skillId,
				sandboxBytes: res.code?.length ?? 0,
				next_step: 'seed_data',
				note: 'The wiring card is shown. ONE sentence; next step is seed_data (skippable) then promote.'
			},
			reply:
				said(r) ||
				`Skill "${res.skillId}" wired (sandbox actor smoke-tested). Seed the example rows, or skip to promote?`,
			vibe: stepper(got.skeleton, got.source, 'wired')
		}
	}
}

export const seedDataActor: ToolActor = {
	definition: def(
		'seed_data',
		'STEP 4 (skippable): write the mockup\'s example rows as REAL data through the derived create op. ' +
			'Pass skip:true to skip when the user declines seeding.',
		{ skip: { type: 'boolean', description: 'Skip seeding (the user declined).' } }
	),
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.promote) return noCap
		const r = raw as Raw
		if (r.skip)
			return {
				detail: 'seed skipped',
				content: { ok: true, skipped: true, note: 'Seeding skipped. Next step is promote.' },
				reply: said(r) || 'Skipped seeding — promoting next.'
			}
		const got = await ctx.promote.skeletonOf(String(r.name ?? ''))
		if (!got)
			return stepFailed(
				'seed_data',
				`no mockup named "${r.name}". Existing mockups: ${(await ctx.promote.available()).join(', ') || '(none)'} — retry with the exact name.`
			)
		const pre = await ctx.promote.progress(got.skeleton)
		if (!pre.wired)
			return stepFailed('seed_data', `der Skill ist noch nicht verdrahtet — nächster Schritt: ${pre.next}.`)
		const res = await ctx.promote.seed(got.skeleton, got.source)
		const total = Object.values(res.seeded).reduce((a, b) => a + b, 0)
		return {
			detail: `seed ${got.skeleton.app}`,
			content: { ok: true, seeded: res.seeded, next_step: 'promote', note: 'Seeded. ONE sentence; final step is promote.' },
			reply: said(r) || `Seeded ${total} example row(s). Promote the app now?`,
			vibe: [
				stepper(got.skeleton, got.source, 'seeded'),
				{
					schema: 'todos-created',
					data: {
						items: got.skeleton.entities.flatMap((e) =>
							(got.source[e.key] as Record<string, unknown>[]).map((row) => ({
								title: String(row[e.fields.find((f) => ['name', 'title', 'label'].includes(f)) ?? e.fields[0]] ?? '—')
							}))
						)
					}
				}
			]
		}
	}
}

export const improveSkillActor: ToolActor = {
	definition: def(
		'improve_skill',
		'IMPROVE a promoted (live) skill: bake a user rule into its data behavior — number formats ' +
			'("German 25,33 €"), sign conventions ("bought/purchase = negative"), defaults, wording. ' +
			'Pass the skill name + the rule. Only for LIVE skills — mockup looks change via edit_mockup.',
		{ instruction: { type: 'string', description: "The rule to bake in, in the user's words." } }
	),
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.promote) return noCap
		const r = raw as Raw & { instruction?: string }
		const instruction = String(r.instruction ?? '').trim()
		if (!instruction) return { content: { ok: false, error: 'describe the rule to bake in' } }
		const res = await ctx.promote.improve(String(r.name ?? ''), instruction)
		if (res.error || !res.app) return stepFailed('improve_skill', res.error ?? 'improve failed')
		return {
			detail: `improve ${res.app}`,
			content: {
				ok: true,
				app: res.app,
				description: res.description,
				note: 'The rule is baked into the skill config. ONE short sentence; future entries follow it.'
			},
			reply: said(r) || `Skill „${res.app}" verbessert — die Regel gilt ab der nächsten Eingabe.`
		}
	}
}

export const promoteApp: ToolActor = {
	definition: def(
		'promote',
		'FINAL STEP: promote the vibe (mock-<name> → <name>) and show the finished app rendered with REAL ' +
			'data via its sandbox actor. Run only after wire_actors (and optionally seed_data).'
	),
	async handle(ctx, raw): Promise<ToolResult> {
		if (!ctx.promote) return noCap
		const r = raw as Raw
		const got = await ctx.promote.skeletonOf(String(r.name ?? ''))
		if (!got)
			return stepFailed(
				'promote',
				`no mockup named "${r.name}". Existing mockups: ${(await ctx.promote.available()).join(', ') || '(none)'} — retry with the exact name.`
			)
		const pre = await ctx.promote.progress(got.skeleton)
		if (!pre.wired)
			return stepFailed('promote', `der Skill ist noch nicht verdrahtet — nächster Schritt: ${pre.next}.`)
		await ctx.promote.promoteVibe(got.skeleton.app)
		return {
			detail: `promote ${got.skeleton.app}`,
			content: {
				ok: true,
				app: got.skeleton.app,
				note: `Promoted. Tell the user the app is live — they can say "show my ${got.skeleton.app.replace(/-/g, ' ')}" or add entries in chat.`
			},
			reply: said(r) || `"${got.skeleton.app}" is live — a real skill over real data. 🎉`,
			// the overview code actor renders it with REAL data from here on; this final card shows the
			// promoted vibe with its (now seeded) example-shaped state via the actor on the NEW skill.
			vibe: [stepper(got.skeleton, got.source, 'live'), { schema: got.skeleton.app }]
		}
	}
}
