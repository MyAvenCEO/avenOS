import { todoLogic, todoStyle, todoView, withBrand } from '@avenos/aven-vibes'
import { describe, expect, test } from 'bun:test'
import { loadVibe } from '../src/vibe-registry'

// board 0095 — prove the DB-loaded vibe bundle IS the file definition (so the engine renders the same
// tree). jsonb reorders object keys, so compare a CANONICAL form (keys sorted recursively). Needs the
// DB (run with `bun --env-file=../../.env.samuel test`); skips cleanly when no DB / not seeded.

const canon = (v: unknown): unknown =>
	Array.isArray(v)
		? v.map(canon)
		: v && typeof v === 'object'
			? Object.fromEntries(
					Object.keys(v as Record<string, unknown>)
						.sort()
						.map((k) => [k, canon((v as Record<string, unknown>)[k])])
				)
			: v

describe('vibe.* registry (board 0095)', () => {
	test('the todos bundle loaded FROM THE DB equals the file definition (view/style/logic)', async () => {
		let bundle: Awaited<ReturnType<typeof loadVibe>> = null
		try {
			bundle = await loadVibe('todos')
		} catch {
			console.warn('[vibe-registry] skipped — no DB connection')
			return
		}
		if (!bundle) {
			console.warn('[vibe-registry] skipped — `todos` not seeded in the DB')
			return
		}
		expect(canon(bundle.view)).toEqual(canon(todoView))
		// board 0115 — the STORED row is the raw file definition (extends:'brand'); the SERVED style is
		// composed base-under-own at serve time. Parity = served ≡ withBrand(file definition).
		expect(canon(bundle.style)).toEqual(canon(withBrand(todoStyle)))
		expect(bundle.logic).toBe(todoLogic)
	})
})
