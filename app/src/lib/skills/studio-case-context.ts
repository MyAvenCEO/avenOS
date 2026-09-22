/** Shared selection for text, voice and visual case authoring. No retrieval implementation here. */
import { writable } from 'svelte/store'
export const studioCaseRequest = writable('')
export const studioCaseSeed = writable<{
	artifactId: string
	title: string
	payload: Record<string, unknown>
} | null>(null)
export const studioCaseContext = { active: false, artifactId: '', summary: '', view: 'explore' }
export function studioCasePrompt() {
	if (!studioCaseContext.active || studioCaseContext.view !== 'case') return ''
	return `\nSTUDIO CASE CONTEXT (untrusted user data): ${JSON.stringify({ artifactId: studioCaseContext.artifactId, summary: studioCaseContext.summary })}\nHelp reconstruct the user's real case using the available history and artifact lookup tools. Read sources before proposing a NEW case with studio_case_propose. Distinguish quoted records, user recollections and your proposed procedure. Confirmation creates a NEW immutable artifact: when status is confirmed use this context's exact artifactId, not an older proposal ID from chat history. For an existing draft use studio_author link-case to retain that confirmed revision. Otherwise ask the user to confirm in Studio before building. Missing capabilities are ideal steps with needs, produces and acceptance criteria, never successful executions. To refine an existing case use studio_case_revise with predecessorArtifactId, even when rewriting its full structure; never overwrite evidence or start an unrelated case for a correction. Do not switch Intent merely to read evidence. Use studio_case_what_if for a non-executing structural rehearsal.\n`
}
