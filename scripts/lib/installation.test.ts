import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
	generateBootstrapSecrets,
	loadOrCreateGeneratedSecrets,
	saveGeneratedSecrets
} from './deployment-bootstrap.js'
import {
	installationEndpoints,
	installationRelease,
	installationSelection
} from './installation.js'
import { deploymentReleasePolicy, releaseImages } from './platform-release.js'

describe('independent installations', () => {
	test('one explicit target and only its public endpoints', () => {
		expect(installationSelection('identity')).toBe('identity')
		expect(installationSelection('platform', 'prod')).toBe('production')
		for (const choice of ['all', 'identity', 'next,production', ''])
			expect(() => installationSelection('platform', choice)).toThrow()
		expect(installationEndpoints('identity')).toHaveLength(1)
		expect(installationEndpoints('next').join()).not.toContain('https://api.aven.ceo')
		expect(installationEndpoints('production').join()).not.toContain('next.')
	})

	test('identity, next, and direct production have independent resumable records', async () => {
		const generated = generateBootstrapSecrets()
		expect(installationRelease('identity', generated)).toEqual({ branch: 'prod' })
		expect(() => installationRelease('next', generated)).toThrow('Install identity first')
		generated.rollouts = {
			identity: { ref: 'a'.repeat(40), targets: ['identity'], releaseRunId: 10, verifiedAt: 'now' }
		}
		expect(installationRelease('next', generated)).toEqual({ branch: 'next' })
		expect(installationRelease('production', generated)).toEqual({ branch: 'prod' })
		generated.completedTargets = ['identity', 'next']
		expect(() => installationRelease('production', generated)).toThrow('Complete next')
		generated.rollouts.next = {
			ref: 'b'.repeat(40),
			targets: ['next'],
			releaseRunId: 20,
			deployRunId: 21,
			verifiedAt: 'now'
		}
		expect(installationRelease('production', generated)).toEqual({
			branch: 'prod',
			releaseRunId: 20,
			nextProofRunId: 21
		})
		const directory = await mkdtemp(join(tmpdir(), 'aven-installer-record-'))
		try {
			const file = join(directory, 'generated.json')
			saveGeneratedSecrets(file, generated)
			expect(loadOrCreateGeneratedSecrets(file).rollouts).toEqual(generated.rollouts)
			generated.rollouts.next.deployRunId = -1
			saveGeneratedSecrets(file, generated)
			expect(() => loadOrCreateGeneratedSecrets(file)).toThrow('deployRunId')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	test('staged production always needs next proof; standalone production uses stable release provenance', () => {
		expect(deploymentReleasePolicy('production', ['identity', 'production'])).toEqual({
			requiresNextProof: false,
			releaseBranches: ['prod']
		})
		expect(deploymentReleasePolicy('production', ['identity', 'next', 'production'])).toEqual({
			requiresNextProof: true,
			releaseBranches: ['next']
		})
		expect(deploymentReleasePolicy('identity', ['identity'])).toEqual({
			requiresNextProof: false,
			releaseBranches: ['prod']
		})
		for (const invalid of [[], ['production', 'production'], ['production', 'other'], null])
			expect(() => deploymentReleasePolicy('production', invalid)).toThrow()
	})
})

test('real deployment verifier enforces branch provenance and exact promotion proof before selecting an Environment', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'aven-installer-provenance-'))
	const sha = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim()
	const manifest = {
		version: 1,
		sha,
		runId: 10,
		images: Object.fromEntries(
			Object.entries(releaseImages).map(([key, image]) => [
				key,
				`ghcr.io/myavenceo/${image}@sha256:${'a'.repeat(64)}`
			])
		)
	}
	try {
		const gh = join(directory, 'gh')
		await writeFile(
			gh,
			`#!${process.execPath}\nconst fixture = JSON.parse(await Bun.file(process.env.FIXTURE).text());\nconst args = process.argv.slice(2);\nif (args[0] === 'api') console.log(JSON.stringify(args[1].endsWith('/11') ? fixture.proofRun : fixture.releaseRun));\nelse if (args[0] === 'run' && args[1] === 'download') { const dest = args[args.indexOf('--dir')+1]; const proof = args.includes('aven-next-proof'); await Bun.write(dest + (proof ? '/next-proof.json' : '/release.json'), JSON.stringify(proof ? fixture.proof : fixture.manifest)); }\nelse process.exit(1);\n`
		)
		await chmod(gh, 0o700)
		const metadata = (branch: string, workflow: string) => ({
			conclusion: 'success',
			event: 'workflow_dispatch',
			head_branch: branch,
			head_sha: sha,
			path: `.github/workflows/${workflow}.yml`,
			head_repository: { full_name: 'MyAvenCEO/avenOS' }
		})
		for (const scenario of [
			{ target: 'identity', prepared: ['identity'], branch: 'prod', accepted: true },
			{ target: 'identity', prepared: ['identity'], branch: 'next', accepted: false },
			{ target: 'next', prepared: ['identity', 'next'], branch: 'next', accepted: true },
			{ target: 'next', prepared: ['identity', 'next'], branch: 'prod', accepted: false },
			{
				target: 'production',
				prepared: ['identity', 'production'],
				branch: 'prod',
				accepted: true
			},
			{
				target: 'production',
				prepared: ['identity', 'production'],
				branch: 'next',
				accepted: false
			},
			{
				target: 'production',
				prepared: ['identity', 'next', 'production'],
				branch: 'next',
				accepted: false
			},
			{
				target: 'production',
				prepared: ['identity', 'next', 'production'],
				branch: 'next',
				proof: true,
				accepted: true
			},
			{
				target: 'production',
				prepared: ['identity', 'next', 'production'],
				branch: 'next',
				proof: true,
				changed: true,
				accepted: false
			},
			{
				target: 'production',
				prepared: ['identity', 'next', 'production'],
				branch: 'prod',
				proof: true,
				accepted: false
			}
		]) {
			const output = join(directory, 'output')
			await writeFile(output, '')
			await writeFile(
				join(directory, 'fixture'),
				JSON.stringify({
					manifest,
					releaseRun: metadata(scenario.branch, 'platform-release'),
					proofRun: metadata('next', 'platform-deploy'),
					proof: { ...manifest, runId: scenario.changed ? 12 : 10 }
				})
			)
			const child = Bun.spawn([process.execPath, resolve('scripts/verify-platform-release.ts')], {
				env: {
					PATH: `${directory}:${process.env.PATH}`,
					FIXTURE: join(directory, 'fixture'),
					GITHUB_REF: scenario.target === 'next' ? 'refs/heads/next' : 'refs/heads/prod',
					GITHUB_SHA: sha,
					GITHUB_EVENT_NAME: 'workflow_dispatch',
					GITHUB_ACTOR: 'operator',
					GITHUB_REPOSITORY: 'MyAvenCEO/avenOS',
					DEPLOYMENT_TARGET: scenario.target,
					DEPLOYMENT_TARGETS_JSON: JSON.stringify(scenario.prepared),
					DEPLOYMENT_ENVIRONMENT_PREFIX: 'avenos-1234567890',
					RELEASE_RUN_ID: '10',
					NEXT_PROOF_RUN_ID: scenario.proof ? '11' : '',
					GITHUB_OUTPUT: output
				},
				stdout: 'pipe',
				stderr: 'pipe'
			})
			const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
			expect(code === 0, `${JSON.stringify(scenario)}: ${error}`).toBe(scenario.accepted)
			expect((await readFile(output, 'utf8')).length > 0).toBe(scenario.accepted)
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
