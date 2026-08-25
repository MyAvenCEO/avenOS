import { timingSafeEqual } from 'node:crypto'

export function isSiteDirectoryRequestAuthorized(request: Request, token?: string): boolean {
	if (!token) return false
	const authorization = request.headers.get('authorization')
	if (!authorization) return false
	const actual = Buffer.from(authorization)
	const expected = Buffer.from(`Bearer ${token}`)
	return actual.length === expected.length && timingSafeEqual(actual, expected)
}
