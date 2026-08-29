const publicPages = new Set([
	'/',
	'/secure',
	'/purchase/checkout',
	'/purchase/expired',
	'/purchase/fake-checkout',
	'/purchase/success'
])

const exactPublicApis = new Set(['/api/pow/challenge', '/api/webhooks/polar'])
const publicApiPrefixes = ['/api/names/', '/api/billing/', '/api/health/']

export function isCheckoutPath(pathname: string): boolean {
	if (publicPages.has(pathname)) return true
	if (exactPublicApis.has(pathname)) return true
	return publicApiPrefixes.some(
		(prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)
	)
}
