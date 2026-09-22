import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

/** Only the disposable background lane opts in. Ordinary local/native compositions
 * retain foreground execution until their combined handoff gate is qualified. */
export function backgroundComposition(enabled: boolean) {
	if (!enabled) return { services: {} }
	const source = Bun.YAML.parse(
		readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8')
	) as { services: Record<string, { environment: Record<string, string> }> }
	const intent = source.services['intent-service']!.environment.INTENT_SERVICE_BEARER_TOKEN!
	const runner = source.services['actor-runner']!.environment.ACTOR_RUNNER_SERVICE_BEARER_TOKEN!
	const exchange = randomBytes(32).toString('hex')
	const shared = {
		WORK_CONTROL_URL: 'http://api:13000',
		WORK_GRANT_EXCHANGE_BEARER_TOKEN: exchange
	}
	return {
		services: {
			api: { environment: { WORK_GRANT_EXCHANGE_BEARER_TOKEN: exchange } },
			'intent-service': {
				environment: {
					...shared,
					ACTOR_RUNNER_BASE_URL: 'http://actor-runner:3010',
					ACTOR_RUNNER_SERVICE_BEARER_TOKEN: runner
				}
			},
			'actor-runner': {
				environment: {
					...shared,
					INTENT_SERVICE_BASE_URL: 'http://intent-service:3010',
					INTENT_SERVICE_BEARER_TOKEN: intent,
					CHAT_MODEL_ID: 'deepseek/deepseek-v4-flash-0731'
				}
			}
		}
	}
}

if (import.meta.main) {
	if (!process.argv[2]) throw Error('Output file is required')
	writeFileSync(
		process.argv[2],
		JSON.stringify(backgroundComposition(process.env.E2E_BACKGROUND_CHAT === 'true')),
		{ mode: 0o600 }
	)
}
