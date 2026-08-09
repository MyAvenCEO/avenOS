/**
 * Predicates as terms — the real Prolog half.
 *
 * `intent(M, hoch)` parses to functor `intent` with args `[M, hoch]`; an
 * argument starting uppercase (or _) is a variable, anything else a
 * constant. Unification binds variables and REJECTS mismatched constants —
 * `intent(X, hoch)` no longer matches `intent(M, niedrig)` — and one rule
 * serves prover and router alike: the graph you prove is the graph that
 * runs.
 */

export interface Term {
	functor: string
	args: string[]
}

export function parseTerm(predicate: string): Term {
	const trimmed = predicate.trim()
	const open = trimmed.indexOf('(')
	if (open === -1) return { functor: trimmed, args: [] }
	const functor = trimmed.slice(0, open).trim()
	const inner = trimmed.slice(open + 1, trimmed.lastIndexOf(')')).trim()
	const args = inner === '' ? [] : inner.split(',').map((a) => a.trim())
	return { functor, args }
}

export function isVariable(arg: string): boolean {
	return /^[A-Z_]/.test(arg)
}

/** A substitution: variable name → variable name or constant. */
export type Bindings = Record<string, string>

/** Follow a chain of bindings to its end. */
export function resolve(value: string, bindings: Bindings): string {
	let current = value
	const seen = new Set<string>()
	while (isVariable(current) && current in bindings && !seen.has(current)) {
		seen.add(current)
		current = bindings[current]
	}
	return current
}

/**
 * Unify two predicates under existing bindings. Returns the extended
 * bindings, or null when they cannot be made equal: different functors,
 * different arity, or clashing constants.
 */
export function unify(a: string, b: string, bindings: Bindings = {}): Bindings | null {
	const ta = parseTerm(a)
	const tb = parseTerm(b)
	if (ta.functor !== tb.functor || ta.args.length !== tb.args.length) return null

	const next: Bindings = { ...bindings }
	for (let i = 0; i < ta.args.length; i++) {
		const left = resolve(ta.args[i], next)
		const right = resolve(tb.args[i], next)
		if (left === right) continue
		if (isVariable(left)) next[left] = right
		else if (isVariable(right)) next[right] = left
		else return null // two different constants
	}
	return next
}

/** Can these two predicates be made equal at all? */
export function unifiable(a: string, b: string): boolean {
	return unify(a, b) !== null
}

/**
 * Rename a predicate's variables into a producer-local namespace — SLD's
 * "standardizing apart". The namespace goes AFTER the variable (`E@hen`)
 * so the result still starts uppercase and still reads as a variable.
 */
export function rename(predicate: string, space: string): string {
	const t = parseTerm(predicate)
	if (t.args.length === 0) return predicate
	const args = t.args.map((arg) => (isVariable(arg) ? `${arg}@${space}` : arg))
	return `${t.functor}(${args.join(', ')})`
}
