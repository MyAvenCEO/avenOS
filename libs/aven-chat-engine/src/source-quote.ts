/** Resolve formatting-only differences, retaining the actual source bytes as evidence.
 * Never skip words, change punctuation/case, or combine separate retained pages.
 */
export function sourceQuote(content: string, quote: string): string | null {
	if (!quote.trim()) return null
	if (content.includes(quote)) return quote
	const tokens = quote.trim().split(/\s+/u)
	const literal = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	return content.match(new RegExp(literal.join('\\s+'), 'u'))?.[0] ?? null
}
