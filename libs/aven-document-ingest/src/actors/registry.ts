import type { Actor, Manifest } from '@avenos/actors'
import type { DocumentModelGateway } from '../model'
import type { DocumentDecoder } from '../shared'
import { CONTENT_AGGREGATOR_MANIFEST, createContentAggregatorActor } from './content-aggregator'
import {
	CSV_STATEMENT_ADMITTER_MANIFEST,
	createCsvStatementAdmitterActor
} from './csv-statement-admitter'
import {
	CSV_STATEMENT_DETECTOR_MANIFEST,
	createCsvStatementDetectorActor
} from './csv-statement-detector'
import { createDocumentAssemblerActor, DOCUMENT_ASSEMBLER_MANIFEST } from './document-assembler'
import { createDocumentDecomposerActor, DOCUMENT_DECOMPOSER_MANIFEST } from './document-decomposer'
import { createDocumentInspectorActor, DOCUMENT_INSPECTOR_MANIFEST } from './document-inspector'
import {
	createDocumentKindClassifierActor,
	DOCUMENT_KIND_CLASSIFIER_MANIFEST
} from './document-kind-classifier'
import { createInvoiceExtractorActor, INVOICE_EXTRACTOR_MANIFEST } from './invoice-extractor'
import { createInvoiceValidatorActor, INVOICE_VALIDATOR_MANIFEST } from './invoice-validator'
import {
	createNativeTextExtractorActor,
	NATIVE_TEXT_EXTRACTOR_MANIFEST
} from './native-text-extractor'
import {
	createOpenItemNormalizerActor,
	OPEN_ITEM_NORMALIZER_MANIFEST
} from './open-item-normalizer'
import {
	createPageSignalClassifierActor,
	PAGE_SIGNAL_CLASSIFIER_MANIFEST
} from './page-signal-classifier'
import {
	createReconciliationRankerActor,
	RECONCILIATION_RANKER_MANIFEST
} from './reconciliation-ranker'
import { createStatementExtractorActor, STATEMENT_EXTRACTOR_MANIFEST } from './statement-extractor'
import {
	createStatementNormalizerActor,
	STATEMENT_NORMALIZER_MANIFEST
} from './statement-normalizer'
import {
	createStatementTransactionFanoutActor,
	STATEMENT_TRANSACTION_FANOUT_MANIFEST
} from './statement-transaction-fanout'
import { createStatementValidatorActor, STATEMENT_VALIDATOR_MANIFEST } from './statement-validator'
import {
	createVisualPageAnalyzerActor,
	VISUAL_PAGE_ANALYZER_MANIFEST
} from './visual-page-analyzer'

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
