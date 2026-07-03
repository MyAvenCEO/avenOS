// The declarative engine's type model (board 0088). A composite "type" (e.g. todos) is a BUNDLE of
// x1–x5 predications + how to project them — there is NO domain code per type, only this spec.

/** A predication place value. Predications store only strings or null in x1…x5. */
export type Cell = string | null
export type Place = 'x1' | 'x2' | 'x3' | 'x4' | 'x5'

/** One predication row, flattened: the row id plus its x1…x5 cells (the predicate is the store key). */
export type Row = { id: string } & Partial<Record<Place, Cell>>

/**
 * A binding resolved against the mutation context. Forms:
 *   `$user`    → the acting user id
 *   `$primary` → the primary (entity) row id
 *   `$parent`  → the PARENT entity id (set while creating a child sub-entity; null otherwise)
 *   `$now`     → ISO timestamp
 *   `$value`   → the current input field's value
 *   `$value?$now:null` → conditional (truthy raw value → THEN, else ELSE); operands are bindings
 *   anything else → a literal
 */
export type Bind = string

// board 0112 — `many`: a 0..N satellite (e.g. tags) DECLARED on the bundle so entity deletion cascades its
// rows, but EXCLUDED from the derived list joins (it would multiply base rows) and from create/update (its
// writes are hand-authored operations, e.g. todos.tag / todos.untag). Declaration = ownership, not CRUD.
export type PartKind = 'primary' | 'singleton' | 'replace' | 'children' | 'many'

/**
 * One predication that participates in a composite type:
 *  - `primary`:   its rows ARE the entities (the task). `field` drives create; `set` patches it.
 *  - `singleton`: exactly one linked row, created WITH the entity (`create`) and patched in place (`set`).
 *  - `replace`:   an optional linked attribute — setting it deletes the linked row(s) then re-inserts
 *                 (`set`) when the field has a value (cleared when empty).
 *  - `children`:  a 0..N array field where each element is its OWN sub-entity (`childSpec`), created
 *                 recursively and linked to the parent via `link` (the place on the child PRIMARY that
 *                 holds the parent id — bound to `$parent` in the child spec). Replaced wholesale on update.
 */
export type PartSpec = {
	pred: string
	/** the place on THIS predication that holds the primary id (children: the place on the CHILD primary) */
	link?: Place
	kind: PartKind
	/** the input field that drives this part (e.g. title/done/due/priority; children: the array field) */
	field?: string
	/** places written when the entity is created */
	create?: Partial<Record<Place, Bind>>
	/** places written when `field` is set (singleton patches; replace/primary (re)write) */
	set?: Partial<Record<Place, Bind>>
	/** for kind:'children' — the sub-type each array element is created/projected as */
	childSpec?: TypeSpec
	/** for the PRIMARY — extra input fields written to its OWN places (place → field), e.g. a
	 *  transaction≡pleji carrying payer/payee/goods alongside the driving amount. board 0092. */
	fields?: Partial<Record<Place, string>>
	/** A DISCRIMINATOR: fixed cells that (a) are written on every insert of this part and (b) scope its
	 *  replace delete + its projection lookup. Lets MULTIPLE parts share one predicate, distinguished by
	 *  a stable place value — e.g. every contact channel is one `address`≡judri keyed by x3=system
	 *  (`addrsys-email`/…), every identifier one `identifier`≡tcita keyed by x1=kind (`idkind-vat_id`/…).
	 *  board 0097. */
	match?: Partial<Record<Place, Cell>>
}

/** How one output field is projected back from the predications. */
export type ProjectSpec = {
	pred: string
	/** read this place's value */
	place?: Place
	/** boolean: true when this place is present + non-null (e.g. done = valid.x3 is set) */
	notNull?: Place
	/** project the `children` part named by `pred` as an ARRAY of projected sub-entities */
	children?: boolean
	/** the same DISCRIMINATOR as the matching part (see [[PartSpec.match]]) — picks ONE linked row when
	 *  several parts share `pred` (e.g. the `email` channel = the `address` row whose x3=`addrsys-email`). */
	match?: Partial<Record<Place, Cell>>
}

/** A composite type: a bundle of predications + how to project them back into a flat record. */
export type TypeSpec = {
	type: string
	parts: PartSpec[]
	project: Record<string, ProjectSpec>
}

/** Context for resolving bindings during a mutation. `now` is a thunk so each call stamps fresh. */
export type MutateCtx = {
	user: string
	now: () => string
}

/**
 * The minimal predication store the engine drives. A pure in-memory impl ([[memStore]]) powers the
 * tests; the betterauth adapter implements the same interface over `data_value`, scoped to a user.
 */
export interface PredicationStore {
	rows(predicate: string): Promise<Row[]>
	insert(predicate: string, cells: Partial<Record<Place, Cell>>): Promise<string>
	patch(id: string, cells: Partial<Record<Place, Cell>>): Promise<void>
	patchWhere(
		predicate: string,
		place: Place,
		equals: string,
		cells: Partial<Record<Place, Cell>>
	): Promise<void>
	deleteWhere(predicate: string, place: Place, equals: string): Promise<void>
	remove(id: string): Promise<void>
}
