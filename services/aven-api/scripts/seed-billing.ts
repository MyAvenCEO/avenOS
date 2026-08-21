// Ensure the recurring tier products (avenME / avenCEO) exist at the payment
// provider — idempotent, safe to run on every deploy. Prices come from the
// website's pricing SSOT; nothing here is hand-typed.
import 'dotenv/config'
import { createPaymentProvider } from '../src/lib/server/billing/fake.js'
import { subscriptionPlanSeeds } from '../src/lib/server/billing/subscriptions.js'
import { loadApiConfig } from '../src/lib/server/config.js'

const config = loadApiConfig()
const payments = createPaymentProvider(config)
const map = await payments.ensureSubscriptionProducts(subscriptionPlanSeeds())
process.stdout.write(`Billing products ready (${payments.kind}): ${JSON.stringify(map)}\n`)
