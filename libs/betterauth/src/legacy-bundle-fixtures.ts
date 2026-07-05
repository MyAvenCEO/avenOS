// board 0102 — FROZEN migration seed snapshots. These are the exact bundle specs the historical seed
// migrations (0014/0018/0020/0025/0027/0029/0031) inserted, captured verbatim so migration replay stays
// byte-identical AFTER the live domain specs were removed from @avenos/aven-ontology. DO NOT EDIT and DO
// NOT import at runtime — the running engine reads bundles from the data_bundles table, never from code.
// A bundle is a named set of traits (which predicates cluster) + a view (how they read back flat).
import type { TypeSpec } from '@avenos/aven-ontology'

export const TODO_SPEC: TypeSpec = {
	type: 'todos',
	parts: [
		{
			pred: 'task',
			kind: 'primary',
			field: 'title',
			create: {
				x1: '$user',
				x2: '$value'
			},
			set: {
				x2: '$value'
			}
		},
		{
			pred: 'owned_by',
			kind: 'singleton',
			link: 'x2',
			create: {
				x1: '$user'
			}
		},
		{
			pred: 'done',
			kind: 'replace',
			link: 'x1',
			field: 'done',
			set: {
				x1: '$primary'
			}
		},
		{
			pred: 'due',
			kind: 'replace',
			link: 'x2',
			field: 'due',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'prioritized',
			kind: 'replace',
			link: 'x1',
			field: 'priority',
			set: {
				x1: '$primary',
				x2: '$user',
				x3: '$value'
			}
		}
	],
	project: {
		title: {
			pred: 'task',
			place: 'x2'
		},
		done: {
			pred: 'done',
			notNull: 'x1'
		},
		due: {
			pred: 'due',
			place: 'x1'
		},
		priority: {
			pred: 'prioritized',
			place: 'x3'
		},
		owner: {
			pred: 'owned_by',
			place: 'x1'
		}
	}
}

export const DOCUMENT_SPEC: TypeSpec = {
	type: 'document',
	parts: [
		{
			pred: 'document',
			kind: 'primary',
			field: 'title',
			create: {
				x2: '$value'
			},
			set: {
				x2: '$value'
			}
		},
		{
			pred: 'owned_by',
			kind: 'singleton',
			link: 'x2',
			create: {
				x1: '$user'
			}
		},
		{
			pred: 'kind',
			kind: 'replace',
			link: 'x2',
			field: 'kind',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'summary',
			kind: 'replace',
			link: 'x2',
			field: 'summary',
			set: {
				x2: '$primary',
				x4: '$value'
			}
		},
		{
			pred: 'source',
			kind: 'replace',
			link: 'x2',
			field: 'artifact',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'produced',
			kind: 'replace',
			link: 'x2',
			field: 'run',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		}
	],
	project: {
		title: {
			pred: 'document',
			place: 'x2'
		},
		kind: {
			pred: 'kind',
			place: 'x1'
		},
		summary: {
			pred: 'summary',
			place: 'x4'
		},
		owner: {
			pred: 'owned_by',
			place: 'x1'
		},
		artifact: {
			pred: 'source',
			place: 'x1'
		},
		run: {
			pred: 'produced',
			place: 'x1'
		}
	}
}

