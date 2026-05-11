import { mockId } from './id'
import type { IntentOrchestrator } from './types'

export function buildSeedIntents(): IntentOrchestrator[] {
	const intentA: IntentOrchestrator = {
		id: 'intent-seed-ocr',
		title: 'Process Q3 receipts for finance',
		summary: 'Pull invoice lines and tax treatment so finance can close the quarter on time.',
		done: false,
		orchestratorLabel: 'AvenCEO',
		subAgents: [
			{
				id: 'sub-ocr-1',
				name: 'ocr_worker',
				role: 'Extract line items and vendor from each receipt',
				status: 'blocked_hitl',
				parentOrchestratorId: 'intent-seed-ocr',
				skillId: 'sk-ingest',
				blockedReason: 'Unclear how to tag one tax line — pick an option below.'
			},
			{
				id: 'sub-qa-1',
				name: 'qa_checker',
				role: 'Double-check totals against the original PDFs',
				status: 'idle',
				parentOrchestratorId: 'intent-seed-ocr',
				skillId: 'sk-qa'
			}
		],
		activity: [
			{
				id: 'a1',
				at: '09:41',
				kind: 'human',
				title: 'You added this intent',
				detail: 'Finance receipt batch for Q3.'
			},
			{
				id: 'a2',
				at: '09:41',
				kind: 'orchestrator',
				title: 'AvenCEO assigned skills',
				detail:
					'Two skills are on this run: ingest/receipt_normalize · sk-ingest, qa/two_pass_diff · sk-qa.',
				agentId: 'orch-ocr'
			},
			{
				id: 'a3',
				at: '09:42',
				kind: 'sub_agent',
				title: 'Finished reading your documents',
				detail: 'Pulled text and tables from 12 pages.',
				agentId: 'sub-ocr-1'
			},
			{
				id: 'a4',
				at: '09:43',
				kind: 'delegation',
				title: 'Needs your input on one line',
				detail: 'Human Review is open when you are ready.',
				agentId: 'sub-ocr-1'
			}
		],
		toolCalls: [
			{
				id: 't1',
				agentId: 'sub-ocr-1',
				tool: 'rasterize_pdf',
				inputSummary: 'bundle.zip / invoices/',
				outputSummary: '12 PNG pages',
				status: 'ok'
			},
			{
				id: 't2',
				agentId: 'sub-ocr-1',
				tool: 'classify_line_items',
				inputSummary: 'page 3 region tax',
				status: 'pending'
			}
		],
		hitlTodos: [
			{
				id: 'hitl-1',
				intentId: 'intent-seed-ocr',
				type: 'choice',
				title: 'Tax category',
				status: 'open',
				createdAt: '09:43',
				question: 'How should we treat the 19% block on page 3?',
				options: [
					{ id: 'standard_vat', label: 'Standard DE VAT (full deduct)' },
					{ id: 'reverse_charge', label: 'Reverse charge' },
					{ id: 'ignore', label: 'Non-taxable line item' }
				]
			},
			{
				id: 'hitl-2',
				intentId: 'intent-seed-ocr',
				type: 'approve_reject',
				title: 'Run a second quality pass',
				status: 'open',
				createdAt: '09:44',
				summary:
					'After your answers land, AvenCEO can run a stricter check before we hand off to finance.'
			}
		],
		config: {
			routingMode: 'spawn',
			workerClassLabel: 'document_ocr',
			notes: 'Mock — no live Jazz rows.'
		},
		skills: [
			{ skillId: 'sk-ingest', name: 'ingest/receipt_normalize', bound: true },
			{ skillId: 'sk-qa', name: 'qa/two_pass_diff', bound: false }
		]
	}

	const intentB: IntentOrchestrator = {
		id: 'intent-seed-plan',
		title: 'Weekly roadmap sync draft',
		summary: 'Light prep so Friday’s leadership sync has clear themes and risks.',
		done: false,
		orchestratorLabel: 'AvenCEO',
		subAgents: [
			{
				id: 'sub-research',
				name: 'research_agent',
				role: 'Gather what shipped last week and what slipped',
				status: 'running',
				parentOrchestratorId: 'intent-seed-plan',
				skillId: 'sk-roadmap'
			}
		],
		activity: [
			{
				id: 'b1',
				at: '10:02',
				kind: 'human',
				title: 'You added this intent',
				detail: 'Draft bullets for Friday sync.'
			},
			{
				id: 'b2',
				at: '10:03',
				kind: 'orchestrator',
				title: 'AvenCEO started this skill on your behalf',
				detail: 'Pulling recent work items into a short brief.',
				agentId: 'sub-research'
			}
		],
		toolCalls: [
			{
				id: 'tb1',
				agentId: 'sub-research',
				tool: 'linear_query',
				inputSummary: 'team:core · last 7d',
				status: 'ok'
			}
		],
		hitlTodos: [
			{
				id: 'hitl-b1',
				intentId: 'intent-seed-plan',
				type: 'text_reply',
				title: 'Tone for the risks section',
				status: 'open',
				createdAt: '10:04',
				question: 'Should the risks read neutral, direct, or soft?',
				placeholder: 'e.g. Neutral'
			}
		],
		config: {
			routingMode: 'select',
			workerClassLabel: 'planning_sync',
			notes: 'Select existing lane — no spawn.'
		},
		skills: [{ skillId: 'sk-roadmap', name: 'planning/roadmap_draft', bound: true }]
	}

	return [intentA, intentB]
}

export function createIntentFromTitle(title: string): IntentOrchestrator {
	const id = mockId('intent')
	const subId = mockId('sub')
	const skCatalog = mockId('sk')
	return {
		id,
		title,
		summary: `${title.slice(0, 120)}${title.length > 120 ? '…' : ''} — AvenCEO will organize the right skills.`,
		done: false,
		orchestratorLabel: 'AvenCEO',
		subAgents: [
			{
				id: subId,
				name: 'routing_stub',
				role: 'Getting context and next steps in order',
				status: 'running',
				parentOrchestratorId: id,
				skillId: skCatalog
			}
		],
		activity: [
			{
				id: mockId('act'),
				at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
				kind: 'human',
				title: 'You added this intent',
				detail: title
			},
			{
				id: mockId('act'),
				at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
				kind: 'orchestrator',
				title: 'AvenCEO is on it',
				detail: 'Organizing skills for this goal (demo only — nothing leaves your browser).'
			}
		],
		toolCalls: [
			{
				id: mockId('tool'),
				agentId: subId,
				tool: 'noop_echo',
				inputSummary: title.slice(0, 80),
				outputSummary: 'ack',
				status: 'ok'
			}
		],
		hitlTodos: [],
		config: {
			routingMode: 'select',
			workerClassLabel: 'mock_default',
			notes: 'Add Human review cards from the demo control when presenting.'
		},
		skills: [{ skillId: skCatalog, name: 'demo/placeholder', bound: true }]
	}
}
