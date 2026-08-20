import { z } from 'zod'
import { api, readJson, requireUser } from '$lib/server/api.js'
import { AppError } from '$lib/server/errors.js'

const enrollmentSchema = z.object({
	credentialId: z.string().min(1).optional(),
	prfEnabled: z.boolean()
})

export const GET = api(async (event, rt) => {
	const user = await requireUser(event)
	return { body: { passkeys: (await rt.passkeys.status(user.id)).passkeys } }
})

export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	const input = enrollmentSchema.parse(await readJson(event))
	if (rt.config.REQUIRE_PASSKEY_PRF && !input.prfEnabled) {
		throw new AppError(409, 'PASSKEY_PRF_REQUIRED', 'Passkey PRF support is required.')
	}
	await rt.passkeys.finishEnrollment(user.id, input.prfEnabled, input.credentialId)
	return { body: { enrolled: true } }
})
