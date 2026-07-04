import { describe, expect, test } from 'bun:test'
import { deriveOps } from '../src/derive-ops'
import { GOAL_SPEC, LOCATION_SPEC } from '../src/reify-specs'
import { validateMutationSpec, validateQuerySpec } from '../src/queries'

// board 0112 — SLICE 1 checkpoint: the reified goal/location bundles DERIVE into the four standard ops,
// and every derived op is a VALID spec the universal engine will run. No DB, no live data — this proves
// the modeling (identity-only girzu/stuzi primary + a `named` replace-label + owned_by) is executable
// before slice 2 migrates any real rows.

describe('board 0112 — reified goal/location bundles derive to valid ops', () => {
	for (const [label, spec] of [
		['goal', GOAL_SPEC],
		['location', LOCATION_SPEC]
	] as const) {
		test(`${label} bundle derives list/create/update/delete, all valid`, () => {
			const ops = deriveOps(spec)
			expect(ops.map((o) => o.name)).toEqual([
				`${label}.list`,
				`${label}.create`,
				`${label}.update`,
				`${label}.delete`
			])
			for (const op of ops) {
				const ok =
					op.kind === 'query' ? validateQuerySpec(op.spec) : validateMutationSpec(op.spec)
				const errs =
					op.kind === 'query' ? validateQuerySpec.errors : validateMutationSpec.errors
				expect(ok, `${op.name} valid — ${JSON.stringify(errs)}`).toBe(true)
			}
		})

		test(`${label}.list projects the name off the named join`, () => {
			const list = deriveOps(spec).find((o) => o.name === `${label}.list`)!.spec as {
				project: unknown[]
				join: { predicate: string }[]
			}
			// the name must come from a join (the `named` label), never an inline primary place.
			expect(list.join.some((j) => j.predicate === 'named')).toBe(true)
			expect(JSON.stringify(list.project)).toContain('"as":"name"')
		})
	}
})
