import assert from 'node:assert/strict'
import test from 'node:test'
import {
	adoptPlatformDns,
	desiredPlatformRecords,
	dnsProviderUrn,
	dnsReconciliationPlan
} from '../src/adopt-dns.mjs'

const zoneResource = (name, type) => ({ id: `${name}/${type}`, name, type })
const trackedResource = (stack, resourceName) => ({
	type: 'hcloud:index/zoneRrset:ZoneRrset',
	urn: `urn:pulumi:${stack}::aven-platform::hcloud:index/zoneRrset:ZoneRrset::${resourceName}`
})

test('describes only the six records owned by each platform environment', () => {
	assert.deepEqual(
		desiredPlatformRecords('production').map(({ name, type }) => `${name}/${type}`),
		['api/A', 'api/AAAA', 'my/A', 'my/AAAA', '@/A', '@/AAAA']
	)
	assert.deepEqual(
		desiredPlatformRecords('next').map(({ name, type }) => `${name}/${type}`),
		['api.next/A', 'api.next/AAAA', 'my.next/A', 'my.next/AAAA', 'next/A', 'next/AAAA']
	)
	assert.throws(() => dnsProviderUrn('someone/another-project/production'))
})

test('adopts exact existing records and removes only conflicting CNAMEs in owned names', () => {
	const plan = dnsReconciliationPlan({
		environment: 'production',
		rrsets: [
			zoneResource('@', 'A'),
			zoneResource('my', 'AAAA'),
			zoneResource('api', 'CNAME'),
			zoneResource('mail', 'CNAME'),
			zoneResource('@', 'MX')
		],
		stackResources: [trackedResource('production', 'platform-apex-a')]
	})
	assert.deepEqual(plan.imports, [
		{ resourceName: 'platform-checkout-aaaa', id: 'aven.ceo/my/AAAA' }
	])
	assert.deepEqual(plan.obsoleteCnames, [{ name: 'api', type: 'CNAME' }])
})

test('does nothing once all matching records are tracked', () => {
	const desired = desiredPlatformRecords('next')
	const plan = dnsReconciliationPlan({
		environment: 'next',
		rrsets: desired.map(({ name, type }) => zoneResource(name, type)),
		stackResources: desired.map(({ resourceName }) => trackedResource('next', resourceName))
	})
	assert.deepEqual(plan, { imports: [], obsoleteCnames: [] })
})

test('repairs the exact partial production checkpoint left by a failed create', () => {
	const desired = desiredPlatformRecords('production')
	const plan = dnsReconciliationPlan({
		environment: 'production',
		rrsets: desired.map(({ name, type }) => zoneResource(name, type)),
		stackResources: [
			trackedResource('production', 'platform-api-a'),
			trackedResource('production', 'platform-api-aaaa'),
			trackedResource('production', 'platform-apex-aaaa')
		]
	})
	assert.deepEqual(plan.imports, [
		{ resourceName: 'platform-checkout-a', id: 'aven.ceo/my/A' },
		{ resourceName: 'platform-checkout-aaaa', id: 'aven.ceo/my/AAAA' },
		{ resourceName: 'platform-apex-a', id: 'aven.ceo/@/A' }
	])
	assert.deepEqual(plan.obsoleteCnames, [])
})

test('prepares the explicit provider, removes conflicts, and imports unmanaged records', async () => {
	const commands = []
	const removed = []
	const output = []
	const provider = dnsProviderUrn('organization/aven-platform/production')
	let exported = 0
	await adoptPlatformDns({
		cwd: '/tmp/platform-test',
		environment: {
			DEPLOYMENT_ENVIRONMENT: 'production',
			PULUMI_STACK: 'organization/aven-platform/production',
			PULUMI_BACKEND_URL: 's3://state/example',
			HETZNER_DNS_TOKEN: 'test-token'
		},
		run(args) {
			commands.push(args)
			return { status: args[0] === 'stack' && args[1] === 'select' ? 1 : 0, stdout: '', stderr: '' }
		},
		read() {
			exported += 1
			return exported === 1 ? [] : [{ type: 'pulumi:providers:hcloud', urn: provider }]
		},
		async list() {
			return [zoneResource('@', 'A'), zoneResource('my', 'AAAA'), zoneResource('api', 'CNAME')]
		},
		async remove(zone, name, type) {
			removed.push({ zone, name, type })
		},
		write(message) {
			output.push(message)
		}
	})

	assert.deepEqual(commands[0], ['login', 's3://state/example', '--non-interactive'])
	assert.deepEqual(commands[2].slice(0, 4), [
		'stack',
		'init',
		'organization/aven-platform/production',
		'--secrets-provider'
	])
	assert.ok(commands.some((args) => args[0] === 'up' && args.includes(provider)))
	assert.deepEqual(
		commands.filter((args) => args[0] === 'import').map((args) => args.slice(1, 4)),
		[
			['hcloud:index/zoneRrset:ZoneRrset', 'platform-checkout-aaaa', 'aven.ceo/my/AAAA'],
			['hcloud:index/zoneRrset:ZoneRrset', 'platform-apex-a', 'aven.ceo/@/A']
		]
	)
	assert.deepEqual(removed, [{ zone: 'aven.ceo', name: 'api', type: 'CNAME' }])
	assert.match(output.at(-1), /2 existing RRSet\(s\) adopted; 1 obsolete CNAME/)
})

test('rejects a target and stack mismatch before contacting either provider', async () => {
	const commands = []
	await assert.rejects(
		adoptPlatformDns({
			environment: {
				DEPLOYMENT_ENVIRONMENT: 'production',
				PULUMI_STACK: 'organization/aven-platform/next',
				PULUMI_BACKEND_URL: 's3://state/example',
				HETZNER_DNS_TOKEN: 'test-token'
			},
			run(args) {
				commands.push(args)
				return { status: 0 }
			}
		}),
		/does not match deployment target/
	)
	assert.deepEqual(commands, [])
})
