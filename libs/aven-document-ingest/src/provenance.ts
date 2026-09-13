export const DOCUMENT_PROCEDURES: Record<string, { actor: string; deterministic: boolean }> = {
	'client.merge-document-kinds': { actor: 'document-kind-classifier', deterministic: true },
	'client.merge-invoice-chunks': { actor: 'invoice-extractor', deterministic: true },
	'client.merge-statement-chunks': { actor: 'statement-extractor', deterministic: true },
	'client.detect-csv-statement': {
		actor: 'csv-statement-detector',
		deterministic: true
	},
	'client.confirm-csv-statement': {
		actor: 'csv-document-review',
		deterministic: true
	},
	'client.admit-csv-statement': {
		actor: 'csv-statement-admitter',
		deterministic: true
	},
	'client.review-reconciliation': {
		actor: 'reconciliation-review',
		deterministic: true
	},
	'client.inspect-file': {
		actor: 'document-inspector',
		deterministic: true
	},
	'client.decompose-pages': {
		actor: 'document-decomposer',
		deterministic: true
	},
	'client.extract-native-text': {
		actor: 'native-text-extractor',
		deterministic: true
	},
	'client.classify-page-signals': {
		actor: 'page-signal-classifier',
		deterministic: true
	},
	'client.assemble-document-representation': {
		actor: 'document-assembler',
		deterministic: true
	},
	'client.aggregate-content-classification': {
		actor: 'content-aggregator',
		deterministic: true
	},
	'client.analyze-page-model': {
		actor: 'visual-page-analyzer',
		deterministic: false
	},
	'client.classify-document-model': {
		actor: 'document-kind-classifier',
		deterministic: false
	},
	'client.extract-invoice-model': {
		actor: 'invoice-extractor',
		deterministic: false
	},
	'client.extract-statement-model': {
		actor: 'statement-extractor',
		deterministic: false
	},
	'client.validate-invoice': {
		actor: 'invoice-validator',
		deterministic: true
	},
	'client.validate-statement': {
		actor: 'statement-validator',
		deterministic: true
	},
	'client.normalize-invoice-open-item': {
		actor: 'open-item-normalizer',
		deterministic: true
	},
	'client.normalize-statement': {
		actor: 'statement-normalizer',
		deterministic: true
	},
	'client.fanout-statement-transactions': {
		actor: 'statement-transaction-fanout',
		deterministic: true
	},
	'client.rank-invoice-transactions': {
		actor: 'reconciliation-ranker',
		deterministic: true
	}
}
