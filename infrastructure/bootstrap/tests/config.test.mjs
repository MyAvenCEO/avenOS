import assert from 'node:assert/strict'
import test from 'node:test'
import { loadBootstrapConfig } from '../src/config.mjs'

const env = {
	OBJECT_STORAGE_BUCKET_PREFIX: 'avenos-example-abc123',
	OBJECT_STORAGE_PROJECT_ID: '12345',
	BOOTSTRAP_S3_ACCESS_KEY_ID: 'BOOTSTRAP123',
	BOOTSTRAP_S3_SECRET_ACCESS_KEY: 'secret',
	IDENTITY_DEPLOYMENT_S3_ACCESS_KEY_ID: 'IDENTITYDEPLOY',
	IDENTITY_OBSERVER_S3_ACCESS_KEY_ID: 'IDENTITYOBSERVE',
	NEXT_DEPLOYMENT_S3_ACCESS_KEY_ID: 'NEXTDEPLOY123',
	NEXT_OBSERVER_S3_ACCESS_KEY_ID: 'NEXTOBSERVE1',
	PRODUCTION_DEPLOYMENT_S3_ACCESS_KEY_ID: 'PRODDEPLOY12',
	PRODUCTION_OBSERVER_S3_ACCESS_KEY_ID: 'PRODOBSERVER'
}

test('loads the isolated object-storage roles', () => {
	const config = loadBootstrapConfig(env)
	assert.equal(config.region, 'hel1')
	assert.equal(config.credentials.next.observer, 'NEXTOBSERVE1')
})

test('rejects unsafe bucket prefixes and missing roles', () => {
	assert.throws(() => loadBootstrapConfig({ ...env, OBJECT_STORAGE_BUCKET_PREFIX: 'Not Global' }))
	assert.throws(() => loadBootstrapConfig({ ...env, NEXT_OBSERVER_S3_ACCESS_KEY_ID: '' }))
})
