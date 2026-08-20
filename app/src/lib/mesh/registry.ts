import type { Actor } from './model'

/**
 * The declared population — at FULL fidelity. The first-principles
 * collapse shrank the MODEL (one primitive, derived wiring); it must
 * not shrink the WORLD. This registry carries the domain depth of the
 * old recipe configs: three intake sources, case splitting, both
 * reading branches, the statement switch, chart-of-accounts context,
 * tax logic with scheme routing, TWO approvals, the whitelist loop
 * that makes autonomy earned — each as an actor with an honest
 * manifest, thresholds and rules in `config`, LLM constraints spelled
 * out. Wiring is still never stored: every edge on any canvas is
 * provides ∩ requires, and even skill boundaries are inferred.
 */

export const registry: Actor[] = [
	// ================================================== INBOX (skill)
	{
		id: 'inbox',
		manifest: {
			name: 'Inbox',
			about:
				'The one entrance: mail, postbox and uploads become cases, get classified once, and documents turn into readable data — positions and transactions out, the unclear to a human.',
			requires: ['intake'],
			provides: ['positions', 'transactions', 'fulltext', 'unknown'],
			tags: ['inbox']
		},
		members: [
			'mail',
			'postbox',
			'upload-src',
			'accept',
			'split',
			'classify-item',
			'triage',
			'extract',
			'statement-route',
			'parse-csv',
			'read-statement'
		]
	},
	{
		id: 'mail',
		manifest: {
			name: 'E-mail',
			about: 'Watches the mailbox; every attachment and body becomes intake.',
			type: 'source:mail',
			provides: ['intake'],
			config: { dedupe: 'message-id' }
		}
	},
	{
		id: 'postbox',
		manifest: {
			name: 'Postbox',
			about: 'The scanning service for paper mail — letters arrive as images.',
			type: 'source:post',
			provides: ['intake']
		}
	},
	{
		id: 'upload-src',
		manifest: {
			name: 'Upload',
			about: 'Drag & drop and share-sheet: the manual door into the same lane.',
			type: 'source:upload',
			provides: ['intake']
		}
	},
	{
		id: 'accept',
		manifest: {
			name: 'Accept',
			about: 'Normalize whatever arrived into one clean envelope.',
			type: 'ingest:normalize',
			requires: ['intake'],
			provides: ['item'],
			config: { envelope: ['source', 'time', 'text', 'attachments', 'meta'], dedupe: 'hash' },
			autonomy: {
				mode: 'auto',
				onError: 'retry',
				granted: {
					by: 'system',
					since: '2026-04-01',
					evidence: 'pure normalization, reproducible from the original at any time'
				}
			}
		}
	},
	{
		id: 'split',
		manifest: {
			name: 'Split cases',
			about:
				'One upload may hold several cases — a stapled scan, a mail with three attachments. Split them, keep the origin reference.',
			type: 'llm:split',
			requires: ['item'],
			provides: ['case'],
			config: { keepOrigin: true },
			llm: {
				purpose: 'Recognize case boundaries inside one intake item.',
				constraints: ['never drops pages', 'origin reference mandatory']
			}
		}
	},
	{
		id: 'classify-item',
		manifest: {
			name: 'Classify',
			about:
				'One class per case, measured against a threshold — below it the case is unknown, never guessed.',
			type: 'llm:classify',
			requires: ['case'],
			provides: ['class'],
			config: {
				classes: ['document', 'statement'],
				docTypes: ['invoice', 'bank-statement', 'other'],
				threshold: 0.8,
				belowThreshold: 'unknown'
			},
			llm: {
				purpose: 'Assign the case one known class and document type, with confidence.',
				constraints: [
					'confidence required',
					'below threshold → unknown, never guess',
					'a reason per assignment'
				]
			},
			autonomy: {
				mode: 'sample',
				onError: 'human',
				granted: {
					by: 'samuel',
					since: '2026-07-01',
					evidence: 'correction rate 1.4 % over 800 items; every 20th stays fully checked'
				}
			}
		}
	},
	{
		id: 'triage',
		manifest: {
			name: 'Triage',
			about:
				'Exactly one branch fires per case, along the class — what finds no class goes to a human, not into a placeholder.',
			type: 'route:by-class',
			requires: ['class'],
			provides: ['document', 'statement', 'unknown'],
			autonomy: {
				mode: 'auto',
				onError: 'human',
				granted: {
					by: 'system',
					since: '2026-08-14',
					evidence: 'pure branching on an already-made judgement — decides nothing itself'
				}
			}
		}
	},
	// -------- extract: the document reading branch (a coordinator)
	{
		id: 'extract',
		manifest: {
			name: 'Extract',
			about:
				'Scan | PDF text | e-invoice → positions with confidence, plus the full text. The scan branch is its own reading colony.',
			requires: ['document'],
			provides: ['positions', 'fulltext']
		},
		members: ['doc-route', 'parse-einvoice', 'parse-pdftext', 'read-scan', 'shape-positions']
	},
	{
		id: 'doc-route',
		manifest: {
			name: 'Format switch',
			about: 'E-invoice, born-digital PDF, or scan — three very different reads.',
			type: 'route:by-format',
			requires: ['document'],
			provides: ['e-invoice', 'pdf-text', 'scan']
		}
	},
	{
		id: 'parse-einvoice',
		manifest: {
			name: 'Parse e-invoice',
			about: 'Structured XML straight to schema-true positions — no model needed.',
			type: 'transform:parse',
			requires: ['e-invoice'],
			provides: ['positions'],
			config: { formats: ['XRechnung', 'ZUGFeRD'] }
		}
	},
	{
		id: 'parse-pdftext',
		manifest: {
			name: 'Positions from text',
			about: 'A born-digital PDF carries its text — extract positions from it directly.',
			type: 'llm:extract',
			requires: ['pdf-text'],
			provides: ['positions'],
			llm: {
				purpose: 'Read positions out of machine text against the invoice schema.',
				constraints: ['schema-true output', 'confidence per field']
			}
		}
	},
	{
		id: 'read-scan',
		manifest: {
			name: 'Read scan',
			about: 'The vision colony: prepare the image, choose the schema, read.',
			requires: ['scan'],
			provides: ['reading']
		},
		members: ['preprocess', 'choose-schema', 'ocr']
	},
	{
		id: 'preprocess',
		manifest: {
			name: 'Preprocess',
			about: 'Deskew, denoise, crop — the original stays untouched.',
			type: 'transform:image',
			requires: ['scan'],
			provides: ['prepared'],
			config: { ops: ['deskew', 'denoise', 'crop'] },
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
		id: 'choose-schema',
		manifest: {
			name: 'Choose schema',
			about: 'The document type picks the reading schema and the system prompt.',
			type: 'route:by-doctype',
			requires: ['scan'],
			provides: ['schema'],
			config: { schemas: ['invoice', 'bank-statement'] }
		}
	},
	{
		id: 'ocr',
		manifest: {
			name: 'Vision OCR',
			about: 'Read the prepared image with the chosen schema — structured data plus full text.',
			type: 'llm:vision',
			requires: ['prepared', 'schema'],
			provides: ['reading'],
			llm: {
				purpose: 'Turn a prepared page into schema-true data and full text.',
				constraints: ['confidence per field', 'no invented values — blanks stay blank']
			}
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
	// -------- the statement branch
	{
		id: 'statement-route',
		manifest: {
			name: 'Statement switch',
			about: 'CSV export or scanned statement — same destination, different read.',
			type: 'route:by-format',
			requires: ['statement'],
			provides: ['csv-file', 'scan-statement']
		}
	},
	{
		id: 'parse-csv',
		manifest: {
			name: 'Parse CSV',
			about: 'A bank export becomes a transaction list along the bank profile.',
			type: 'transform:parse',
			requires: ['csv-file'],
			provides: ['transactions'],
			config: { mapping: 'bank-profile', dateFormats: ['DD.MM.YYYY', 'ISO'] }
		}
	},
	{
		id: 'read-statement',
		manifest: {
			name: 'Read statement',
			about:
				'The same vision read as the invoice — with document type "bank-statement" it yields a transaction list. One reader, two document types.',
			type: 'llm:vision',
			requires: ['scan-statement'],
			provides: ['transactions']
		}
	},
	// ============================================= ACCOUNTING (skill)
	{
		id: 'accounting',
		manifest: {
			name: 'Accounting',
			about:
				'Data becomes bookings: payments against open items, positions into lines via chart-of-accounts context, four-eyes, lock. Composes the booking core, which is also a skill of its own.',
			requires: ['positions', 'transactions'],
			provides: ['locked', 'unmatched', 'open-items-update'],
			tags: ['accounting']
		},
		members: ['chart', 'bank-feed', 'open-items', 'match', 'book']
	},
	{
		id: 'chart',
		manifest: {
			name: 'Chart & policy',
			about:
				"The client's chart of accounts and booking policy — versioned, with history. Context for every booking decision.",
			type: 'source:master-data',
			provides: ['context'],
			config: { chart: 'client', policy: 'versioned', history: true }
		}
	},
	{
		id: 'bank-feed',
		manifest: {
			name: 'Bank feed',
			about: 'The live account feed — transactions arrive without an upload.',
			type: 'source:bank',
			provides: ['transactions']
		}
	},
	{
		id: 'open-items',
		manifest: {
			name: 'Open items',
			about: 'The current stock of open receivables and payables.',
			type: 'source:ledger',
			provides: ['open-item-stock']
		}
	},
	{
		id: 'match',
		manifest: {
			name: 'Match',
			about:
				'Find the payment that belongs to the invoice — auto above the score threshold, sampled below, the rest to a human.',
			type: 'llm:match',
			requires: ['transactions', 'open-item-stock'],
			provides: ['matched', 'unmatched'],
			config: { autoAbove: '95 %', sample: 'every 20th' },
			llm: {
				purpose: 'Pair transactions with open items.',
				constraints: [
					'score required',
					'never merges two candidates',
					'unclear goes out, not into a guess'
				]
			},
			autonomy: {
				mode: 'sample',
				onError: 'human',
				granted: {
					by: 'samuel',
					since: '2026-08-14',
					evidence: 'auto above 95 % score, sampled checks below'
				}
			}
		}
	},
	// -------- the booking core (a coordinator AND a skill of its own)
	{
		id: 'book',
		manifest: {
			name: 'Book',
			about:
				'The tax core: classify the cost kind, apply tax logic, derive lines, validate, route the tax scheme, two approvals, lock — immutable after.',
			requires: ['positions', 'matched', 'context'],
			provides: ['locked', 'open-items-update'],
			tags: ['accounting']
		},
		members: [
			'classify-cost',
			'tax',
			'derive-lines',
			'validate',
			'tax-route',
			'vat-due',
			'approve-gf',
			'approve',
			'lock'
		]
	},
	{
		id: 'classify-cost',
		manifest: {
			name: 'Classify cost kind',
			about:
				'Service kind → account CATEGORY — never the account number itself. Retrieval over the booking history comes before the model.',
			type: 'llm:classify',
			requires: ['positions', 'context'],
			provides: ['category'],
			config: { retrieval: 'booking-history', output: 'category', neverOutputs: ['account', 'bu'] },
			llm: {
				purpose: 'Service kind → account category.',
				constraints: [
					'NEVER outputs an account number or BU key',
					'retrieval before model',
					'a reason is mandatory'
				]
			}
		}
	},
	{
		id: 'tax',
		manifest: {
			name: 'Tax logic',
			about:
				'Deterministic tax rules: rate, reverse charge, §13b, intra-community — no model in this step, ever.',
			type: 'rules:tax',
			requires: ['category'],
			provides: ['tax-set'],
			config: { rules: ['rate', 'reverse-charge', '§13b', 'intra-community'], ustva: 'monthly' }
		}
	},
	{
		id: 'derive-lines',
		manifest: {
			name: 'Derive lines',
			about: 'Positions, category and tax set become debit/credit lines against the chart.',
			type: 'transform:derive',
			requires: ['positions', 'category', 'tax-set', 'matched'],
			provides: ['lines']
		}
	},
	{
		id: 'validate',
		manifest: {
			name: 'Validate',
			about: 'Balanced, plausible, complete — or back to a human, never silently on.',
			type: 'check:validate',
			requires: ['lines'],
			provides: ['valid'],
			config: { rules: ['balanced', 'plausible', 'complete', 'period-open'] }
		}
	},
	{
		id: 'tax-route',
		manifest: {
			name: 'Tax scheme',
			about: 'Accrual or cash accounting — the scheme decides when VAT falls due.',
			type: 'route:by-scheme',
			requires: ['valid'],
			provides: ['accrual', 'cash']
		}
	},
	{
		id: 'vat-due',
		manifest: {
			name: 'Post VAT due',
			about: 'Under cash accounting the VAT is posted when the payment arrives.',
			type: 'transform:post',
			requires: ['cash'],
			provides: ['vat-posted']
		}
	},
	{
		id: 'approve-gf',
		manifest: {
			name: 'Approve (management)',
			about: 'Above the threshold the management countersigns first.',
			type: 'human:approve',
			requires: ['valid'],
			provides: ['gf-approval'],
			config: { above: '10,000 €' }
		}
	},
	{
		id: 'approve',
		manifest: {
			name: 'Approve (bookkeeper)',
			about: 'The four eyes: the bookkeeper countersigns before anything becomes immutable.',
			type: 'human:approve',
			requires: ['valid'],
			provides: ['approval']
		}
	},
	{
		id: 'lock',
		manifest: {
			name: 'Lock',
			about: 'Write the booking immutably with journal anchor (GoBD) and update the open items.',
			type: 'sink:lock',
			requires: ['approval'],
			provides: ['locked', 'open-items-update'],
			config: { anchor: 'journal', immutable: true }
		}
	},
	// ============================================ MONTH CLOSE (skill)
	{
		id: 'close',
		manifest: {
			name: 'Month close',
			about:
				'The period actor: runs on the month, not the item. Collect locked bookings, batch them for the mandate, fold VAT, write and roundtrip-check the EXTF for the advisor.',
			requires: ['locked'],
			provides: ['extf'],
			tags: ['accounting']
		},
		members: ['advisor', 'collect', 'batch', 'fold-vat', 'write-extf', 'check-extf']
	},
	{
		id: 'advisor',
		manifest: {
			name: 'Mandate & advisor',
			about: 'Client number, consultant number, fiscal year — the export frame.',
			type: 'source:master-data',
			provides: ['mandate'],
			config: { client: 'mandate', consultant: 'advisor', period: 'month' }
		}
	},
	{
		id: 'collect',
		manifest: {
			name: 'Collect',
			about: 'Gather everything locked in the period — nothing unlocked ever leaves.',
			type: 'source:period',
			requires: ['locked'],
			provides: ['collectable']
		}
	},
	{
		id: 'batch',
		manifest: {
			name: 'Build batch',
			about: 'One batch per mandate and period, ordered and numbered.',
			type: 'transform:batch',
			requires: ['collectable', 'mandate'],
			provides: ['batch']
		}
	},
	{
		id: 'fold-vat',
		manifest: {
			name: 'Fold VAT',
			about: 'Fold input tax lines per the exchange rules.',
			type: 'transform:fold',
			requires: ['batch'],
			provides: ['folded']
		}
	},
	{
		id: 'write-extf',
		manifest: {
			name: 'Write EXTF',
			about: 'Serialize into the DATEV exchange format, header discipline included.',
			type: 'transform:write',
			requires: ['folded', 'mandate'],
			provides: ['draft'],
			config: { format: 'EXTF' }
		}
	},
	{
		id: 'check-extf',
		manifest: {
			name: 'Roundtrip check',
			about: 'Prove the file re-imports cleanly before it leaves the house.',
			type: 'check:roundtrip',
			requires: ['draft'],
			provides: ['extf']
		}
	},
	// ================================================== NOTES (skill)
	{
		id: 'notes',
		manifest: {
			name: 'Notes',
			about:
				'The smallest triage: a free-text note becomes an idea on the board or a todo on the list — no gate in between; only the unclear goes to a human.',
			requires: ['note'],
			provides: ['filed', 'unknown'],
			tags: ['notes']
		},
		members: ['classify-note', 'file-note', 'file-idea', 'idea-board', 'file-todo', 'todo-list']
	},
	{
		id: 'classify-note',
		manifest: {
			name: 'Judge',
			about:
				'One label per note, measured against the threshold; anything doubtful is unknown, never guessed.',
			type: 'llm:classify',
			requires: ['note'],
			provides: ['judgement'],
			config: { classes: ['idea', 'todo', 'unknown'], threshold: 0.6, fallback: 'unknown' },
			llm: {
				purpose: 'Assign a free note exactly one of three classes, leaving the text untouched.',
				constraints: [
					'exactly one class',
					'below threshold → unknown',
					'the note is never rewritten'
				]
			},
			autonomy: {
				mode: 'sample',
				onError: 'human',
				granted: {
					by: 'samuel',
					since: '2026-08-14',
					evidence:
						'a label without side effects — any mistake is visible on the board and one click to fix'
				}
			}
		}
	},
	{
		id: 'file-note',
		manifest: {
			name: 'Route judgement',
			about: 'Exactly one branch fires per note — the judgement decides, nobody else.',
			type: 'route:by-judgement',
			requires: ['judgement'],
			provides: ['idea', 'todo', 'unknown']
		}
	},
	{
		id: 'file-idea',
		manifest: {
			name: 'File idea',
			about:
				'The note becomes a board entry: title, origin text, date — idempotent over the note id.',
			type: 'list:append',
			requires: ['idea'],
			provides: ['idea-entry'],
			config: { list: 'idea-board', idempotent: 'note-id' }
		}
	},
	{
		id: 'idea-board',
		manifest: {
			name: 'Idea board',
			about:
				'A list, not a second notes pile: what lands here awaits a decision, not a classification.',
			type: 'sink:list',
			requires: ['idea-entry'],
			provides: ['filed'],
			config: { view: 'list', sort: 'newest-first' }
		}
	},
	{
		id: 'file-todo',
		manifest: {
			name: 'File todo',
			about: 'Same mechanics as the idea, other list — a todo is an entry, not a decision.',
			type: 'list:append',
			requires: ['todo'],
			provides: ['todo-entry'],
			config: { list: 'todo-list', idempotent: 'note-id' }
		}
	},
	{
		id: 'todo-list',
		manifest: {
			name: 'Todo list',
			about: 'What to do, in one place — the decision happens at check-off, not at intake.',
			type: 'sink:list',
			requires: ['todo-entry'],
			provides: ['filed'],
			config: { view: 'list', sort: 'newest-first' }
		}
	},
	// ============================================= HUMAN DESK (skill)
	{
		id: 'human-desk',
		manifest: {
			name: 'Human desk',
			about:
				'The human in the loop, generic for every actor: one queue for the unclear, the unmatched and the failed — sorted by risk, answered with a reason, and every answer counts toward autonomy.',
			requires: ['unknown', 'unmatched', 'error'],
			provides: ['decision', 'actor-caps'],
			tags: ['hitl']
		},
		members: ['rank', 'decide', 'caps']
	},
	{
		id: 'rank',
		manifest: {
			name: 'Rank',
			about: 'Sort the open questions by risk, highest first — money before labels.',
			type: 'transform:rank',
			requires: ['unknown', 'unmatched', 'error'],
			provides: ['ranked'],
			config: { order: 'risk descending' }
		}
	},
	{
		id: 'decide',
		manifest: {
			name: 'Decide',
			about:
				'Ask the human. The answer is a message like any other — and every correction becomes a rule for the next triage.',
			type: 'human:decide',
			requires: ['ranked'],
			provides: ['decision'],
			config: { effect: 'correction becomes rule' }
		}
	},
	{
		id: 'caps',
		manifest: {
			name: 'Whitelist & autonomy',
			about: 'Book every decision into the balance of the actor that caused it.',
			type: 'transform:caps',
			requires: ['decision'],
			provides: ['actor-caps']
		}
	},
	// =============================================== WHITELIST (skill)
	{
		id: 'whitelist',
		manifest: {
			name: 'Whitelist',
			about:
				'Autonomy is earned, per actor: decisions and late errors feed a balance; the balance promotes (human → sample → auto), demotes, or holds. No actor grants itself a level.',
			requires: ['decision', 'late-error'],
			provides: ['actor-caps'],
			tags: ['hitl']
		},
		members: ['balance', 'review', 'promote', 'demote']
	},
	{
		id: 'balance',
		manifest: {
			name: 'Balance per actor',
			about: 'Corrections, confirmations and late errors, tallied per actor.',
			type: 'transform:balance',
			requires: ['decision', 'late-error'],
			provides: ['record']
		}
	},
	{
		id: 'review',
		manifest: {
			name: 'Ready for the next level?',
			about: 'The route over the balance: promote, demote, or leave unchanged.',
			type: 'route:by-readiness',
			requires: ['record'],
			provides: ['ready', 'slipping', 'steady'],
			config: { promoteBelow: 'correction rate 2 %', demoteAbove: 'correction rate 5 %' }
		}
	},
	{
		id: 'promote',
		manifest: {
			name: 'Grant level',
			about: 'human → sample → auto, one step at a time, with the evidence written down.',
			type: 'transform:grant',
			requires: ['ready'],
			provides: ['actor-caps']
		}
	},
	{
		id: 'demote',
		manifest: {
			name: 'Revoke level',
			about: 'Slipping quality steps an actor back down — immediately, not at review time.',
			type: 'transform:revoke',
			requires: ['slipping'],
			provides: ['actor-caps']
		}
	}
]
