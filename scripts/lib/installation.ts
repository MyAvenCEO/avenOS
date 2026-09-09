import type { GeneratedSecrets, Target } from './deployment-bootstrap.js'

export function installationSelection(mode: string, choice?: string): Target {
	if (mode === 'identity') return 'identity'
	if (mode !== 'platform' && mode !== 'choose') throw new Error('Unknown installer mode.')
	if (choice === 'prod') choice = 'production'
	if (choice === 'next' || choice === 'production' || (mode === 'choose' && choice === 'identity'))
		return choice
	throw new Error('Choose one installer target: identity, next, or production.')
}

export function installationRelease(target: Target, generated: GeneratedSecrets) {
	if (target !== 'identity' && !generated.rollouts?.identity?.verifiedAt)
		throw new Error(
			'Install identity first using install:identity and the same private --output directory.'
		)
	if (target === 'production' && generated.completedTargets?.includes('next')) {
		const next = generated.rollouts?.next
		if (!next?.verifiedAt || !next.releaseRunId || !next.deployRunId)
			throw new Error(
				'Complete next before installing production; production requires its exact verified release.'
			)
		return { branch: 'prod', releaseRunId: next.releaseRunId, nextProofRunId: next.deployRunId }
	}
	return { branch: target === 'next' ? 'next' : 'prod' }
}

export function installationEndpoints(target: Target): string[] {
	if (target === 'identity') return ['https://aven.id/api/health/ready']
	const domain = target === 'next' ? 'next.aven.ceo' : 'aven.ceo'
	return [
		'https://aven.id/api/health/ready',
		`https://api.${domain}/health/live`,
		`https://portal.${domain}/api/health/ready`,
		`https://${domain}/`
	]
}
