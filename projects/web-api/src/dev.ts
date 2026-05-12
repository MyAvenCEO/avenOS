import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { RuntimeLogger } from '@jaensen/actor-runtime'

import { createDevHarness, resolveProviderConfig } from './dev-harness'
import { createWebApi } from './index'

const workspaceRoot = process.env.JAENSEN_WORKSPACE_ROOT ?? resolveRepoRoot()
const persistencePath = process.env.JAENSEN_DB_PATH ?? '.jaensen/state.db'
const skillsRoot = process.env.JAENSEN_SKILLS_ROOT ?? '.jaensen/skills'
const port = Number.parseInt(process.env.JAENSEN_PORT ?? '7341', 10)
const pollIntervalMs = Number.parseInt(process.env.JAENSEN_TICK_IDLE_MS ?? '150', 10)
const idleDelayMs = Number.parseInt(process.env.JAENSEN_TICK_IDLE_MS ?? '100', 10)
const traceActors = process.env.JAENSEN_TRACE_ACTORS !== '0'
const providerConfig = resolveProviderConfig(process.env)

const api = await createWebApi({
	persistencePath,
	workspaceRoot,
	skillsRoot,
	port,
	pollIntervalMs,
	idleDelayMs,
	logger: traceActors ? createConsoleRuntimeLogger() : undefined,
	harness: createDevHarness(providerConfig),
	model: providerConfig.model
})

console.log(`@jaensen/web-api listening on ${api.url} using ${providerConfig.provider}/${providerConfig.model}`)
if (traceActors) {
	console.log('[jaensen/web-api] actor tracing enabled (set JAENSEN_TRACE_ACTORS=0 to disable)')
}

function resolveRepoRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url))
	return path.resolve(here, '..', '..', '..')
}

function createConsoleRuntimeLogger(): RuntimeLogger {
	return {
		debug(message, metadata) {
			console.debug(formatRuntimeLog(message, metadata))
		},
		info(message, metadata) {
			console.info(formatRuntimeLog(message, metadata))
		},
		warn(message, metadata) {
			console.warn(formatRuntimeLog(message, metadata))
		},
		error(message, metadata) {
			console.error(formatRuntimeLog(message, metadata))
		}
	}
}

function formatRuntimeLog(message: string, metadata?: Record<string, unknown>): string {
	return metadata ? `[jaensen/runtime] ${message} ${JSON.stringify(metadata)}` : `[jaensen/runtime] ${message}`
}