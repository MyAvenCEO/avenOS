import { createPublicKey, KeyObject } from 'node:crypto'
import {
	importTenantGrantPrivateKey,
	importTenantGrantPublicKey
} from '@avenos/aven-customer-contracts'

/** Both ordinary tenant grants and delegated work use this one signing identity. */
export async function importFacadeTenantKeys(pem: string) {
	const privateKey = await importTenantGrantPrivateKey(pem)
	const publicKey = await importTenantGrantPublicKey(
		createPublicKey(KeyObject.from(privateKey)).export({ type: 'spki', format: 'pem' }).toString()
	)
	return { privateKey, publicKey }
}
