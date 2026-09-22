/** JSON objects are unordered; ordered procedure steps and collection members are not. */
export function sameStudioJson(left: unknown, right: unknown): boolean {
	if (left === right) return true
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
	if (Array.isArray(left) || Array.isArray(right))
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => sameStudioJson(value, right[index]))
		)
	const a = left as Record<string, unknown>,
		b = right as Record<string, unknown>
	const keys = Object.keys(a)
	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => Object.hasOwn(b, key) && sameStudioJson(a[key], b[key]))
	)
}