export const INVOICE_SPEC: TypeSpec = {
	type: 'invoice',
	parts: [
		{
			pred: 'invoice',
			kind: 'primary',
			field: 'number',
			create: {
				x3: '$user'
			},
			set: {},
			fields: {
				x4: 'billed_by'
			}
		},
		{
			pred: 'owned_by',
			kind: 'singleton',
			link: 'x2',
			create: {
				x1: '$user'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'number',
			match: {
				x1: 'idkind-invoice_number'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'total',
			kind: 'replace',
			link: 'x2',
			field: 'total',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'due',
			kind: 'replace',
			link: 'x2',
			field: 'due',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'source',
			kind: 'replace',
			link: 'x2',
			field: 'artifact',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'produced',
			kind: 'replace',
			link: 'x2',
			field: 'run',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'line',
			kind: 'children',
			field: 'lines',
			link: 'x2',
			childSpec: {
				type: 'line',
				parts: [
					{
						pred: 'line',
						kind: 'primary',
						field: 'description',
						create: {
							x2: '$parent'
						}
					},
					{
						pred: 'description',
						kind: 'replace',
						link: 'x2',
						field: 'description',
						set: {
							x2: '$primary',
							x4: '$value'
						}
					},
					{
						pred: 'quantity',
						kind: 'replace',
						link: 'x1',
						field: 'quantity',
						set: {
							x1: '$primary',
							x2: '$value'
						}
					},
					{
						pred: 'unit_price',
						kind: 'replace',
						link: 'x2',
						field: 'unit_price',
						set: {
							x1: '$value',
							x2: '$primary'
						}
					},
					{
						pred: 'line_amount',
						kind: 'replace',
						link: 'x2',
						field: 'amount',
						set: {
							x1: '$value',
							x2: '$primary'
						}
					}
				],
				project: {
					description: {
						pred: 'description',
						place: 'x4'
					},
					quantity: {
						pred: 'quantity',
						place: 'x2'
					},
					unit_price: {
						pred: 'unit_price',
						place: 'x1'
					},
					amount: {
						pred: 'line_amount',
						place: 'x1'
					}
				}
			}
		},
		{
			pred: 'payment',
			kind: 'children',
			field: 'payments',
			link: 'x4',
			childSpec: {
				type: 'payment',
				parts: [
					{
						pred: 'payment',
						kind: 'primary',
						field: 'amount',
						create: {
							x2: '$value',
							x4: '$parent'
						}
					},
					{
						pred: 'paid_on',
						kind: 'replace',
						link: 'x2',
						field: 'date',
						set: {
							x1: '$value',
							x2: '$primary'
						}
					}
				],
				project: {
					amount: {
						pred: 'payment',
						place: 'x2'
					},
					date: {
						pred: 'paid_on',
						place: 'x1'
					}
				}
			}
		}
	],
	project: {
		number: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-invoice_number'
			}
		},
		total: {
			pred: 'total',
			place: 'x1'
		},
		buyer: {
			pred: 'invoice',
			place: 'x3'
		},
		billed_by: {
			pred: 'invoice',
			place: 'x4'
		},
		owner: {
			pred: 'owned_by',
			place: 'x1'
		},
		due: {
			pred: 'due',
			place: 'x1'
		},
		artifact: {
			pred: 'source',
			place: 'x1'
		},
		run: {
			pred: 'produced',
			place: 'x1'
		},
		lines: {
			pred: 'line',
			children: true
		},
		payments: {
			pred: 'payment',
			children: true
		}
	}
}

export const COMPANY_SPEC: TypeSpec = {
	type: 'company',
	parts: [
		{
			pred: 'company',
			kind: 'primary',
			field: 'name',
			create: {},
			set: {}
		},
		{
			pred: 'owned_by',
			kind: 'singleton',
			link: 'x2',
			create: {
				x1: '$user'
			}
		},
		{
			pred: 'name',
			kind: 'replace',
			link: 'x2',
			field: 'name',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'address',
			kind: 'replace',
			link: 'x2',
			field: 'email',
			match: {
				x3: 'addrsys-email'
			},
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'address',
			kind: 'replace',
			link: 'x2',
			field: 'phone',
			match: {
				x3: 'addrsys-phone'
			},
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'address',
			kind: 'replace',
			link: 'x2',
			field: 'iban',
			match: {
				x3: 'addrsys-iban'
			},
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'address',
			kind: 'replace',
			link: 'x2',
			field: 'postal',
			match: {
				x3: 'addrsys-postal'
			},
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'vat_id',
			match: {
				x1: 'idkind-vat_id'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'tax_number',
			match: {
				x1: 'idkind-tax_number'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		}
	],
	project: {
		name: {
			pred: 'name',
			place: 'x1'
		},
		email: {
			pred: 'address',
			place: 'x1',
			match: {
				x3: 'addrsys-email'
			}
		},
		phone: {
			pred: 'address',
			place: 'x1',
			match: {
				x3: 'addrsys-phone'
			}
		},
		iban: {
			pred: 'address',
			place: 'x1',
			match: {
				x3: 'addrsys-iban'
			}
		},
		postal: {
			pred: 'address',
			place: 'x1',
			match: {
				x3: 'addrsys-postal'
			}
		},
		vat_id: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-vat_id'
			}
		},
		tax_number: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-tax_number'
			}
		},
		owner: {
			pred: 'owned_by',
			place: 'x1'
		}
	}
}

