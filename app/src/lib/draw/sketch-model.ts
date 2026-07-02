/**
 * Pure sketch model for the Draw scratchpad — all state + geometry, no DOM.
 *
 * The `DrawCanvas.svelte` renderer is a thin layer over this: it feeds pointer/pen
 * samples in and paints the resulting `SketchState` out. Keeping the logic here (and
 * DOM-free) is what makes the drawing behaviour unit-testable — see
 * `app/tests/sketch-model.test.ts`. Strokes and images are vectors in a single WORLD
 * coordinate space; the renderer maps world↔screen through a `Viewport` (pan + zoom),
 * so everything hit-tests without touching pixels.
 *
 * In-memory only: nothing here persists. State lives for the lifetime of the view.
 */

export type Point = { x: number; y: number; pressure?: number }

export type Stroke = {
	id: string
	points: Point[]
	/** CSS colour string (e.g. `#111`). */
	color: string
	/** Base width in WORLD px; the renderer may scale per-point by `pressure`. */
	width: number
}

/** A placed reference image (a data URL), positioned + sized in world px. */
export type SketchImage = { id: string; src: string; x: number; y: number; w: number; h: number }

export type Rect = { x: number; y: number; w: number; h: number }

export type SketchState = {
	strokes: Stroke[]
	images: SketchImage[]
	/** Ids of strokes OR images currently selected (by the select tool). */
	selectedIds: Set<string>
}

export function createSketch(): SketchState {
	return { strokes: [], images: [], selectedIds: new Set() }
}

/** Monotonic id source — no `Math.random`/`Date.now` so behaviour stays deterministic. */
let idSeq = 0
export function nextId(prefix: string): string {
	idSeq += 1
	return `${prefix}${idSeq}`
}

// ── Viewport (pan + zoom) ────────────────────────────────────────────────────
// A bounded zoom so the canvas scales "not infinitely but 10x": clamp to [MIN, MAX].

export type Viewport = { scale: number; tx: number; ty: number }

export const MIN_SCALE = 0.2
export const MAX_SCALE = 10

