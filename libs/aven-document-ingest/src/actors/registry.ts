import type { Actor, Manifest } from '@avenos/actors'
import type { DocumentModelGateway } from '../model'
import type { DocumentDecoder } from '../shared'
import { CONTENT_AGGREGATOR_MANIFEST, createContentAggregatorActor } from './content-aggregator'
import { CSV_STATEMENT_ADMITTER_MANIFEST, createCsvStatementAdmitterActor } from './csv-statement-admitter'
import { CSV_STATEMENT_DETECTOR_MANIFEST, createCsvStatementDetectorActor } from './csv-statement-detector'
import { DOCUMENT_ASSEMBLER_MANIFEST, createDocumentAssemblerActor } from './document-assembler'
import { DOCUMENT_DECOMPOSER_MANIFEST, createDocumentDecomposerActor } from './document-decomposer'
import { DOCUMENT_INSPECTOR_MANIFEST, createDocumentInspectorActor } from './document-inspector'
import { DOCUMENT_KIND_CLASSIFIER_MANIFEST, createDocumentKindClassifierActor } from './document-kind-classifier'
import { INVOICE_EXTRACTOR_MANIFEST, createInvoiceExtractorActor } from './invoice-extractor'
import { INVOICE_VALIDATOR_MANIFEST, createInvoiceValidatorActor } from './invoice-validator'
import { NATIVE_TEXT_EXTRACTOR_MANIFEST, createNativeTextExtractorActor } from './native-text-extractor'
import { OPEN_ITEM_NORMALIZER_MANIFEST, createOpenItemNormalizerActor } from './open-item-normalizer'
import { PAGE_SIGNAL_CLASSIFIER_MANIFEST, createPageSignalClassifierActor } from './page-signal-classifier'
import { RECONCILIATION_RANKER_MANIFEST, createReconciliationRankerActor } from './reconciliation-ranker'
import { STATEMENT_EXTRACTOR_MANIFEST, createStatementExtractorActor } from './statement-extractor'
import { STATEMENT_NORMALIZER_MANIFEST, createStatementNormalizerActor } from './statement-normalizer'
import { STATEMENT_TRANSACTION_FANOUT_MANIFEST, createStatementTransactionFanoutActor } from './statement-transaction-fanout'
import { STATEMENT_VALIDATOR_MANIFEST, createStatementValidatorActor } from './statement-validator'
import { VISUAL_PAGE_ANALYZER_MANIFEST, createVisualPageAnalyzerActor } from './visual-page-analyzer'

/** Release-owned data inventory. Importing it does not decode, infer, or spawn. */
export const DOCUMENT_ACTOR_MANIFESTS: readonly Manifest[] = Object.freeze([
	CSV_STATEMENT_DETECTOR_MANIFEST,
	CSV_STATEMENT_ADMITTER_MANIFEST,
	DOCUMENT_INSPECTOR_MANIFEST,
	DOCUMENT_DECOMPOSER_MANIFEST,
	NATIVE_TEXT_EXTRACTOR_MANIFEST,
	PAGE_SIGNAL_CLASSIFIER_MANIFEST,
	DOCUMENT_ASSEMBLER_MANIFEST,
	CONTENT_AGGREGATOR_MANIFEST,
	VISUAL_PAGE_ANALYZER_MANIFEST,
	DOCUMENT_KIND_CLASSIFIER_MANIFEST,
	INVOICE_EXTRACTOR_MANIFEST,
	STATEMENT_EXTRACTOR_MANIFEST,
	INVOICE_VALIDATOR_MANIFEST,
	STATEMENT_VALIDATOR_MANIFEST,
	OPEN_ITEM_NORMALIZER_MANIFEST,
	STATEMENT_NORMALIZER_MANIFEST,
	STATEMENT_TRANSACTION_FANOUT_MANIFEST,
	RECONCILIATION_RANKER_MANIFEST
])

export interface DocumentActors {
	inspect: Actor
	decompose: Actor
	extractText: Actor
	classifyPage: Actor
	assemble: Actor
	aggregate: Actor
	analyzePage?: Actor
	classifyDocument?: Actor
	extractInvoice?: Actor
	extractStatement?: Actor
	validateInvoice: Actor
	validateStatement: Actor
	normalizeOpenItem: Actor
	normalizeStatement: Actor
	fanoutStatementTransactions: Actor
	rankReconciliation: Actor
	all: Actor[]
}

/** Compose the built-in actor registry; each actor implementation owns one directory. */
export function createDocumentActors(
	decoder: DocumentDecoder,
	model?: DocumentModelGateway
): DocumentActors {
	const inspect = createDocumentInspectorActor(decoder)
	const csvDetector = createCsvStatementDetectorActor()
	const csvAdmitter = createCsvStatementAdmitterActor()
	const decompose = createDocumentDecomposerActor()
	const extractText = createNativeTextExtractorActor(decoder)
	const classifyPage = createPageSignalClassifierActor()
	const assemble = createDocumentAssemblerActor()
	const aggregate = createContentAggregatorActor()
	const analyzePage = model ? createVisualPageAnalyzerActor(model, decoder) : undefined
	const classifyDocument = model ? createDocumentKindClassifierActor(model, decoder) : undefined
	const extractInvoice = model ? createInvoiceExtractorActor(model, decoder) : undefined
	const extractStatement = model ? createStatementExtractorActor(model, decoder) : undefined
	const validateInvoice = createInvoiceValidatorActor()
	const validateStatement = createStatementValidatorActor()
	const normalizeOpenItem = createOpenItemNormalizerActor()
	const normalizeStatement = createStatementNormalizerActor()
	const fanoutStatementTransactions = createStatementTransactionFanoutActor()
	const rankReconciliation = createReconciliationRankerActor()
	const optionalModelActors = [
		analyzePage,
		classifyDocument,
		extractInvoice,
		extractStatement
	].filter((actor): actor is Actor => Boolean(actor))
	return {
		inspect,
		decompose,
		extractText,
		classifyPage,
		assemble,
		aggregate,
		analyzePage,
		classifyDocument,
		extractInvoice,
		extractStatement,
		validateInvoice,
		validateStatement,
		normalizeOpenItem,
		normalizeStatement,
		fanoutStatementTransactions,
		rankReconciliation,
		all: [
			csvDetector,
			csvAdmitter,
			inspect,
			decompose,
			extractText,
			classifyPage,
			assemble,
			aggregate,
			...optionalModelActors,
			validateInvoice,
			validateStatement,
			normalizeOpenItem,
			normalizeStatement,
			fanoutStatementTransactions,
			rankReconciliation
		]
	}
}
