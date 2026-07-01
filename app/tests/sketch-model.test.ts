import { beforeEach, describe, expect, test } from 'bun:test'
import {
	addStroke,
	clearSelection,
	createSketch,
	deleteSelection,
	eraseAt,
	moveSelection,
	pointNearStroke,
	type SketchState,
	type Stroke,
	selectInRect
} from '../src/lib/draw/sketch-model'

// Board 0060 — the metric's core. The `/draw` main is a thin canvas renderer over
// this pure model, so proving add / erase / select / move here proves the behaviour
// the UI relies on, without any DOM.

function line(id: string, from: [number, number], to: [number, number]): Omit<Stroke, never> {
	return {
		id,
		color: '#111',
		width: 3,
		points: [
			{ x: from[0], y: from[1] },
			{ x: to[0], y: to[1] }
		]
	}
}

/** Fetch a stroke by id, failing the test loudly if it's gone (avoids non-null `!`). */
function byId(s: SketchState, id: string): Stroke {
	const found = s.strokes.find((k) => k.id === id)
	if (!found) throw new Error(`stroke ${id} not found`)
	return found
}

let state: SketchState

beforeEach(() => {
	state = createSketch()
})

describe('addStroke', () => {
	test('adds a stroke and records its points', () => {
		const id = addStroke(state, line('a', [0, 0], [10, 0]))
		expect(state.strokes.length).toBe(1)
		expect(id).toBe('a')
		expect(state.strokes[0].points).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 }
		])
	})

	test('generates an id when none is given', () => {
		const id = addStroke(state, { color: '#111', width: 3, points: [{ x: 1, y: 1 }] })
		expect(id).toBeTruthy()
		expect(state.strokes[0].id).toBe(id)
	})
})

describe('eraseAt (whole-stroke, on hit)', () => {
	test('removes only the stroke within radius and leaves the others', () => {
		addStroke(state, line('a', [0, 0], [10, 0])) // horizontal at y=0
		addStroke(state, line('b', [0, 100], [10, 100])) // far away at y=100

		const removed = eraseAt(state, { x: 5, y: 1 }, 3) // within 3px of stroke a

		expect(removed).toEqual(['a'])
		expect(state.strokes.map((s) => s.id)).toEqual(['b'])
	})

	test('removes nothing when the point is beyond the radius', () => {
		addStroke(state, line('a', [0, 0], [10, 0]))
		const removed = eraseAt(state, { x: 5, y: 50 }, 3)
		expect(removed).toEqual([])
		expect(state.strokes.length).toBe(1)
	})

	test('drops erased ids from the selection', () => {
		addStroke(state, line('a', [0, 0], [10, 0]))
		selectInRect(state, { x: -1, y: -1, w: 12, h: 2 })
		expect(state.selectedIds.has('a')).toBe(true)
		eraseAt(state, { x: 5, y: 0 }, 3)
		expect(state.selectedIds.has('a')).toBe(false)
	})
})

describe('selectInRect', () => {
	test('selects strokes inside the rect and excludes ones outside', () => {
		addStroke(state, line('inside', [10, 10], [20, 20]))
		addStroke(state, line('outside', [200, 200], [210, 210]))

		const ids = selectInRect(state, { x: 0, y: 0, w: 50, h: 50 })

		expect(ids).toEqual(['inside'])
		expect([...state.selectedIds]).toEqual(['inside'])
	})

	test('normalises a rect dragged up-and-left (negative w/h)', () => {
		addStroke(state, line('inside', [10, 10], [20, 20]))
		// Drag started at (50,50) and ended at (0,0): negative width/height.
		const ids = selectInRect(state, { x: 50, y: 50, w: -50, h: -50 })
		expect(ids).toEqual(['inside'])
	})
})

describe('moveSelection', () => {
	test('translates only selected strokes; others stay put', () => {
		addStroke(state, line('sel', [0, 0], [10, 0]))
		addStroke(state, line('fixed', [0, 100], [10, 100]))
		selectInRect(state, { x: -1, y: -1, w: 12, h: 2 }) // selects 'sel'

		moveSelection(state, 5, 7)

		const sel = byId(state, 'sel')
		const fixed = byId(state, 'fixed')
		expect(sel.points).toEqual([
			{ x: 5, y: 7 },
			{ x: 15, y: 7 }
		])
		expect(fixed.points).toEqual([
			{ x: 0, y: 100 },
			{ x: 10, y: 100 }
		])
	})

	test('is a no-op with an empty selection', () => {
		addStroke(state, line('a', [0, 0], [10, 0]))
		clearSelection(state)
		moveSelection(state, 5, 5)
		expect(state.strokes[0].points).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 }
		])
	})
})

describe('deleteSelection', () => {
	test('removes selected strokes and clears the selection', () => {
		addStroke(state, line('a', [0, 0], [10, 0]))
		addStroke(state, line('b', [0, 100], [10, 100]))
		selectInRect(state, { x: -1, y: -1, w: 12, h: 2 }) // 'a'
		const removed = deleteSelection(state)
		expect(removed).toEqual(['a'])
		expect(state.strokes.map((s) => s.id)).toEqual(['b'])
		expect(state.selectedIds.size).toBe(0)
	})
})

describe('pointNearStroke', () => {
	test('true within tolerance, false beyond it', () => {
		const stroke: Stroke = { id: 'a', color: '#111', width: 3, points: [{ x: 0, y: 0 }] }
		expect(pointNearStroke(stroke, { x: 2, y: 0 }, 3)).toBe(true)
		expect(pointNearStroke(stroke, { x: 10, y: 0 }, 3)).toBe(false)
	})
})
