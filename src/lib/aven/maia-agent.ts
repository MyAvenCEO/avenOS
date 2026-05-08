/**
 * Typed entry for the Maia agent manifest (`agents/maia.agent.json`).
 * Server + client bundle this JSON; keep secrets out (API keys stay in env).
 */
import maiaAgentJson from './agents/maia.agent.json' with { type: 'json' }

export const maiaAgent = maiaAgentJson