export const PERSON_SPEC: TypeSpec = {
	type: 'person',
	parts: [
		{
			pred: 'person',
			kind: 'primary',
			field: 'name',
			create: {},
			set: {}
		},
		{
			pred: 'owned_by',
			kind: 'singleton',
			link: 'x2',
			create: {
				x1: '$user'
			}
		},
		{
			pred: 'name',
			kind: 'replace',
			link: 'x2',
			field: 'name',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'address',
			kind: 'replace',
			link: 'x2',
			field: 'email',
			match: {
				x3: 'addrsys-email'
			},
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'represents',
			kind: 'replace',
			link: 'x1',
			field: 'company',
			set: {
				x1: '$primary',
				x2: '$value'
			}
		}
	],
	project: {
		name: {
			pred: 'name',
			place: 'x1'
		},
		email: {
			pred: 'address',
			place: 'x1',
			match: {
				x3: 'addrsys-email'
			}
		},
		represents: {
			pred: 'represents',
			place: 'x2'
		},
		owner: {
			pred: 'owned_by',
			place: 'x1'
		}
	}
}

export const TRANSACTION_SPEC: TypeSpec = {
	type: 'transaction',
	parts: [
		{
			pred: 'transaction',
			kind: 'primary',
			field: 'amount',
			create: {
				x2: '$value'
			},
			set: {
				x2: '$value'
			},
			fields: {
				x3: 'payee',
				x4: 'invoice'
			}
		},
		{
			pred: 'owned_by',
			kind: 'singleton',
			link: 'x2',
			create: {
				x1: '$user'
			}
		},
		{
			pred: 'dated',
			kind: 'replace',
			link: 'x2',
			field: 'date',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'value_dated',
			kind: 'replace',
			link: 'x2',
			field: 'value_date',
			set: {
				x1: '$value',
				x2: '$primary'
			}
		},
		{
			pred: 'balance',
			kind: 'replace',
			link: 'x1',
			field: 'balance',
			set: {
				x1: '$primary',
				x2: '$value'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'currency',
			match: {
				x1: 'idkind-currency'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'exchange_rate',
			match: {
				x1: 'idkind-exchange_rate'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'fx_fee_percent',
			match: {
				x1: 'idkind-fx_fee_percent'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'original_currency',
			match: {
				x1: 'idkind-original_currency'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'original_amount',
			match: {
				x1: 'idkind-original_amount'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'identifier',
			kind: 'replace',
			link: 'x2',
			field: 'fx_surcharge',
			match: {
				x1: 'idkind-fx_surcharge'
			},
			set: {
				x2: '$primary',
				x3: '$value'
			}
		},
		{
			pred: 'booked',
			kind: 'replace',
			link: 'x1',
			field: 'account',
			set: {
				x1: '$primary',
				x2: '$value'
			}
		},
		{
			pred: 'matched',
			kind: 'replace',
			link: 'x1',
			field: 'matched_invoice',
			set: {
				x1: '$primary',
				x2: '$value'
			}
		}
	],
	project: {
		amount: {
			pred: 'transaction',
			place: 'x2'
		},
		payee: {
			pred: 'transaction',
			place: 'x3'
		},
		invoice: {
			pred: 'transaction',
			place: 'x4'
		},
		date: {
			pred: 'dated',
			place: 'x1'
		},
		value_date: {
			pred: 'value_dated',
			place: 'x1'
		},
		balance: {
			pred: 'balance',
			place: 'x2'
		},
		currency: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-currency'
			}
		},
		exchange_rate: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-exchange_rate'
			}
		},
		fx_fee_percent: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-fx_fee_percent'
			}
		},
		original_currency: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-original_currency'
			}
		},
		original_amount: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-original_amount'
			}
		},
		fx_surcharge: {
			pred: 'identifier',
			place: 'x3',
			match: {
				x1: 'idkind-fx_surcharge'
			}
		},
		account: {
			pred: 'booked',
			place: 'x2'
		},
		matched_invoice: {
			pred: 'matched',
			place: 'x2'
		},
		owner: {
			pred: 'owned_by',
			place: 'x1'
		}
	}
}
