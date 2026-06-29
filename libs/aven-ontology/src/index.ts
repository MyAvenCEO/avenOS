// aven-ontology — a pure, declarative CRUD/query engine over x1–x5 predications (board 0088).
// Register a type (a bundle spec) and get generic mutate + Datalog-style projection for free.
export type {
	Bind,
	Cell,
	MutateCtx,
	PartKind,
	PartSpec,
	Place,
	PredicationStore,
	ProjectSpec,
	Row,
	TypeSpec
} from './types.js'
export { create, query, remove, resolveBind, update } from './engine.js'
export { memStore } from './memstore.js'
export { TODO_SPEC } from './todo-spec.js'
export { DOCUMENT_SPEC } from './document-spec.js'
