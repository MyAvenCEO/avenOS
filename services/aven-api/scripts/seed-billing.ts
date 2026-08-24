// Sync every product (the one-off avenID and the recurring tiers) at the
// payment provider — idempotent, safe to run on every deploy. Products are
// found by `metadata.tier`, created when missing, and their price/name is
// corrected when drifted; everything comes from the brand's pricing SSOT,
// nothing here is hand-typed.
import 'dotenv/config'
import { createPaymentProvider } from '../src/lib/server/billing/fake.js'
import { productSeeds } from '../src/lib/server/billing/seeds.js'
import { loadApiConfig } from '../src/lib/server/config.js'

const config = loadApiConfig()
const payments = createPaymentProvider(config)
const map = await payments.ensureProducts(productSeeds())
process.stdout.write(`Billing products ready (${payments.kind}): ${JSON.stringify(map)}\n`)
