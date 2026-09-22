import { jwtVerify, SignJWT } from 'jose'
import {
	CredentialStoreError,
	type CredentialUse,
	credentialUseSchema,
	parseCredentialValue
} from './contracts'

const type = 'aven-credential-use+jwt'
const audience = (protocol: 'http' | 'imap') => `aven-credential-executor:${protocol}`

/** Cryptographic boundary only, not a policy decision. Keep this factory in the
 * authenticated policy issuer; ordinary Actors and executors get verification only.
 * The issuer must bound expiry to identity, review and parent-authority expiry. */
export function credentialUseSigner(issuer: string, key: CryptoKey) {
	checkKey(issuer, key, 'private')
	return async (raw: CredentialUse) => {
		const value = parseCredentialValue(credentialUseSchema, raw)
		checkTime(value)
		return new SignJWT({ use: value })
			.setProtectedHeader({ alg: 'EdDSA', typ: type })
			.setIssuer(issuer)
			.setAudience(audience(value.protocol))
			.setSubject(value.subjectId)
			.setJti(value.authorizationId)
			.setIssuedAt(Math.floor(Date.parse(value.issuedAt) / 1000))
			.setExpirationTime(Math.floor(Date.parse(value.expiresAt) / 1000))
			.sign(key)
	}
}

export function credentialUseVerifier(issuer: string, key: CryptoKey, protocol: 'http' | 'imap') {
	checkKey(issuer, key, 'public')
	if (!['http', 'imap'].includes(protocol))
		throw new CredentialStoreError('CREDENTIAL_AUTHORITY_INVALID')
	return async (token: string): Promise<CredentialUse> => {
		try {
			if (typeof token !== 'string' || token.length > 49152) throw Error('size')
			const { payload, protectedHeader } = await jwtVerify(token, key, {
				issuer,
				audience: audience(protocol),
				algorithms: ['EdDSA'],
				typ: type,
				requiredClaims: ['iat', 'exp', 'sub', 'jti']
			})
			if (
				Object.keys(protectedHeader).some((k) => !['alg', 'typ'].includes(k)) ||
				Object.keys(payload).some(
					(k) => !['use', 'iss', 'aud', 'sub', 'jti', 'iat', 'exp'].includes(k)
				)
			)
				throw Error('fields')
			const use = credentialUseSchema.parse(payload.use)
			if (
				use.protocol !== protocol ||
				use.subjectId !== payload.sub ||
				use.authorizationId !== payload.jti ||
				Math.floor(Date.parse(use.issuedAt) / 1000) !== payload.iat ||
				Math.floor(Date.parse(use.expiresAt) / 1000) !== payload.exp
			)
				throw Error('binding')
			checkTime(use)
			return use
		} catch {
			throw new CredentialStoreError('CREDENTIAL_AUTHORITY_INVALID')
		}
	}
}
function checkTime(use: CredentialUse) {
	if (Date.parse(use.expiresAt) <= Date.now() || Date.parse(use.issuedAt) > Date.now() + 1000)
		throw new CredentialStoreError('CREDENTIAL_AUTHORITY_INVALID')
}
function checkKey(issuer: string, key: CryptoKey, type: 'public' | 'private') {
	if (
		!issuer ||
		issuer.length > 512 ||
		key?.type !== type ||
		key.algorithm.name !== 'Ed25519' ||
		!key.usages.includes(type === 'public' ? 'verify' : 'sign')
	)
		throw new CredentialStoreError('CREDENTIAL_AUTHORITY_INVALID')
}