export function clampScale(s: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

/** Screen px → world px under the given viewport. */
export function screenToWorld(vp: Viewport, sx: number, sy: number): Point {
	return { x: (sx - vp.tx) / vp.scale, y: (sy - vp.ty) / vp.scale }
}

/** World px → screen px under the given viewport. */
export function worldToScreen(vp: Viewport, wx: number, wy: number): { x: number; y: number } {
	return { x: wx * vp.scale + vp.tx, y: wy * vp.scale + vp.ty }
}

/**
 * Zoom to `newScaleRaw` (clamped) while keeping the world point under the focal SCREEN
 * point fixed — the standard pinch/wheel-to-cursor zoom. Returns a fresh viewport.
 */
export function zoomAround(
	vp: Viewport,
	focalScreenX: number,
	focalScreenY: number,
	newScaleRaw: number
): Viewport {
	const scale = clampScale(newScaleRaw)
	const w = screenToWorld(vp, focalScreenX, focalScreenY)
	return { scale, tx: focalScreenX - w.x * scale, ty: focalScreenY - w.y * scale }
}

// ── Strokes ──────────────────────────────────────────────────────────────────

/** Append a fully-formed stroke. Returns its id (generated when absent). */
export function addStroke(
	state: SketchState,
	stroke: Omit<Stroke, 'id'> & { id?: string }
): string {
	const id = stroke.id ?? nextId('s')
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
 * Images are not erased — they are removed via select + delete.
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

// ── Images (placeable / resizable reference layer) ───────────────────────────

export type HandleId = 'nw' | 'ne' | 'se' | 'sw'
export const MIN_IMAGE_SIZE = 24

/** Append a placed image. Returns its id (generated when absent). */
export function addImage(
	state: SketchState,
	img: Omit<SketchImage, 'id'> & { id?: string }
): string {
	const id = img.id ?? nextId('img')
	state.images.push({ id, src: img.src, x: img.x, y: img.y, w: img.w, h: img.h })
	return id
}

export function imageBounds(img: SketchImage): Rect {
	return { x: img.x, y: img.y, w: img.w, h: img.h }
}

export function pointInImage(img: SketchImage, p: Point): boolean {
	return p.x >= img.x && p.x <= img.x + img.w && p.y >= img.y && p.y <= img.y + img.h
}

/** Topmost image (last drawn) under `p`, or undefined. */
export function imageAt(state: SketchState, p: Point): SketchImage | undefined {
	for (let i = state.images.length - 1; i >= 0; i--) {
		if (pointInImage(state.images[i], p)) return state.images[i]
	}
	return undefined
}

/** The four corner handles of an image, in world coords. */
export function imageHandles(img: SketchImage): { id: HandleId; x: number; y: number }[] {
	return [
		{ id: 'nw', x: img.x, y: img.y },
		{ id: 'ne', x: img.x + img.w, y: img.y },
		{ id: 'se', x: img.x + img.w, y: img.y + img.h },
		{ id: 'sw', x: img.x, y: img.y + img.h }
	]
}

/** The corner handle within `tol` of `p`, or null. */
export function imageHandleAt(img: SketchImage, p: Point, tol: number): HandleId | null {
	for (const h of imageHandles(img)) {
		if (Math.hypot(p.x - h.x, p.y - h.y) <= tol) return h.id
	}
	return null
}

/**
 * Resize `img` by dragging `handle` to world point `p`, holding the opposite corner
 * fixed. Free aspect ratio; the dragged corner is clamped so w/h never drop below
 * `minSize` (it can't cross the anchor). Mutates in place.
 */
export function resizeImageByHandle(
	img: SketchImage,
	handle: HandleId,
	p: Point,
	minSize = MIN_IMAGE_SIZE
): void {
	const right = img.x + img.w
	const bottom = img.y + img.h
	if (handle === 'se') {
		img.w = Math.max(minSize, p.x - img.x)
		img.h = Math.max(minSize, p.y - img.y)
	} else if (handle === 'nw') {
		const nx = Math.min(p.x, right - minSize)
		const ny = Math.min(p.y, bottom - minSize)
		img.x = nx
		img.y = ny
		img.w = right - nx
		img.h = bottom - ny
	} else if (handle === 'ne') {
		const ny = Math.min(p.y, bottom - minSize)
		img.y = ny
		img.w = Math.max(minSize, p.x - img.x)
		img.h = bottom - ny
	} else {
		// sw
		const nx = Math.min(p.x, right - minSize)
		img.x = nx
		img.w = right - nx
		img.h = Math.max(minSize, p.y - img.y)
	}
}

// ── Selection (strokes + images) ─────────────────────────────────────────────

/** Normalise a rect that may have negative w/h (dragged up/left). */
function normRect(rect: Rect): Rect {
	const x = Math.min(rect.x, rect.x + rect.w)
	const y = Math.min(rect.y, rect.y + rect.h)
	return { x, y, w: Math.abs(rect.w), h: Math.abs(rect.h) }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
	const na = normRect(a)
	const nb = normRect(b)
	return na.x < nb.x + nb.w && na.x + na.w > nb.x && na.y < nb.y + nb.h && na.y + na.h > nb.y
}

/** True when any point of the stroke falls inside `rect`. */
function strokeIntersectsRect(stroke: Stroke, rect: Rect): boolean {
	const n = normRect(rect)
	return stroke.points.some((p) => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h)
}

/**
 * Select every stroke or image that intersects `rect`, replacing the current
 * selection. Returns the selected ids. Rects with negative w/h are normalised.
 */
export function selectInRect(state: SketchState, rect: Rect): string[] {
	const ids = [
		...state.strokes.filter((s) => strokeIntersectsRect(s, rect)).map((s) => s.id),
		...state.images.filter((im) => rectsOverlap(imageBounds(im), rect)).map((im) => im.id)
	]
	state.selectedIds = new Set(ids)
	return ids
}

export function setSelection(state: SketchState, ids: string[]): void {
	state.selectedIds = new Set(ids)
}

export function clearSelection(state: SketchState): void {
	state.selectedIds = new Set()
}

/** Translate every selected stroke AND image by (dx, dy). No-op when nothing is selected. */
export function moveSelection(state: SketchState, dx: number, dy: number): void {
	if (state.selectedIds.size === 0) return
	for (const stroke of state.strokes) {
		if (!state.selectedIds.has(stroke.id)) continue
		for (const p of stroke.points) {
			p.x += dx
			p.y += dy
		}
	}
	for (const img of state.images) {
		if (!state.selectedIds.has(img.id)) continue
		img.x += dx
		img.y += dy
	}
}

/** Delete the selected strokes and images; returns the removed ids. */
export function deleteSelection(state: SketchState): string[] {
	if (state.selectedIds.size === 0) return []
	const removed = [
		...state.strokes.filter((s) => state.selectedIds.has(s.id)).map((s) => s.id),
		...state.images.filter((im) => state.selectedIds.has(im.id)).map((im) => im.id)
	]
	state.strokes = state.strokes.filter((s) => !state.selectedIds.has(s.id))
	state.images = state.images.filter((im) => !state.selectedIds.has(im.id))
	state.selectedIds = new Set()
	return removed
}
