import type { Actor, Message } from './model'

/**
 * The runtime population: intents ARE actors — born from an event,
 * carrying a goal (abject/DCI: the Context). And the only thing stored
 * about their work is HISTORY: the message log, abject's tuple-space
 * rule. Runs, states, boards, paths — all derived in model.ts.
 *
 * Correlation discipline: a reply shares the request's correlationId.
 * A message to `you` is the human in the loop. A message from one
 * intent to another is how a month waits on its items.
 */

export const intents: Actor[] = [
	{
		id: 'i-mueller',
		manifest: { name: 'Invoice Müller GmbH · RE-081', about: '' },
		born: {
			event: 'upload "scan-2026-08-14-0007.pdf"',
			goal: 'Read the scan, match the payment, lock the booking.',
			at: 'Aug 14, 10:03'
		}
	},
	{
		id: 'i-fresh',
		manifest: { name: 'Invoice Bergmann · RE-090', about: '' },
		born: {
			event: 'upload "scan-2026-08-20-0002.pdf"',
			goal: 'Read the scan, match the payment, lock the booking.',
			at: 'just now'
		}
	},
	{
		id: 'i-statement',
		manifest: { name: 'Bank statement August · CSV', about: '' },
		born: {
			event: 'bank export "statement-2026-08.csv"',
			goal: 'Read the transactions and match them against the open items.',
			at: 'Aug 19, 07:30'
		}
	},
	{
		id: 'i-weber',
		manifest: { name: 'Invoice Weber · RE-069', about: '' },
		born: {
			event: 'upload',
			goal: 'Read the scan, match the payment, lock the booking.',
			at: 'Aug 5'
		}
	},
	{
		id: 'i-note',
		manifest: { name: 'Note from the walk', about: '' },
		born: {
			event: 'voice note',
			goal: 'File the thought — or discard it deliberately.',
			at: 'Aug 14, 10:41'
		}
	},
	{
		id: 'i-month',
		manifest: { name: 'Month close August 2026', about: '' },
		born: {
			event: 'period "August 2026"',
			goal: 'Lock every item of the month and hand the EXTF to the advisor.',
			at: 'Aug 1'
		}
	}
]

/** Unrouted events — messages still missing their `to`. Routing = addressing. */
export const loose: (Message & { suggest?: { intent: string; why: string } })[] = [
	{
		id: 'e-1',
		correlationId: 'c-e1',
		at: '2 min ago',
		from: 'bank',
		method: 'route',
		text: '−450.00 € · "MUELLER GMBH RE081 DANKE" · Aug 12',
		suggest: {
			intent: 'i-mueller',
			why: 'the match of this intent is looking for exactly this payment'
		}
	}
]

