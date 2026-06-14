/**
 * The ONE place that decides which agent runtime backs the identity agent.
 *
 * Migration modes (see the milestone plan, decision D12):
 *  - `current-cloud`  — the existing frontend-owned cloud/Tinfoil tool loop + Brain.
 *                       This is the temporary rollback path and the default.
 *  - `dotnet-sidecar` — the AkkaAgent2 .NET runtime spoken to over a private stdio
 *                       sidecar. Brain is out of scope in this mode (decision D7).
 *
 * Selected from a single env var so Svelte components never scatter their own
 * env checks. Override at build/dev time with `PUBLIC_AGENT_RUNTIME=dotnet-sidecar`.
 */
export type AgentRuntimeMode = 'current-cloud' | 'dotnet-sidecar'

export const AGENT_RUNTIME_MODES: readonly AgentRuntimeMode[] = ['current-cloud', 'dotnet-sidecar']

/** Default during migration: keep the proven path until the sidecar passes M8/M9. */
export const DEFAULT_AGENT_RUNTIME_MODE: AgentRuntimeMode = 'current-cloud'

function normalize(value: string | undefined): AgentRuntimeMode {
	const v = (value ?? '').trim().toLowerCase()
	return (AGENT_RUNTIME_MODES as readonly string[]).includes(v)
		? (v as AgentRuntimeMode)
		: DEFAULT_AGENT_RUNTIME_MODE
}

/** Resolve the active agent runtime mode. Single source of truth. */
export function agentRuntimeMode(): AgentRuntimeMode {
	// SvelteKit exposes PUBLIC_*-prefixed vars on import.meta.env (see PUBLIC_WEBCM_BASE).
	return normalize(import.meta.env.PUBLIC_AGENT_RUNTIME as string | undefined)
}

/** True when the .NET stdio sidecar should own agent orchestration. */
export function isDotnetSidecarMode(): boolean {
	return agentRuntimeMode() === 'dotnet-sidecar'
}

/**
 * Whether the Brain memory UX (route, aside, ingest/recall/dream) is active.
 * Brain is intentionally disabled in the sidecar path; the .NET runtime is meant
 * to replace that responsibility (decision D7).
 */
export function isBrainEnabled(): boolean {
	return !isDotnetSidecarMode()
}
