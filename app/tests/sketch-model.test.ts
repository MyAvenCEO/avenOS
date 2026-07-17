import { beforeEach, describe, expect, test } from 'bun:test'
import {
	addImage,
	addStroke,
	clampScale,
	clearSelection,
	createSketch,
	deleteSelection,
	eraseAt,
	imageAt,
	imageHandleAt,
	MAX_SCALE,
	MIN_SCALE,
	moveSelection,
	pointNearStroke,
	resizeImageByHandle,
	type SketchImage,
	type SketchState,
	type Stroke,
	screenToWorld,
	selectInRect,
	type Viewport,
	worldToScreen,
	zoomAround
} from '../src/lib/draw/sketch-model'

// Board 0060/0061 — the metric's core. The Draw canvas is a thin renderer over this pure
// model, so proving add / erase / select / move, the viewport transforms (zoom/pan), and
// image placement / hit-test / handle-resize here proves the behaviour the UI relies on,
// without any DOM.

function img(id: string, x: number, y: number, w: number, h: number): Omit<SketchImage, never> {
	return { id, src: 'data:,x', x, y, w, h }
}

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

// ── 0061: viewport (zoom/pan) ────────────────────────────────────────────────

describe('viewport transforms', () => {
	test('screenToWorld ∘ worldToScreen is identity', () => {
		const vp: Viewport = { scale: 2.5, tx: 40, ty: -15 }
		const s = worldToScreen(vp, 12, 34)
		const w = screenToWorld(vp, s.x, s.y)
		expect(w.x).toBeCloseTo(12)
		expect(w.y).toBeCloseTo(34)
	})

	test('clampScale bounds to [MIN_SCALE, MAX_SCALE] (≥10× available)', () => {
		expect(clampScale(0.001)).toBe(MIN_SCALE)
		expect(clampScale(999)).toBe(MAX_SCALE)
		expect(MAX_SCALE).toBeGreaterThanOrEqual(10)
		expect(clampScale(3)).toBe(3)
	})

	test('zoomAround keeps the focal screen point fixed', () => {
		const vp: Viewport = { scale: 1, tx: 0, ty: 0 }
		const focal = { x: 200, y: 120 }
		const worldBefore = screenToWorld(vp, focal.x, focal.y)
		const next = zoomAround(vp, focal.x, focal.y, 4)
		expect(next.scale).toBe(4)
		const screenAfter = worldToScreen(next, worldBefore.x, worldBefore.y)
		expect(screenAfter.x).toBeCloseTo(focal.x)
		expect(screenAfter.y).toBeCloseTo(focal.y)
	})

	test('zoomAround clamps past the max', () => {
		const vp: Viewport = { scale: 5, tx: 0, ty: 0 }
		expect(zoomAround(vp, 0, 0, 100).scale).toBe(MAX_SCALE)
	})
})

// ── 0061: images (place / hit-test / handles / resize) ───────────────────────

describe('images', () => {
	test('addImage appends and imageAt returns the topmost under a point', () => {
		addImage(state, img('back', 0, 0, 100, 100))
		addImage(state, img('front', 40, 40, 100, 100)) // overlaps 'back' at (50,50)
		expect(state.images.length).toBe(2)
		expect(imageAt(state, { x: 50, y: 50 })?.id).toBe('front') // last drawn wins
		expect(imageAt(state, { x: 5, y: 5 })?.id).toBe('back')
		expect(imageAt(state, { x: 500, y: 500 })).toBeUndefined()
	})

	test('imageHandleAt hits a corner within tolerance', () => {
		const i = { ...img('a', 10, 10, 80, 60) }
		expect(imageHandleAt(i, { x: 11, y: 11 }, 5)).toBe('nw')
		expect(imageHandleAt(i, { x: 90, y: 70 }, 5)).toBe('se')
		expect(imageHandleAt(i, { x: 50, y: 40 }, 5)).toBeNull()
	})

	test('resizeImageByHandle(se) grows from the top-left anchor', () => {
		const i = { ...img('a', 10, 10, 80, 60) }
		resizeImageByHandle(i, 'se', { x: 210, y: 160 })
		expect(i).toMatchObject({ x: 10, y: 10, w: 200, h: 150 })
	})

	test('resizeImageByHandle(nw) holds the bottom-right anchor', () => {
		const i = { ...img('a', 10, 10, 80, 60) } // br = (90, 70)
		resizeImageByHandle(i, 'nw', { x: 0, y: 0 })
		expect(i).toMatchObject({ x: 0, y: 0, w: 90, h: 70 })
	})

	test('resize is clamped to the min size (cannot cross the anchor)', () => {
		const i = { ...img('a', 10, 10, 80, 60) }
		resizeImageByHandle(i, 'se', { x: 0, y: 0 }, 24) // dragged past the NW anchor
		expect(i.w).toBe(24)
		expect(i.h).toBe(24)
	})
})

describe('selection across strokes + images', () => {
	test('selectInRect selects an image whose bounds overlap the rect', () => {
		addImage(state, img('pic', 20, 20, 40, 40))
		addStroke(state, line('near', [200, 200], [210, 210]))
		const ids = selectInRect(state, { x: 0, y: 0, w: 100, h: 100 })
		expect(ids).toEqual(['pic'])
	})

	test('moveSelection translates a selected image', () => {
		addImage(state, img('pic', 20, 20, 40, 40))
		selectInRect(state, { x: 0, y: 0, w: 100, h: 100 })
		moveSelection(state, 5, -3)
		expect(state.images[0]).toMatchObject({ x: 25, y: 17 })
	})

	test('deleteSelection removes selected images too', () => {
		addImage(state, img('pic', 20, 20, 40, 40))
		addStroke(state, line('keep', [300, 300], [310, 310]))
		selectInRect(state, { x: 0, y: 0, w: 100, h: 100 }) // just the image
		const removed = deleteSelection(state)
		expect(removed).toEqual(['pic'])
		expect(state.images.length).toBe(0)
		expect(state.strokes.map((s) => s.id)).toEqual(['keep'])
	})
})