export const threads: { intent: string; log: Message[] }[] = [
	{
		intent: 'i-mueller',
		log: [
			{
				id: 'm1',
				correlationId: 'c-m0',
				at: '10:03',
				from: 'upload',
				to: 'i-mueller',
				method: 'handle',
				text: 'scan-2026-08-14-0007.pdf'
			},
			{
				id: 'm2',
				correlationId: 'c-m1',
				at: '10:03',
				from: 'i-mueller',
				to: 'inbox',
				method: 'read'
			},
			{
				id: 'm3',
				correlationId: 'c-m2',
				at: '10:03',
				from: 'inbox',
				to: 'extract',
				method: 'extract'
			},
			{
				id: 'm4',
				correlationId: 'c-m3',
				at: '10:03',
				from: 'extract',
				to: 'ocr',
				method: 'read-scan'
			},
			{
				id: 'm5',
				correlationId: 'c-m3',
				at: '10:04',
				from: 'ocr',
				to: 'extract',
				method: 'read-scan',
				gives: ['reading'],
				data: { read: 'RE-2026-081 · 3 positions · confidence 91 %' }
			},
			{
				id: 'm6',
				correlationId: 'c-m2',
				at: '10:04',
				from: 'extract',
				to: 'inbox',
				method: 'extract',
				gives: ['positions']
			},
			{
				id: 'm7',
				correlationId: 'c-m1',
				at: '10:04',
				from: 'inbox',
				to: 'i-mueller',
				method: 'read',
				gives: ['positions'],
				text: '3 positions read'
			},
			{
				id: 'm8',
				correlationId: 'c-m4',
				at: '10:04',
				from: 'i-mueller',
				to: 'accounting',
				method: 'book'
			},
			{
				id: 'm9',
				correlationId: 'c-m5',
				at: '12:38',
				from: 'accounting',
				to: 'match',
				method: 'match'
			},
			{
				id: 'm10',
				correlationId: 'c-m5',
				at: '12:40',
				from: 'match',
				to: 'accounting',
				method: 'match',
				gives: ['matched'],
				data: {
					pair: 'Aug 12 · −450.00 € · "MUELLER GMBH RE081 DANKE"',
					score: '92 %',
					by: 'confirmed by you · Aug 14, 12:40'
				}
			},
			{
				id: 'm11',
				correlationId: 'c-m6',
				at: '12:40',
				from: 'accounting',
				to: 'book',
				method: 'book'
			},
			{
				id: 'm12',
				correlationId: 'c-m7',
				at: '12:40',
				from: 'book',
				to: 'derive-lines',
				method: 'derive'
			},
			{
				id: 'm13',
				correlationId: 'c-m7',
				at: '12:40',
				from: 'derive-lines',
				to: 'book',
				method: 'derive',
				gives: ['lines', 'valid'],
				data: {
					lines: [
						{ acct: '6815', label: 'Office supplies', debit: '378.15', credit: '' },
						{ acct: '1406', label: 'Input tax 19 %', debit: '71.85', credit: '' },
						{ acct: '3300', label: 'Payables', debit: '', credit: '450.00' }
					],
					sum: '450.00'
				}
			},
			{
				id: 'm14',
				correlationId: 'c-m8',
				at: '12:41',
				from: 'approve',
				to: 'you',
				method: 'approve',
				text: 'Approve and lock RE-081 — immutable after (GoBD)?'
			}
		]
	},
	{
		intent: 'i-fresh',
		log: [
			{
				id: 'f1',
				correlationId: 'c-f0',
				at: '09:58',
				from: 'upload',
				to: 'i-fresh',
				method: 'handle',
				text: 'scan-2026-08-20-0002.pdf'
			},
			{
				id: 'f2',
				correlationId: 'c-f1',
				at: '09:58',
				from: 'i-fresh',
				to: 'inbox',
				method: 'read'
			},
			{
				id: 'f3',
				correlationId: 'c-f2',
				at: '09:58',
				from: 'inbox',
				to: 'extract',
				method: 'extract'
			},
			{
				id: 'f4',
				correlationId: 'c-f3',
				at: '09:58',
				from: 'extract',
				to: 'ocr',
				method: 'read-scan',
				data: { read: 'reading the scan — schema "invoice" chosen' }
			},
			{
				id: 'f5',
				correlationId: 'c-f4',
				at: '09:58',
				from: 'i-fresh',
				to: 'accounting',
				method: 'book'
			}
		]
	},
	{
		intent: 'i-statement',
		log: [
			{
				id: 's1',
				correlationId: 'c-s0',
				at: '07:30',
				from: 'bank',
				to: 'i-statement',
				method: 'handle',
				text: 'statement-2026-08.csv'
			},
			{
				id: 's2',
				correlationId: 'c-s1',
				at: '07:30',
				from: 'i-statement',
				to: 'inbox',
				method: 'read'
			},
			{
				id: 's3',
				correlationId: 'c-s1',
				at: '07:31',
				from: 'inbox',
				to: 'i-statement',
				method: 'read',
				gives: ['transactions'],
				text: '18 transactions read',
				data: { read: 'statement-2026-08.csv · 18 transactions' }
			},
			{
				id: 's4',
				correlationId: 'c-s2',
				at: '07:31',
				from: 'i-statement',
				to: 'accounting',
				method: 'match'
			},
			{
				id: 's5',
				correlationId: 'c-s3',
				at: '07:32',
				from: 'accounting',
				to: 'match',
				method: 'match'
			},
			{
				id: 's6',
				correlationId: 'c-s3',
				at: '07:33',
				from: 'match',
				to: 'accounting',
				method: 'match',
				gives: ['matched', 'unmatched'],
				data: {
					pair: '15 of 18 matched automatically — 3 to the desk',
					score: '≥ 95 %',
					by: 'auto above 95 % · granted by samuel'
				}
			},
			{
				id: 's7',
				correlationId: 'c-s4',
				at: '07:33',
				from: 'i-statement',
				to: 'human-desk',
				method: 'decide'
			},
			{
				id: 's8',
				correlationId: 'c-s5',
				at: '07:33',
				from: 'human-desk',
				to: 'rank',
				method: 'rank'
			},
			{
				id: 's9',
				correlationId: 'c-s5',
				at: '07:33',
				from: 'rank',
				to: 'human-desk',
				method: 'rank',
				gives: ['ranked']
			},
			{
				id: 's10',
				correlationId: 'c-s6',
				at: '07:34',
				from: 'decide',
				to: 'you',
				method: 'decide',
				text: '−89.00 € · "AMAZON MKTP" · Aug 16 — and 2 more without an open item',
				data: {
					piece: '−89.00 € · "AMAZON MKTP" · Aug 16',
					why: 'no open item matches · low risk · 1 of 3',
					actions: [{ label: 'assign' }, { label: 'private' }, { label: 'defer' }]
				}
			}
		]
	},
	{
		intent: 'i-weber',
		log: [
			{
				id: 'w1',
				correlationId: 'c-w0',
				at: 'Aug 5',
				from: 'upload',
				to: 'i-weber',
				method: 'handle',
				text: 'weber-re069.pdf'
			},
			{
				id: 'w2',
				correlationId: 'c-w1',
				at: 'Aug 5',
				from: 'i-weber',
				to: 'inbox',
				method: 'read'
			},
			{
				id: 'w3',
				correlationId: 'c-w1',
				at: 'Aug 5',
				from: 'inbox',
				to: 'i-weber',
				method: 'read',
				gives: ['positions'],
				text: '2 positions read · confidence 95 %'
			},
			{
				id: 'w4',
				correlationId: 'c-w2',
				at: 'Aug 6',
				from: 'i-weber',
				to: 'accounting',
				method: 'book'
			},
			{
				id: 'w5',
				correlationId: 'c-w2',
				at: 'Aug 13',
				from: 'accounting',
				to: 'i-weber',
				method: 'book',
				gives: ['matched', 'lines', 'valid', 'approval', 'locked'],
				data: {
					lines: [
						{ acct: '6805', label: 'Phone', debit: '747.90', credit: '' },
						{ acct: '1406', label: 'Input tax 19 %', debit: '142.10', credit: '' },
						{ acct: '3300', label: 'Payables', debit: '', credit: '890.00' }
					],
					sum: '890.00',
					locked: 'Journal J-2026-0803 · Aug 13'
				}
			},
			{
				id: 'w6',
				correlationId: 'c-w0',
				at: 'Aug 13',
				from: 'i-weber',
				to: 'upload',
				method: 'handle',
				gives: ['locked'],
				text: 'locked · Journal J-2026-0803'
			}
		]
	},
	{
		intent: 'i-note',
		log: [
			{
				id: 'n1',
				correlationId: 'c-n0',
				at: '10:41',
				from: 'voice',
				to: 'i-note',
				method: 'handle',
				text: 'something about visibility and trust — think again later'
			},
			{ id: 'n2', correlationId: 'c-n1', at: '10:41', from: 'i-note', to: 'notes', method: 'file' },
			{
				id: 'n3',
				correlationId: 'c-n2',
				at: '10:41',
				from: 'notes',
				to: 'classify-note',
				method: 'judge'
			},
			{
				id: 'n4',
				correlationId: 'c-n2',
				at: '10:41',
				from: 'classify-note',
				to: 'notes',
				method: 'judge',
				gives: ['judgement'],
				data: {
					note: 'something about visibility and trust — think again later',
					bars: [
						{ label: 'idea', pct: 41, width: 'width: 41%' },
						{ label: 'todo', pct: 31, width: 'width: 31%' },
						{ label: 'unknown', pct: 28, width: 'width: 28%' }
					],
					verdict: 'no clear judgement — best 41 % below the threshold of 60 %',
					actions: [{ label: 'as idea' }, { label: 'as todo' }, { label: 'discard' }]
				}
			},
			{
				id: 'n5',
				correlationId: 'c-n3',
				at: '10:41',
				from: 'file-note',
				to: 'you',
				method: 'decide',
				text: 'No class above threshold — your call.'
			}
		]
	},
	{
		intent: 'i-month',
		log: [
			{
				id: 'c1',
				correlationId: 'c-c0',
				at: 'Aug 1',
				from: 'period',
				to: 'i-month',
				method: 'close',
				text: 'August 2026'
			},
			{
				id: 'c2',
				correlationId: 'c-c1',
				at: 'Aug 1',
				from: 'i-month',
				to: 'i-mueller',
				method: 'locked'
			},
			{
				id: 'c3',
				correlationId: 'c-c2',
				at: 'Aug 1',
				from: 'i-month',
				to: 'i-fresh',
				method: 'locked'
			},
			{
				id: 'c4',
				correlationId: 'c-c3',
				at: 'Aug 1',
				from: 'i-month',
				to: 'i-statement',
				method: 'locked'
			},
			{
				id: 'c5',
				correlationId: 'c-c4',
				at: 'Aug 1',
				from: 'i-month',
				to: 'i-weber',
				method: 'locked'
			},
			{
				id: 'c6',
				correlationId: 'c-c4',
				at: 'Aug 13',
				from: 'i-weber',
				to: 'i-month',
				method: 'locked',
				gives: ['locked'],
				text: 'Journal J-2026-0803'
			},
			{
				id: 'c7',
				correlationId: 'c-c5',
				at: 'Aug 13',
				from: 'i-month',
				to: 'close',
				method: 'export',
				data: { collected: '1 of 4 items locked · EXTF waiting' }
			}
		]
	}
]
