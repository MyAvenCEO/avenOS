import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')
export const isToken = (value: string) => /^[A-Za-z0-9_-]{32,256}$/.test(value)

export function constantTimeBearer(request: Request, expected: string): boolean {
	const authorization = request.headers.get('authorization') ?? ''
	const actual = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
	const left = Buffer.from(actual)
	const right = Buffer.from(expected)
	return left.length === right.length && timingSafeEqual(left, right)
}
