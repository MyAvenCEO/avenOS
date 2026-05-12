/**
 * Hardcoded open HITL items for **local UI positioning** and backend/API shape reference.
 * Merged only when `import.meta.env.DEV` in {@link IntentCenterPanel}.
 * Ids use {@link HITL_LAYOUT_REF_ID_PREFIX}; resolves are ignored in `handleResolveHitl`.
 */
import type { HitlTodo } from './types'

export const HITL_LAYOUT_REF_ID_PREFIX = 'layout-ref-'

export function hitlLayoutExampleTodos(intentId: string): HitlTodo[] {
	const p = HITL_LAYOUT_REF_ID_PREFIX
	return [
		{
			id: `${p}text-reply`,
			intentId,
			type: 'text_reply',
			title: 'Short answer (example)',
			status: 'open',
			createdAt: '12:00',
			question: 'What constraint should we apply for the next step?',
			placeholder: 'Type a brief direction for the run…'
		},
		{
			id: `${p}choice`,
			intentId,
			type: 'choice',
			title: 'Pick one option (example)',
			status: 'open',
			createdAt: '12:01',
			question: 'Which handling path should the orchestrator take?',
			options: [
				{ id: 'opt_a', label: 'Path A — conservative' },
				{ id: 'opt_b', label: 'Path B — fast track' },
				{ id: 'opt_c', label: 'Defer to policy review' }
			]
		},
		{
			id: `${p}approve-reject`,
			intentId,
			type: 'approve_reject',
			title: 'Confirm action (example)',
			status: 'open',
			createdAt: '12:02',
			summary:
				'Example approve / reject card. Wire your server payload into `HitlTodo` and render here — this block is static in dev only.'
		}
	]
}
