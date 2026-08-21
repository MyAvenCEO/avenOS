// One file per module so a future extraction can lift a module's tables (and
// its grants in migrations/grants.sql) wholesale.
export * from './auth.js'
export * from './device.js'
export * from './email.js'
export * from './environments.js'
export * from './names.js'
export * from './ops.js'
export * from './passkeys.js'

import { account, proofOfWorkChallenges, session, user, verification } from './auth.js'
import { deviceCode } from './device.js'
import { emailQueue } from './email.js'
import {
	customerEnvironmentJobs,
	customerEnvironmentLogs,
	customerEnvironments
} from './environments.js'
import { nameHolds, names, paymentEvents, purchaseSessions } from './names.js'
import { auditEvents, workerHeartbeats } from './ops.js'
import { passkey, setupLinks } from './passkeys.js'

export const schema = {
	user,
	session,
	account,
	verification,
	deviceCode,
	passkey,
	setupLinks,
	proofOfWorkChallenges,
	emailQueue,
	names,
	nameHolds,
	purchaseSessions,
	paymentEvents,
	customerEnvironments,
	customerEnvironmentJobs,
	customerEnvironmentLogs,
	auditEvents,
	workerHeartbeats
}
