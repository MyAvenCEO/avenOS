/**
 * Pure sketch model for the `/draw` scratchpad main — all state + geometry, no DOM.
 *
 * The `DrawCanvas.svelte` renderer is a thin layer over this: it feeds pointer/pen
 * samples in and paints the resulting `SketchState` out. Keeping the logic here (and
 * DOM-free) is what makes the drawing behaviour unit-testable — see
 * `app/tests/sketch-model.test.ts`. Strokes are vectors (arrays of points), which is
 * what lets the eraser and select tools hit-test without touching pixels.
 *
 * In-memory only: nothing here persists. State lives for the lifetime of the view.
 */

export type Point = { x: number; y: number; pressure?: number }

export type Stroke = {
	id: string
	points: Point[]
	/** CSS colour string (e.g. `#111`). */
	color: string
	/** Base width in CSS px; the renderer may scale per-point by `pressure`. */
	width: number
}

export type Rect = { x: number; y: number; w: number; h: number }

export type SketchState = {
	strokes: Stroke[]
	/** Ids of strokes currently selected (by the select tool). */
	selectedIds: Set<string>
}

export function createSketch(): SketchState {
	return { strokes: [], selectedIds: new Set() }
}

/** Monotonic id source — no `Math.random`/`Date.now` so behaviour stays deterministic. */
let strokeSeq = 0
export function nextStrokeId(): string {
	strokeSeq += 1
	return `s${strokeSeq}`
}

/** Append a fully-formed stroke. Returns its id (generated when absent). */
export function addStroke(
	state: SketchState,
	stroke: Omit<Stroke, 'id'> & { id?: string }
): string {
	const id = stroke.id ?? nextStrokeId()
	state.strokes.push({ id, points: stroke.points, color: stroke.color, width: stroke.width })
	return id
}

/** Axis-aligned bounds of a stroke (a zero-area box for a single point). */
export function strokeBounds(stroke: Stroke): Rect {
	const first = stroke.points[0]
	if (!first) return { x: 0, y: 0, w: 0, h: 0 }
	let minX = first.x
	let minY = first.y
	let maxX = first.x
	let maxY = first.y
	for (const p of stroke.points) {
		if (p.x < minX) minX = p.x
		if (p.y < minY) minY = p.y
		if (p.x > maxX) maxX = p.x
		if (p.y > maxY) maxY = p.y
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Shortest distance from point `p` to segment `a`–`b`. */
function distToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const lenSq = dx * dx + dy * dy
	if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
	t = Math.max(0, Math.min(1, t))
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** True when `point` lands within `tol` px of any part of the stroke. */
export function pointNearStroke(stroke: Stroke, point: Point, tol: number): boolean {
	const pts = stroke.points
	if (pts.length === 0) return false
	if (pts.length === 1) return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= tol
	for (let i = 1; i < pts.length; i++) {
		if (distToSegment(point, pts[i - 1], pts[i]) <= tol) return true
	}
	return false
}

/**
 * Whole-stroke eraser: remove every stroke within `radius` of `point` and return
 * their ids. Whole-stroke (not pixel) removal is the simplest fit for a vector model.
 */
export function eraseAt(state: SketchState, point: Point, radius: number): string[] {
	const removed: string[] = []
	state.strokes = state.strokes.filter((stroke) => {
		if (pointNearStroke(stroke, point, radius)) {
			removed.push(stroke.id)
			return false
		}
		return true
	})
	for (const id of removed) state.selectedIds.delete(id)
	return removed
}

/** True when any point of the stroke falls inside `rect`. */
function strokeIntersectsRect(stroke: Stroke, rect: Rect): boolean {
	const x2 = rect.x + rect.w
	const y2 = rect.y + rect.h
	const minX = Math.min(rect.x, x2)
	const maxX = Math.max(rect.x, x2)
	const minY = Math.min(rect.y, y2)
	const maxY = Math.max(rect.y, y2)
	return stroke.points.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
}

/**
 * Select every stroke that intersects `rect`, replacing the current selection.
 * Returns the selected ids. Rects with negative w/h (dragged up/left) are normalised.
 */
export function selectInRect(state: SketchState, rect: Rect): string[] {
	const ids = state.strokes.filter((s) => strokeIntersectsRect(s, rect)).map((s) => s.id)
	state.selectedIds = new Set(ids)
	return ids
}

export function clearSelection(state: SketchState): void {
	state.selectedIds = new Set()
}

/** Translate every selected stroke by (dx, dy). No-op when nothing is selected. */
export function moveSelection(state: SketchState, dx: number, dy: number): void {
	if (state.selectedIds.size === 0) return
	for (const stroke of state.strokes) {
		if (!state.selectedIds.has(stroke.id)) continue
		for (const p of stroke.points) {
			p.x += dx
			p.y += dy
		}
	}
}

/** Delete the selected strokes; returns the removed ids. */
export function deleteSelection(state: SketchState): string[] {
	if (state.selectedIds.size === 0) return []
	const removed = state.strokes.filter((s) => state.selectedIds.has(s.id)).map((s) => s.id)
	state.strokes = state.strokes.filter((s) => !state.selectedIds.has(s.id))
	state.selectedIds = new Set()
	return removed
}
