// aven-ontology — a pure, declarative CRUD/query engine over x1–x5 predications (board 0088).
// Register a type (a bundle spec) and get generic mutate + Datalog-style projection for free.

export { create, query, remove, resolveBind, update } from './engine.js'
export { memStore } from './memstore.js'
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
// board 0102 — aven-ontology no longer ships DOMAIN bundle specs (todo/document/invoice/contact). Bundles
// are dynamic runtime config in `data_bundles`, authored by GLM or the user — the engine is generic and
// domain-free. The historical seed snapshots live frozen in betterauth's `legacy-bundle-fixtures.ts`,
// never imported at runtime.
