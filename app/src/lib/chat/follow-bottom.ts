/** Follow content/layout growth until the reader scrolls upwards. No polling. */
export function followBottom(node: HTMLElement, key: string | null) {
	let following = true
	let previousTop = node.scrollTop
	let queued = false
	let disposed = false
	let touchY: number | undefined
	const oldAnchor = node.style.overflowAnchor
	node.style.overflowAnchor = 'none'
	const bottom = () => node.scrollHeight - node.clientHeight - node.scrollTop <= 4
	const scroll = () => {
		if (key === null) return
		if (node.scrollTop < previousTop - 1) following = false
		else if (bottom()) following = true
		previousTop = node.scrollTop
	}
	const schedule = () => {
		if (queued || disposed) return
		queued = true
		queueMicrotask(() => {
			queued = false
			if (disposed || key === null || !following) return
			node.scrollTop = node.scrollHeight
			previousTop = node.scrollTop
		})
	}
	// Stop before a pending layout callback can fight an upward gesture.
	const wheel = (event: WheelEvent) => {
		if (event.deltaY < 0) following = false
	}
	const touchStart = (event: TouchEvent) => {
		touchY = event.touches[0]?.clientY
	}
	const touchMove = (event: TouchEvent) => {
		const y = event.touches[0]?.clientY
		if (y !== undefined && touchY !== undefined && y > touchY) following = false
		touchY = y
	}
	const keyboard = (event: KeyboardEvent) => {
		if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
		if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey))
			following = false
	}
	const resize = new ResizeObserver(schedule)
	const observed = new Set<Element>()
	const observe = () => {
		for (const child of observed)
			if (child.parentElement !== node) {
				resize.unobserve(child)
				observed.delete(child)
			}
		for (const child of node.children)
			if (!observed.has(child)) {
				observed.add(child)
				resize.observe(child)
			}
		schedule()
	}
	resize.observe(node)
	const mutations = new MutationObserver(observe)
	mutations.observe(node, { childList: true, subtree: true, characterData: true, attributes: true })
	node.addEventListener('scroll', scroll, { passive: true })
	node.addEventListener('wheel', wheel, { passive: true })
	node.addEventListener('touchstart', touchStart, { passive: true })
	node.addEventListener('touchmove', touchMove, { passive: true })
	node.addEventListener('keydown', keyboard)
	observe()
	return {
		update(next: string | null) {
			if (next === key) return
			key = next
			following = true
			schedule()
		},
		destroy() {
			disposed = true
			mutations.disconnect()
			resize.disconnect()
			node.removeEventListener('scroll', scroll)
			node.removeEventListener('wheel', wheel)
			node.removeEventListener('touchstart', touchStart)
			node.removeEventListener('touchmove', touchMove)
			node.removeEventListener('keydown', keyboard)
			node.style.overflowAnchor = oldAnchor
		}
	}
}
