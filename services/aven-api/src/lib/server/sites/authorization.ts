import { AppError } from '../errors.js'
import type { Runtime } from '../runtime.js'

export async function requireSiteManagementPasskey(rt: Runtime, userId: string): Promise<void> {
	const { passkeys } = await rt.passkeys.status(userId)
	const enrolled = passkeys.some(
		(passkey) => !rt.config.REQUIRE_PASSKEY_PRF || passkey.prf_enabled === true
	)
	if (!enrolled)
		throw new AppError(
			403,
			'PASSKEY_REQUIRED',
			'Complete passkey enrollment before managing websites.'
		)
}
