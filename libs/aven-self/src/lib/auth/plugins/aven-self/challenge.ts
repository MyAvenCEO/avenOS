import type { AvenSelfEnv } from '$lib/env'

export type AuthFlow = 'bootstrap' | 'invite'

export type ChallengeFields = {
	domain: string
	uri: string
	network: string
	did: string
	nonce: string
	issuedAt: string
	expirationTime: string
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export function buildChallengeMessage(env: Pick<AvenSelfEnv, 'domain' | 'networkSeed' | 'authUrl'>, fields: Omit<ChallengeFields, 'domain' | 'uri' | 'network'>): string {
	const uri = env.authUrl.replace(/\/$/, '')
	return `${env.domain} wants you to sign in with your Aven Self identity.

URI: ${uri}
Network: ${env.networkSeed}
DID: ${fields.did}
Nonce: ${fields.nonce}
Issued At: ${fields.issuedAt}
Expiration Time: ${fields.expirationTime}`
}

export function challengeExpiry(from = Date.now()): Date {
	return new Date(from + CHALLENGE_TTL_MS)
}

export function parseChallengeMessage(message: string): ChallengeFields | null {
	const lines = message.split('\n')
	const read = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim()
	const domainLine = lines[0]?.replace(' wants you to sign in with your Aven Self identity.', '')
	if (!domainLine) return null
	const did = read('DID: ')
	const nonce = read('Nonce: ')
	const issuedAt = read('Issued At: ')
	const expirationTime = read('Expiration Time: ')
	const uri = read('URI: ')
	const network = read('Network: ')
	if (!did || !nonce || !issuedAt || !expirationTime || !uri || !network) return null
	return {
		domain: domainLine,
		uri,
		network,
		did,
		nonce,
		issuedAt,
		expirationTime,
	}
}
