/** Every count produced by the source must be accepted by the destination. */
export function cardinalityFits(
	source: 'one' | 'optional' | 'many',
	target: 'one' | 'optional' | 'many'
): boolean {
	return source === target || target === 'many' || (source === 'one' && target === 'optional')
}
