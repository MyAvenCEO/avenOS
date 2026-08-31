import assert from 'node:assert/strict'
import test from 'node:test'
import {
	activePrefixAllowsRepositoryCleanup,
	bootstrapBucketTargetUrns,
	githubEnvironmentNames,
	guidedUninstallArguments,
	localResetPaths,
	ownedPolarCatalogResources,
	platformProtectionTargetUrns,
	uninstallConfirmation,
	uninstallFailureSummary,
	uninstallTargets
} from '../../../scripts/lib/deployment-uninstall.ts'

test('removes a generation in reverse dependency order', () => {
	assert.deepEqual(
		uninstallTargets(
			{ deploymentTargets: ['identity', 'next', 'production'] },
			{ completedTargets: ['identity', 'next', 'production'] }
		),
		['production', 'next', 'identity']
	)
	assert.equal(uninstallConfirmation('avenos-0123456789'), 'uninstall avenos-0123456789')
	assert.throws(() => uninstallConfirmation('avenos-current'), /Invalid deployment namespace/)
})

test('passes the typed generation confirmation to the uninstall engine', () => {
	assert.deepEqual(
		guidedUninstallArguments(
			'/repo/scripts/deployment-uninstall.ts',
			'/private/bootstrap-input.json',
			'/private/output',
			'avenos-0123456789'
		),
		[
			'/repo/scripts/deployment-uninstall.ts',
			'--input',
			'/private/bootstrap-input.json',
			'--output',
			'/private/output',
			'--confirmed-generation',
			'avenos-0123456789',
			'--progress-json'
		]
	)
})

test('reports the provider error instead of Bun stack trailer noise', () => {
	assert.equal(
		uninstallFailureSummary([
			'error: Refusing provider changes without --confirmed-generation avenos-0123456789.',
			'      at /repo/scripts/deployment-uninstall.ts:67:12',
			'Bun v1.3.13 (Linux x64)'
		]),
		'Refusing provider changes without --confirmed-generation avenos-0123456789.'
	)
})

test('names only the saved generation GitHub Environments', () => {
	assert.deepEqual(githubEnvironmentNames('avenos-0123456789', ['production', 'identity']), [
		'avenos-0123456789-production',
		'avenos-0123456789-production-operations',
		'avenos-0123456789-identity',
		'avenos-0123456789-identity-operations'
	])
	assert.equal(activePrefixAllowsRepositoryCleanup('avenos-0123456789', 'avenos-0123456789'), true)
	assert.equal(activePrefixAllowsRepositoryCleanup('avenos-aaaaaaaaaa', 'avenos-0123456789'), false)
})

test('targets only provider resources whose deletion locks need changing', () => {
	const stack = {
		deployment: {
			resources: [
				{ type: 'pulumi:pulumi:Stack', urn: 'stack' },
				{ type: 'hcloud:index/server:Server', urn: 'server' },
				{ type: 'hcloud:index/volume:Volume', urn: 'volume' },
				{ type: 'hcloud:index/zoneRrset:ZoneRrset', urn: 'dns' },
				{ type: 'hcloud:index/firewall:Firewall', urn: 'firewall' },
				{ type: 'minio:index/s3Bucket:S3Bucket', urn: 'bucket' }
			]
		}
	}
	assert.deepEqual(platformProtectionTargetUrns(stack), ['server', 'volume', 'dns'])
	assert.deepEqual(bootstrapBucketTargetUrns(stack), ['bucket'])
})

test('selects only the exact SSOT Polar catalog', () => {
	assert.deepEqual(
		ownedPolarCatalogResources({
			products: [
				{ id: 'ours', metadata: { tier: 'aven-ceo' } },
				{ id: 'other', metadata: { tier: 'consulting' } }
			],
			benefits: [
				{ id: 'ours-benefit', metadata: { source: 'ssot', key: 'skill:write' } },
				{ id: 'other-benefit', metadata: { source: 'manual', key: 'skill:write' } }
			],
			meters: [
				{ id: 'ours-meter', name: 'mind-credits', metadata: { source: 'ssot' } },
				{ id: 'other-meter', name: 'mind-credits', metadata: { source: 'manual' } }
			]
		}),
		{
			productIds: ['ours'],
			benefitIds: ['ours-benefit'],
			meterIds: ['ours-meter']
		}
	)
})

test('preserves the reusable input outside the generated reset set', () => {
	const paths = localResetPaths('/private/bootstrap', ['next'])
	assert.equal(paths.includes('/private/bootstrap/bootstrap-input.json'), false)
	assert.equal(paths.includes('/private/bootstrap/bootstrap.generated.json'), true)
	assert.equal(paths.includes('/private/bootstrap/uninstall-pulumi-state'), true)
	assert.equal(paths.includes('/private/bootstrap/uninstall-platform-next.json'), true)
})
