import type { Actor } from './model'

/**
 * The declared population — every entry is the SAME primitive. What the
 * UI calls a "skill" is simply an actor with members; the sequence of
 * work inside it is not stored anywhere: it emerges from provides ∩
 * requires, exactly like the live bus derives its edges. English only,
 * functor names in the mesh's predicate style (arguments come later —
 * today's unification degrades to functor equality anyway).
 */

export const registry: Actor[] = [
	// ---------------------------------------------------------- inbox
	{
		id: 'inbox',
		manifest: {
			name: 'Inbox',
			about:
				'The one entrance: accept anything, classify it once, and turn documents into readable data.',
			requires: ['upload'],
			provides: ['positions', 'transactions', 'unknown'],
			tags: ['inbox']
		},
		members: ['accept', 'classify-item', 'triage', 'extract', 'parse-csv']
	},
	{
		id: 'accept',
		manifest: {
			name: 'Accept',
			about: 'Normalize the raw upload into one clean item.',
			type: 'ingest:normalize',
			requires: ['upload'],
			provides: ['item'],
			autonomy: {
				mode: 'auto',
				onError: 'retry',
				granted: {
					by: 'system',
					since: '2026-04-01',
					evidence: 'pure image operations, reproducible from the original'
				}
			}
		}
	},
	{
		id: 'classify-item',
		manifest: {
			name: 'Classify',
			about: 'One label per item — below the threshold it falls back instead of guessing.',
			type: 'llm:classify',
			requires: ['item'],
			provides: ['class'],
			llm: {
				purpose: 'Assign the item one known class with confidence.',
				constraints: ['confidence required', 'below threshold → unknown, never guess']
			},
			autonomy: {
				mode: 'sample',
				onError: 'human',
				granted: {
					by: 'samuel',
					since: '2026-07-01',
					evidence: 'correction rate 1.4 % over 800 items'
				}
			}
		}
	},
	{
		id: 'triage',
		manifest: {
			name: 'Triage',
			about:
				'Exactly one branch fires per item, along the class — what finds no class goes to a human.',
			type: 'route:by-class',
			requires: ['class'],
			provides: ['document', 'statement', 'unknown'],
			autonomy: {
				mode: 'auto',
				onError: 'human',
				granted: {
					by: 'system',
					since: '2026-08-14',
					evidence: 'pure branching on an already-made judgement'
				}
			}
		}
	},
	{
		id: 'extract',
		manifest: {
			name: 'Extract',
			about: 'Scan | PDF | e-invoice → positions with confidence.',
			requires: ['document'],
			provides: ['positions']
		},
		members: ['ocr', 'shape-positions']
	},
	{
		id: 'ocr',
		manifest: {
			name: 'Vision OCR',
			about: 'Read the scan with the document schema — structured data plus full text.',
			type: 'llm:vision',
			requires: ['document'],
			provides: ['reading']
		}
	},
	{
		id: 'shape-positions',
		manifest: {
			name: 'Shape positions',
			about: 'Fold the reading into schema-true positions.',
			type: 'transform:shape',
			requires: ['reading'],
			provides: ['positions']
		}
	},
	{
		id: 'parse-csv',
		manifest: {
			name: 'Parse CSV',
			about: 'A bank export becomes a transaction list.',
			type: 'transform:parse',
			requires: ['statement'],
			provides: ['transactions']
		}
	},
	// ----------------------------------------------------- accounting
	{
		id: 'accounting',
		manifest: {
			name: 'Accounting',
			about: 'Data becomes bookings: match payments, derive lines, four-eyes, lock.',
			requires: ['positions', 'transactions'],
			provides: ['locked', 'unmatched'],
			tags: ['accounting']
		},
		members: ['match', 'book']
	},
	{
		id: 'match',
		manifest: {
			name: 'Match',
			about: 'Find the payment that belongs to the invoice — or hand the unclear to a human.',
			type: 'llm:match',
			requires: ['transactions', 'positions'],
			provides: ['matched', 'unmatched'],
			autonomy: {
				mode: 'sample',
				onError: 'human',
				granted: { by: 'samuel', since: '2026-08-14', evidence: 'auto above 95 % score' }
			}
		}
	},
	{
		id: 'book',
		manifest: {
			name: 'Book',
			about: 'The tax core: derive lines, validate, approve, lock — immutable after.',
			requires: ['positions', 'matched'],
			provides: ['locked'],
			tags: ['accounting']
		},
		members: ['derive-lines', 'validate', 'approve', 'lock']
	},
	{
		id: 'derive-lines',
		manifest: {
			name: 'Derive lines',
			about: 'Positions become debit/credit lines against the chart of accounts.',
			type: 'transform:derive',
			requires: ['positions', 'matched'],
			provides: ['lines']
		}
	},
	{
		id: 'validate',
		manifest: {
			name: 'Validate',
			about: 'Balanced, plausible, complete — or back to a human.',
			type: 'check:validate',
			requires: ['lines'],
			provides: ['valid']
		}
	},
	{
		id: 'approve',
		manifest: {
			name: 'Approve',
			about: 'The four eyes: a human countersigns before anything becomes immutable.',
			type: 'human:approve',
			requires: ['valid'],
			provides: ['approval']
		}
	},
	{
		id: 'lock',
		manifest: {
			name: 'Lock',
			about: 'Write the booking immutably, with journal anchor (GoBD).',
			type: 'sink:lock',
			requires: ['approval'],
			provides: ['locked']
		}
	},
	// ---------------------------------------------------- month close
	{
		id: 'close',
		manifest: {
			name: 'Month close',
			about:
				'The period actor: runs on the month, not the item — collect locked bookings, fold VAT, write and check the EXTF for the advisor.',
			requires: ['locked'],
			provides: ['extf'],
			tags: ['accounting']
		},
		members: ['collect', 'fold-vat', 'write-extf', 'check-extf']
	},
	{
		id: 'collect',
		manifest: {
			name: 'Collect',
			about: 'Gather everything locked in the period into one batch.',
			type: 'source:period',
			requires: ['locked'],
			provides: ['batch']
		}
	},
	{
		id: 'fold-vat',
		manifest: {
			name: 'Fold VAT',
			about: 'Fold input tax per the export rules.',
			type: 'transform:fold',
			requires: ['batch'],
			provides: ['folded']
		}
	},
	{
		id: 'write-extf',
		manifest: {
			name: 'Write EXTF',
			about: 'Serialize the batch into the DATEV exchange format.',
			type: 'transform:write',
			requires: ['folded'],
			provides: ['draft']
		}
	},
	{
		id: 'check-extf',
		manifest: {
			name: 'Check',
			about: 'Prove the file re-imports cleanly before it leaves the house.',
			type: 'check:roundtrip',
			requires: ['draft'],
			provides: ['extf']
		}
	},
	// ----------------------------------------------------------- notes
	{
		id: 'notes',
		manifest: {
			name: 'Notes',
			about: 'The smallest triage: a free-text note becomes an idea, a todo, or a question to you.',
			requires: ['note'],
			provides: ['idea', 'todo', 'unknown'],
			tags: ['notes']
		},
		members: ['classify-note', 'file-note']
	},
	{
		id: 'classify-note',
		manifest: {
			name: 'Judge',
			about: 'One label per note; anything doubtful is unknown, never guessed.',
			type: 'llm:classify',
			requires: ['note'],
			provides: ['judgement'],
			autonomy: {
				mode: 'sample',
				onError: 'human',
				granted: {
					by: 'samuel',
					since: '2026-08-14',
					evidence: 'a label without side effects — any mistake is one click to fix'
				}
			}
		}
	},
	{
		id: 'file-note',
		manifest: {
			name: 'File',
			about: 'Put the judged note where it belongs — idea board or todo list.',
			type: 'sink:list',
			requires: ['judgement'],
			provides: ['idea', 'todo', 'unknown']
		}
	},
	// ------------------------------------------------------------ hitl
	{
		id: 'human-desk',
		manifest: {
			name: 'Human desk',
			about:
				'The human in the loop, generic for every actor: one queue for the unclear, sorted by risk, answered with a reason.',
			requires: ['unknown', 'unmatched'],
			provides: ['decision'],
			tags: ['hitl']
		},
		members: ['rank', 'decide']
	},
	{
		id: 'rank',
		manifest: {
			name: 'Rank',
			about: 'Sort the open questions by risk, highest first.',
			type: 'transform:rank',
			requires: ['unknown', 'unmatched'],
			provides: ['ranked']
		}
	},
	{
		id: 'decide',
		manifest: {
			name: 'Decide',
			about: 'Ask the human — every answer flows back as a message and counts toward autonomy.',
			type: 'human:decide',
			requires: ['ranked'],
			provides: ['decision']
		}
	}
]
