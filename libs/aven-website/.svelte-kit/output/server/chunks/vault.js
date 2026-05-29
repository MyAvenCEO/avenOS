import { a as resolveWikilinkToVaultPath, i as normalizeWikilinkPath, o as bodyAfterFrontmatter, r as isTalkTurnWikilinkPath, s as parseMarkdownFrontmatter, t as forEachWikilinkPath } from "./wikilink-parse.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
//#region src/lib/seed/seed-service.ts
/** OpenAI-format memory tool definitions living under `.data/` after sync (editable at runtime). */
function maiaMemoryToolsJsonPath() {
	return path.join(resolveRepoRoot(), ".data", "agents", "maia", "tools", "memory.openai.json");
}
function seedDir() {
	return path.join(resolveRepoRoot(), "seed");
}
function copySeedIfMissing(seedRel, destAbs) {
	const src = path.join(seedDir(), ...seedRel.split("/"));
	if (!fs.existsSync(src)) throw new Error(`Missing committed seed file: ${src}`);
	if (fs.existsSync(destAbs)) return;
	fs.mkdirSync(path.dirname(destAbs), { recursive: true });
	fs.copyFileSync(src, destAbs);
}
var didSync = false;
/**
* Copies known seed files into `.data/` once per process when targets are missing.
* Does not overwrite existing runtime files (user/agent edits stay).
*/
function ensureSeedRuntimeSynced() {
	if (didSync) return;
	didSync = true;
	const root = resolveRepoRoot();
	copySeedIfMissing("agents/maia/SOUL.md", path.join(root, ".data", "agents", "maia", "SOUL.md"));
	copySeedIfMissing("memory/tools/memory.openai.json", path.join(root, ".data", "agents", "maia", "tools", "memory.openai.json"));
}
var PERMISSION_INTROSPECTION_COLUMNS = [
	"$canRead",
	"$canEdit",
	"$canDelete"
];
var PROVENANCE_MAGIC_COLUMNS = [
	"$createdBy",
	"$createdAt",
	"$updatedBy",
	"$updatedAt"
];
var PROVENANCE_MAGIC_TIMESTAMP_COLUMNS = ["$createdAt", "$updatedAt"];
function isPermissionIntrospectionColumn(column) {
	return PERMISSION_INTROSPECTION_COLUMNS.includes(column);
}
function isProvenanceMagicTimestampColumn(column) {
	return PROVENANCE_MAGIC_TIMESTAMP_COLUMNS.includes(column);
}
function isReservedMagicColumnName(column) {
	return column.startsWith("$");
}
function assertUserColumnNameAllowed(column) {
	if (isReservedMagicColumnName(column)) throw new Error(`Column name "${column}" is reserved for magic columns. Names starting with "\$" are reserved for system fields.`);
}
function magicColumnType(column) {
	if (isPermissionIntrospectionColumn(column)) return { type: "Boolean" };
	if (column === "$createdBy" || column === "$updatedBy") return { type: "Text" };
	if (column === "$createdAt" || column === "$updatedAt") return { type: "Timestamp" };
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/dsl.js
function normalizeEnumVariants(variants) {
	if (variants.length === 0) throw new Error("Enum columns require at least one variant.");
	for (const variant of variants) if (variant.length === 0) throw new Error("Enum variants cannot be empty strings.");
	const unique = new Set(variants);
	if (unique.size !== variants.length) throw new Error("Enum variants must be unique.");
	return [...unique].sort((a, b) => a.localeCompare(b));
}
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeJsonSchema(schema) {
	const maybeStandard = "~standard" in schema ? schema["~standard"] : void 0;
	if (maybeStandard) {
		const converted = maybeStandard.jsonSchema.output({ target: "draft-07" });
		if (!isJsonObject(converted)) throw new Error("JSON schema conversion failed: expected an object from ~standard.jsonSchema.output(...).");
		return converted;
	}
	if (!isJsonObject(schema)) throw new Error("JSON schema must be an object or implement ~standard.jsonSchema.");
	return schema;
}
function jsonColumn(schema) {
	return new JsonBuilder(schema);
}
function normalizeColumnMergeStrategy(strategy, sqlType, nullable) {
	if (strategy === "lww") return;
	if (sqlType !== "INTEGER" || nullable) throw new Error("Counter merge strategy is only supported on non-nullable INTEGER columns.");
	return "counter";
}
var ScalarBuilder = class {
	_sqlType;
	_nullable = false;
	_default = void 0;
	_mergeStrategy;
	_transform;
	constructor(_sqlType) {
		this._sqlType = _sqlType;
	}
	optional() {
		if (this._mergeStrategy === "counter") throw new Error("Counter merge strategy is only supported on non-nullable INTEGER columns.");
		this._nullable = true;
		return this;
	}
	default(value) {
		this._default = value;
		return this;
	}
	merge(strategy) {
		this._mergeStrategy = normalizeColumnMergeStrategy(strategy, this._sqlType, this._nullable);
		return this;
	}
	transform(transform) {
		this._transform = transform;
		return this;
	}
	_build(name) {
		return {
			name,
			sqlType: this._sqlType,
			nullable: this._nullable,
			...this._default === void 0 ? {} : { default: this._default },
			...this._mergeStrategy === void 0 ? {} : { mergeStrategy: this._mergeStrategy }
		};
	}
	get _references() {}
};
var EnumBuilder = class {
	_nullable = false;
	_default = void 0;
	_mergeStrategy;
	_sqlType;
	_transform;
	constructor(...variants) {
		this._sqlType = {
			kind: "ENUM",
			variants: normalizeEnumVariants(variants)
		};
	}
	optional() {
		if (this._mergeStrategy === "counter") throw new Error("Counter merge strategy is only supported on non-nullable INTEGER columns.");
		this._nullable = true;
		return this;
	}
	default(value) {
		this._default = value;
		return this;
	}
	merge(strategy) {
		this._mergeStrategy = normalizeColumnMergeStrategy(strategy, this._sqlType, this._nullable);
		return this;
	}
	transform(transform) {
		this._transform = transform;
		return this;
	}
	_build(name) {
		return {
			name,
			sqlType: this._sqlType,
			nullable: this._nullable,
			...this._default === void 0 ? {} : { default: this._default },
			...this._mergeStrategy === void 0 ? {} : { mergeStrategy: this._mergeStrategy }
		};
	}
	get _references() {}
};
var JsonBuilder = class {
	_nullable = false;
	_default = void 0;
	_mergeStrategy;
	_sqlType;
	_transform;
	constructor(schema) {
		this._sqlType = schema ? {
			kind: "JSON",
			schema: normalizeJsonSchema(schema)
		} : { kind: "JSON" };
	}
	optional() {
		if (this._mergeStrategy === "counter") throw new Error("Counter merge strategy is only supported on non-nullable INTEGER columns.");
		this._nullable = true;
		return this;
	}
	default(value) {
		this._default = value;
		return this;
	}
	merge(strategy) {
		this._mergeStrategy = normalizeColumnMergeStrategy(strategy, this._sqlType, this._nullable);
		return this;
	}
	transform(transform) {
		this._transform = transform;
		return this;
	}
	_build(name) {
		return {
			name,
			sqlType: this._sqlType,
			nullable: this._nullable,
			...this._default === void 0 ? {} : { default: this._default },
			...this._mergeStrategy === void 0 ? {} : { mergeStrategy: this._mergeStrategy }
		};
	}
	get _references() {}
};
var RefBuilder = class {
	_targetTable;
	_nullable = false;
	_default = void 0;
	_mergeStrategy;
	_transform;
	constructor(_targetTable) {
		this._targetTable = _targetTable;
	}
	optional() {
		if (this._mergeStrategy === "counter") throw new Error("Counter merge strategy is only supported on non-nullable INTEGER columns.");
		this._nullable = true;
		return this;
	}
	default(value) {
		this._default = value;
		return this;
	}
	merge(strategy) {
		this._mergeStrategy = normalizeColumnMergeStrategy(strategy, this._sqlType, this._nullable);
		return this;
	}
	transform(transform) {
		this._transform = transform;
		return this;
	}
	_build(name) {
		return {
			name,
			sqlType: this._sqlType,
			nullable: this._nullable,
			...this._default === void 0 ? {} : { default: this._default },
			...this._mergeStrategy === void 0 ? {} : { mergeStrategy: this._mergeStrategy },
			references: this._references
		};
	}
	get _sqlType() {
		return "UUID";
	}
	get _references() {
		return this._targetTable;
	}
};
var ArrayBuilder = class {
	_element;
	_nullable = false;
	_default = void 0;
	_mergeStrategy;
	_transform;
	constructor(_element) {
		this._element = _element;
	}
	optional() {
		if (this._mergeStrategy === "counter") throw new Error("Counter merge strategy is only supported on non-nullable INTEGER columns.");
		this._nullable = true;
		return this;
	}
	default(value) {
		this._default = value;
		return this;
	}
	merge(strategy) {
		this._mergeStrategy = normalizeColumnMergeStrategy(strategy, this._sqlType, this._nullable);
		return this;
	}
	transform(transform) {
		this._transform = transform;
		return this;
	}
	_build(name) {
		return {
			name,
			sqlType: this._sqlType,
			nullable: this._nullable,
			...this._default === void 0 ? {} : { default: this._default },
			...this._mergeStrategy === void 0 ? {} : { mergeStrategy: this._mergeStrategy },
			references: this._references
		};
	}
	get _sqlType() {
		return {
			kind: "ARRAY",
			element: this._element._sqlType
		};
	}
	get _references() {
		return this._element._references;
	}
};
function isTypedColumnBuilder(value) {
	return typeof value === "object" && value !== null && "_build" in value && "_sqlType" in value;
}
var AddBuilder = class {
	string(opts) {
		return {
			_type: "add",
			sqlType: "TEXT",
			default: opts.default
		};
	}
	int(opts) {
		return {
			_type: "add",
			sqlType: "INTEGER",
			default: opts.default
		};
	}
	timestamp(opts) {
		return {
			_type: "add",
			sqlType: "TIMESTAMP",
			default: opts.default
		};
	}
	boolean(opts) {
		return {
			_type: "add",
			sqlType: "BOOLEAN",
			default: opts.default
		};
	}
	float(opts) {
		return {
			_type: "add",
			sqlType: "REAL",
			default: opts.default
		};
	}
	bytes(opts) {
		return {
			_type: "add",
			sqlType: "BYTEA",
			default: opts.default
		};
	}
	ref(_targetTable, opts) {
		return {
			_type: "add",
			sqlType: "UUID",
			default: opts.default
		};
	}
	json(opts) {
		return {
			_type: "add",
			sqlType: opts.schema ? {
				kind: "JSON",
				schema: normalizeJsonSchema(opts.schema)
			} : { kind: "JSON" },
			default: opts.default
		};
	}
	enum(...args) {
		const opts = args[args.length - 1];
		return {
			_type: "add",
			sqlType: {
				kind: "ENUM",
				variants: normalizeEnumVariants(args.slice(0, -1))
			},
			default: opts.default
		};
	}
	array(opts) {
		return {
			_type: "add",
			sqlType: {
				kind: "ARRAY",
				element: isTypedColumnBuilder(opts.of) ? opts.of._sqlType : opts.of
			},
			default: opts.default
		};
	}
};
var DropBuilder = class {
	string(opts) {
		return {
			_type: "drop",
			sqlType: "TEXT",
			backwardsDefault: opts.backwardsDefault
		};
	}
	int(opts) {
		return {
			_type: "drop",
			sqlType: "INTEGER",
			backwardsDefault: opts.backwardsDefault
		};
	}
	timestamp(opts) {
		return {
			_type: "drop",
			sqlType: "TIMESTAMP",
			backwardsDefault: opts.backwardsDefault
		};
	}
	boolean(opts) {
		return {
			_type: "drop",
			sqlType: "BOOLEAN",
			backwardsDefault: opts.backwardsDefault
		};
	}
	float(opts) {
		return {
			_type: "drop",
			sqlType: "REAL",
			backwardsDefault: opts.backwardsDefault
		};
	}
	bytes(opts) {
		return {
			_type: "drop",
			sqlType: "BYTEA",
			backwardsDefault: opts.backwardsDefault
		};
	}
	ref(_targetTable, opts) {
		return {
			_type: "drop",
			sqlType: "UUID",
			backwardsDefault: opts.backwardsDefault
		};
	}
	json(opts) {
		return {
			_type: "drop",
			sqlType: opts.schema ? {
				kind: "JSON",
				schema: normalizeJsonSchema(opts.schema)
			} : { kind: "JSON" },
			backwardsDefault: opts.backwardsDefault
		};
	}
	enum(...args) {
		const opts = args[args.length - 1];
		return {
			_type: "drop",
			sqlType: {
				kind: "ENUM",
				variants: normalizeEnumVariants(args.slice(0, -1))
			},
			backwardsDefault: opts.backwardsDefault
		};
	}
	array(opts) {
		return {
			_type: "drop",
			sqlType: {
				kind: "ARRAY",
				element: isTypedColumnBuilder(opts.of) ? opts.of._sqlType : opts.of
			},
			backwardsDefault: opts.backwardsDefault
		};
	}
};
var col = {
	string: () => new ScalarBuilder("TEXT"),
	boolean: () => new ScalarBuilder("BOOLEAN"),
	int: () => new ScalarBuilder("INTEGER"),
	timestamp: () => new ScalarBuilder("TIMESTAMP"),
	float: () => new ScalarBuilder("REAL"),
	bytes: () => new ScalarBuilder("BYTEA"),
	json: jsonColumn,
	enum: (...variants) => new EnumBuilder(...variants),
	ref: (targetTable) => new RefBuilder(targetTable),
	array: (element) => new ArrayBuilder(element),
	/**
	* Add a new column to the table
	*/
	add: new AddBuilder(),
	/**
	* Drop a column from the table
	*/
	drop: new DropBuilder(),
	/**
	* Rename a column in the table
	* @deprecated Use {@link col.renameFrom} instead
	*/
	rename: (oldName) => ({
		_type: "rename",
		oldName
	}),
	/**
	* Rename a column in the table
	*/
	renameFrom: (oldName) => ({
		_type: "rename",
		oldName
	})
};
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/json-text.js
function toJsonText(value) {
	if (typeof value === "string") return value;
	let encoded;
	try {
		encoded = JSON.stringify(value);
	} catch (error) {
		throw new Error(`JSON values must be serializable: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (encoded === void 0) throw new Error("JSON values must be serializable");
	return encoded;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/value-converter.js
/**
* Convert JS values to WasmValue types for mutations.
*
* Used by Db insert/update paths to convert typed Init objects into
* the runtime value format expected by JazzClient.
*/
function toTimestampMs$1(value) {
	const numeric = value instanceof Date ? value.getTime() : Number(value);
	if (!Number.isFinite(numeric)) throw new Error("Invalid timestamp value. Expected Date or finite number.");
	return numeric;
}
function normalizeByteaValue(value) {
	if (value instanceof Uint8Array) return value;
	if (Array.isArray(value)) {
		const bytes = value.map((entry) => {
			const n = Number(entry);
			if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Bytea arrays must contain integers in range 0..255");
			return n;
		});
		return new Uint8Array(bytes);
	}
	throw new Error("Expected Uint8Array or byte array for Bytea column type");
}
/**
* Convert a JS value to WasmValue based on column type.
*/
function toValue(value, columnType) {
	if (value === null || value === void 0) return { type: "Null" };
	switch (columnType.type) {
		case "Text": return {
			type: "Text",
			value: String(value)
		};
		case "Boolean": return {
			type: "Boolean",
			value: Boolean(value)
		};
		case "Integer": return {
			type: "Integer",
			value: Number(value)
		};
		case "BigInt": return {
			type: "BigInt",
			value: Number(value)
		};
		case "Double": return {
			type: "Double",
			value: Number(value)
		};
		case "Timestamp": return {
			type: "Timestamp",
			value: toTimestampMs$1(value)
		};
		case "Uuid": return {
			type: "Uuid",
			value: String(value)
		};
		case "Bytea": return {
			type: "Bytea",
			value: normalizeByteaValue(value)
		};
		case "Json": return {
			type: "Text",
			value: toJsonText(value)
		};
		case "Enum": {
			const enumValue = String(value);
			if (!columnType.variants.includes(enumValue)) throw new Error(`Invalid enum value "${enumValue}". Expected one of: ${columnType.variants.join(", ")}`);
			return {
				type: "Text",
				value: enumValue
			};
		}
		case "Array": {
			if (!Array.isArray(value)) throw new Error(`Expected array for Array column type, got ${typeof value}`);
			const elementType = columnType.element;
			return {
				type: "Array",
				value: value.map((v) => toValue(v, elementType))
			};
		}
		case "Row": {
			if (typeof value !== "object" || value === null) throw new Error(`Expected object for Row column type, got ${typeof value}`);
			const rowValue = value;
			return {
				type: "Row",
				value: { values: columnType.columns.map((col) => toValue(rowValue[col.name], col.column_type)) }
			};
		}
		default: throw new Error(`Unsupported column type: ${columnType.type}`);
	}
}
/**
* Convert an insert object to a named WasmValue record.
*
* Only includes fields that are present in the data object.
* Undefined values are skipped so Rust can apply schema defaults.
*
* @param data The Init object with field values
* @param schema WasmSchema containing table definitions
* @param tableName Name of the table to insert into
* @returns Record mapping column names to WasmValues
*/
function toInsertRecord(data, schema, tableName) {
	const table = schema[tableName];
	if (!table) throw new Error(`Unknown table "${tableName}"`);
	const result = {};
	for (const [key, value] of Object.entries(data)) {
		if (value === void 0) continue;
		const col = table.columns.find((c) => c.name === key);
		if (!col) throw new Error(`Unknown column "${key}" on table "${tableName}"`);
		if (value === null && !col.nullable) throw new Error(`Cannot set required field '${key}' to null`);
		result[key] = toValue(value, col.column_type);
	}
	return result;
}
/**
* Convert partial update object to Record<string, WasmValue>.
*
* Only includes fields that are present in the data object.
* Undefined values are skipped.
*
* @param data Partial object with fields to update
* @param schema WasmSchema containing table definitions
* @param tableName Name of the table being updated
* @returns Record mapping column names to WasmValues
*/
function toUpdateRecord(data, schema, tableName) {
	const table = schema[tableName];
	if (!table) throw new Error(`Unknown table "${tableName}"`);
	const result = {};
	for (const [key, value] of Object.entries(data)) {
		if (value === void 0) continue;
		const col = table.columns.find((c) => c.name === key);
		if (!col) throw new Error(`Unknown column "${key}" on table "${tableName}"`);
		if (value === null && !col.nullable) throw new Error(`Cannot set required field '${key}' to null`);
		result[key] = toValue(value, col.column_type);
	}
	return result;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/codegen/schema-reader.js
/**
* Convert TS DSL Schema to WasmSchema JSON format.
*/
var map = {
	TEXT: { type: "Text" },
	BOOLEAN: { type: "Boolean" },
	INTEGER: { type: "Integer" },
	REAL: { type: "Double" },
	TIMESTAMP: { type: "Timestamp" },
	UUID: { type: "Uuid" },
	BYTEA: { type: "Bytea" }
};
/**
* Convert a DSL SqlType to WasmColumnType format.
*/
function sqlTypeToWasm(sqlType) {
	if (typeof sqlType !== "string") {
		if (sqlType.kind === "ENUM") return {
			type: "Enum",
			variants: [...sqlType.variants]
		};
		if (sqlType.kind === "JSON") return {
			type: "Json",
			schema: sqlType.schema
		};
		return {
			type: "Array",
			element: sqlTypeToWasm(sqlType.element)
		};
	}
	return map[sqlType];
}
function literalToWasmValue(value) {
	if (value instanceof Uint8Array) return {
		type: "Bytea",
		value
	};
	if (value === null) return { type: "Null" };
	if (typeof value === "string") return {
		type: "Text",
		value
	};
	if (typeof value === "boolean") return {
		type: "Boolean",
		value
	};
	if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error("Policy literal numbers must be finite integers");
		if (value >= -2147483648 && value <= 2147483647) return {
			type: "Integer",
			value
		};
		return {
			type: "BigInt",
			value
		};
	}
	if (Array.isArray(value)) return {
		type: "Array",
		value: value.map((inner) => literalToWasmValue(inner))
	};
	throw new Error(`Unsupported policy literal type: ${typeof value}`);
}
function columnMergeStrategyToWasm(strategy) {
	switch (strategy) {
		case void 0: return;
		case "counter": return "Counter";
	}
}
function clonePolicyValue(value) {
	if (value.type === "SessionRef") return {
		type: "SessionRef",
		path: [...value.path]
	};
	return {
		type: "Literal",
		value: literalToWasmValue(value.value)
	};
}
function clonePolicyLiteralValue(value) {
	return literalToWasmValue(value.value);
}
function clonePolicyExpr(expr) {
	switch (expr.type) {
		case "Cmp": return {
			type: "Cmp",
			column: expr.column,
			op: expr.op,
			value: clonePolicyValue(expr.value)
		};
		case "SessionCmp": return {
			type: "SessionCmp",
			path: [...expr.path],
			op: expr.op,
			value: clonePolicyLiteralValue(expr.value)
		};
		case "IsNull": return {
			type: "IsNull",
			column: expr.column
		};
		case "SessionIsNull": return {
			type: "SessionIsNull",
			path: [...expr.path]
		};
		case "IsNotNull": return {
			type: "IsNotNull",
			column: expr.column
		};
		case "SessionIsNotNull": return {
			type: "SessionIsNotNull",
			path: [...expr.path]
		};
		case "Contains": return {
			type: "Contains",
			column: expr.column,
			value: clonePolicyValue(expr.value)
		};
		case "SessionContains": return {
			type: "SessionContains",
			path: [...expr.path],
			value: clonePolicyLiteralValue(expr.value)
		};
		case "In": return {
			type: "In",
			column: expr.column,
			session_path: [...expr.session_path]
		};
		case "InList": return {
			type: "InList",
			column: expr.column,
			values: expr.values.map(clonePolicyValue)
		};
		case "SessionInList": return {
			type: "SessionInList",
			path: [...expr.path],
			values: expr.values.map(clonePolicyLiteralValue)
		};
		case "Exists": return {
			type: "Exists",
			table: expr.table,
			condition: clonePolicyExpr(expr.condition)
		};
		case "ExistsRel": throw new Error("Policy ExistsRel is not supported in schemaToWasm(). Use definePermissions() relation IR path instead.");
		case "Inherits": return {
			type: "Inherits",
			operation: expr.operation,
			via_column: expr.via_column,
			...expr.max_depth === void 0 ? {} : { max_depth: expr.max_depth }
		};
		case "InheritsReferencing": return {
			type: "InheritsReferencing",
			operation: expr.operation,
			source_table: expr.source_table,
			via_column: expr.via_column,
			...expr.max_depth === void 0 ? {} : { max_depth: expr.max_depth }
		};
		case "And": return {
			type: "And",
			exprs: expr.exprs.map(clonePolicyExpr)
		};
		case "Or": return {
			type: "Or",
			exprs: expr.exprs.map(clonePolicyExpr)
		};
		case "Not": return {
			type: "Not",
			expr: clonePolicyExpr(expr.expr)
		};
		case "True": return { type: "True" };
		case "False": return { type: "False" };
	}
}
function cloneOperationPolicy(policy) {
	const out = {};
	if (!policy) return out;
	if (policy.using) out.using = clonePolicyExpr(policy.using);
	if (policy.with_check) out.with_check = clonePolicyExpr(policy.with_check);
	return out;
}
function clonePolicies(policies) {
	return {
		select: cloneOperationPolicy(policies.select),
		insert: cloneOperationPolicy(policies.insert),
		update: cloneOperationPolicy(policies.update),
		delete: cloneOperationPolicy(policies.delete)
	};
}
/**
* Convert a TS DSL Schema to WasmSchema format.
*
* This produces a JSON-serializable structure that can be passed to the WASM runtime.
*/
function schemaToWasm(schema) {
	const tables = {};
	for (const table of schema.tables) {
		const columns = table.columns.map((col) => {
			const columnType = sqlTypeToWasm(col.sqlType);
			if (col.mergeStrategy === "counter" && (col.sqlType !== "INTEGER" || col.nullable)) throw new Error("Counter merge strategy is only supported on non-nullable INTEGER columns.");
			const descriptor = {
				name: col.name,
				column_type: columnType,
				nullable: col.nullable
			};
			if (col.default !== void 0) descriptor.default = toValue(col.default, columnType);
			if (col.references) descriptor.references = col.references;
			if (col.mergeStrategy) descriptor.merge_strategy = columnMergeStrategyToWasm(col.mergeStrategy);
			return descriptor;
		});
		tables[table.name] = {
			columns,
			policies: table.policies ? clonePolicies(table.policies) : void 0
		};
	}
	return tables;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/typed-app.js
var DefinedTable = class DefinedTable {
	columns;
	indexes;
	__jazzTableDefinition = true;
	constructor(columns, indexes = []) {
		this.columns = columns;
		this.indexes = indexes;
	}
	index(name, columns) {
		const normalizedName = name.trim();
		if (!normalizedName) throw new Error("table.index(...) requires a non-empty index name.");
		const normalizedColumns = [...columns];
		for (const column of normalizedColumns) if (!(column in this.columns)) throw new Error(`table.index(...) references unknown column "${column}".`);
		return new DefinedTable(this.columns, [...this.indexes, {
			name: normalizedName,
			columns: normalizedColumns
		}]);
	}
};
/**
* Define a table with the given columns.
*
* @example
* ```typescript
* const schema = {
*   todos: s.table({
*     title: s.string(),
*     done: s.boolean(),
*   }),
* });
* type AppSchema = s.Schema<typeof schema>;
* export const app: s.App<AppSchema> = s.defineApp(schema);
* ```
*/
function defineTable(columns) {
	return new DefinedTable(columns);
}
function cloneBuiltCondition(condition) {
	return { ...condition };
}
function cloneBuiltRelation(relation) {
	return {
		...relation.table ? { table: relation.table } : {},
		...relation.conditions ? { conditions: relation.conditions.map(cloneBuiltCondition) } : {},
		...relation.hops ? { hops: [...relation.hops] } : {},
		...relation.gather ? { gather: cloneBuiltGather(relation.gather) } : {},
		...relation.union ? { union: { inputs: relation.union.inputs.map(cloneBuiltRelation) } } : {}
	};
}
function cloneBuiltGather(gather) {
	return {
		...gather.seed ? { seed: cloneBuiltRelation(gather.seed) } : {},
		max_depth: gather.max_depth,
		step_table: gather.step_table,
		step_current_column: gather.step_current_column,
		step_conditions: gather.step_conditions.map(cloneBuiltCondition),
		step_hops: [...gather.step_hops]
	};
}
var TypedTableQueryBuilder = class TypedTableQueryBuilder {
	_table;
	_schema;
	_conditions = [];
	_includes = {};
	_requireIncludes = false;
	_selectColumns;
	_orderBys = [];
	_limitVal;
	_offsetVal;
	_hops = [];
	_gatherVal;
	_unionVal;
	_columnTransforms;
	constructor(table, schema, columnTransforms) {
		this._table = table;
		this._schema = schema;
		this._columnTransforms = columnTransforms;
	}
	where(conditions) {
		if (this._unionVal) throw new Error("union(...) currently only supports gather(...) in MVP.");
		const clone = this._clone();
		clone._conditions.push(...this._whereConditions(conditions));
		return clone;
	}
	select(...columns) {
		const clone = this._clone();
		clone._selectColumns = [...columns];
		return clone;
	}
	include(relations) {
		const clone = this._clone();
		clone._includes = {
			...this._includes,
			...relations
		};
		return clone;
	}
	requireIncludes() {
		const clone = this._clone();
		clone._requireIncludes = true;
		return clone;
	}
	orderBy(column, direction = "asc") {
		const clone = this._clone();
		clone._orderBys.push([column, direction]);
		return clone;
	}
	limit(n) {
		const clone = this._clone();
		clone._limitVal = n;
		return clone;
	}
	offset(n) {
		const clone = this._clone();
		clone._offsetVal = n;
		return clone;
	}
	hopTo(relation) {
		if (this._unionVal) throw new Error("union(...) currently only supports gather(...) in MVP.");
		const clone = this._clone();
		clone._hops.push(relation);
		return clone;
	}
	gather(options) {
		if (typeof options.step !== "function") throw new Error("gather(...) requires step callback.");
		const maxDepth = options.maxDepth ?? 10;
		if (!Number.isInteger(maxDepth) || maxDepth <= 0) throw new Error("gather(...) maxDepth must be a positive integer.");
		if (Object.keys(this._includes).length > 0) throw new Error("gather(...) does not support include(...) in MVP.");
		if (options.start && this._unionVal) throw new Error("gather(...) start does not support union(...) seeds in MVP.");
		const currentToken = "__jazz_gather_current__";
		const stepOutput = options.step({ current: currentToken });
		if (!stepOutput || typeof stepOutput !== "object" || typeof stepOutput._build !== "function") throw new Error("gather(...) step must return a query expression built from app.<table>.");
		const stepBuilt = JSON.parse(stepOutput._build());
		if (typeof stepBuilt.table !== "string" || !stepBuilt.table) throw new Error("gather(...) step query is missing table metadata.");
		if (!Array.isArray(stepBuilt.conditions)) throw new Error("gather(...) step query is missing condition metadata.");
		const stepHops = Array.isArray(stepBuilt.hops) ? stepBuilt.hops.filter((hop) => typeof hop === "string") : [];
		if (stepHops.length !== 1) throw new Error("gather(...) step must include exactly one hopTo(...).");
		const currentConditions = stepBuilt.conditions.filter((condition) => condition.op === "eq" && condition.value === currentToken);
		if (currentConditions.length !== 1) throw new Error("gather(...) step must include exactly one where condition bound to current.");
		const currentCondition = currentConditions[0];
		const stepConditions = stepBuilt.conditions.filter((condition) => !(condition.op === "eq" && condition.value === currentToken));
		const needsExplicitSeed = this._unionVal !== void 0 || this._hops.length > 0 || this._gatherVal !== void 0;
		const seedSource = options.start === void 0 ? this : this.where(options.start);
		const clone = needsExplicitSeed ? this._clone() : seedSource._clone();
		clone._conditions = [];
		clone._hops = [];
		clone._gatherVal = {
			...needsExplicitSeed ? { seed: seedSource._serializeRelation() } : {},
			max_depth: maxDepth,
			step_table: stepBuilt.table,
			step_current_column: currentCondition.column,
			step_conditions: stepConditions,
			step_hops: stepHops
		};
		clone._unionVal = void 0;
		return clone;
	}
	_build() {
		return JSON.stringify({
			table: this._table,
			conditions: this._conditions,
			includes: this._includes,
			__jazz_requireIncludes: this._requireIncludes || void 0,
			select: this._selectColumns,
			orderBy: this._orderBys,
			limit: this._limitVal,
			offset: this._offsetVal,
			hops: this._hops,
			gather: this._gatherVal,
			...this._unionVal ? { union: cloneBuiltRelation(this._unionVal).union } : {}
		});
	}
	toJSON() {
		return JSON.parse(this._build());
	}
	_clone() {
		const clone = new TypedTableQueryBuilder(this._table, this._schema, this._columnTransforms);
		clone._conditions = [...this._conditions];
		clone._includes = { ...this._includes };
		clone._requireIncludes = this._requireIncludes;
		clone._selectColumns = this._selectColumns ? [...this._selectColumns] : void 0;
		clone._orderBys = [...this._orderBys];
		clone._limitVal = this._limitVal;
		clone._offsetVal = this._offsetVal;
		clone._hops = [...this._hops];
		clone._gatherVal = this._gatherVal ? cloneBuiltGather(this._gatherVal) : void 0;
		clone._unionVal = this._unionVal ? cloneBuiltRelation(this._unionVal) : void 0;
		return clone;
	}
	_whereConditions(conditions) {
		const built = [];
		for (const [key, value] of Object.entries(conditions)) {
			if (value === void 0) continue;
			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				for (const [op, opValue] of Object.entries(value)) if (opValue !== void 0) built.push({
					column: key,
					op,
					value: opValue
				});
			} else built.push({
				column: key,
				op: "eq",
				value
			});
		}
		return built;
	}
	_serializeRelation() {
		if (this._unionVal) return cloneBuiltRelation(this._unionVal);
		return {
			table: this._table,
			conditions: this._conditions.map(cloneBuiltCondition),
			hops: [...this._hops],
			...this._gatherVal ? { gather: cloneBuiltGather(this._gatherVal) } : {}
		};
	}
};
function unwrapTableDefinition(definition) {
	if (definition instanceof DefinedTable) return definition.columns;
	if (typeof definition === "object" && definition !== null) {
		const maybeDefinedTable = definition;
		if (maybeDefinedTable.__jazzTableDefinition === true && maybeDefinedTable.columns) return maybeDefinedTable.columns;
	}
	return definition;
}
function definitionToColumns(definition) {
	const columnsDefinition = unwrapTableDefinition(definition);
	const columns = [];
	for (const [columnName, builder] of Object.entries(columnsDefinition)) {
		assertUserColumnNameAllowed(columnName);
		columns.push(builder._build(columnName));
	}
	return columns;
}
function columnTransformsForTable(definition) {
	if (!definition) return;
	const columnsDefinition = unwrapTableDefinition(definition);
	const transforms = {};
	for (const [columnName, builder] of Object.entries(columnsDefinition)) if (builder._transform) transforms[columnName] = builder._transform;
	return Object.keys(transforms).length > 0 ? transforms : void 0;
}
function definitionToSchema(definition) {
	return { tables: Object.entries(definition).map(([tableName, tableDefinition]) => ({
		name: tableName,
		columns: definitionToColumns(tableDefinition)
	})) };
}
function defineSchema(definition) {
	return definition;
}
function defineApp(definition) {
	const normalizedDefinition = definition;
	const wasmSchema = schemaToWasm(definitionToSchema(normalizedDefinition));
	return createAppForTables(Object.keys(normalizedDefinition), wasmSchema, normalizedDefinition);
}
function defineSliceableApp(definition) {
	const normalizedDefinition = definition;
	const wasmSchema = schemaToWasm(definitionToSchema(normalizedDefinition));
	return {
		wasmSchema,
		slice(...tableNames) {
			if (tableNames.length === 0) throw new Error("slice(...) requires at least one table name.");
			for (const tableName of tableNames) if (!(tableName in normalizedDefinition)) throw new Error(`slice(...) references unknown table "${tableName}".`);
			return createAppForTables(tableNames, wasmSchema, normalizedDefinition);
		}
	};
}
function createAppForTables(tableNames, wasmSchema, definition) {
	const tables = {};
	for (const tableName of tableNames) tables[tableName] = new TypedTableQueryBuilder(tableName, wasmSchema, definition ? columnTransformsForTable(definition[tableName]) : void 0);
	return {
		...tables,
		union(relations) {
			if (relations.length === 0) throw new Error("union(...) requires at least one relation.");
			const first = relations[0];
			const builder = new TypedTableQueryBuilder(first._table, wasmSchema);
			builder._unionVal = { union: { inputs: relations.map((relation) => relation._serializeRelation()) } };
			return builder;
		},
		wasmSchema
	};
}
var permissionIntrospectionColumns = [...PERMISSION_INTROSPECTION_COLUMNS];
[...PROVENANCE_MAGIC_COLUMNS];
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/migrations.js
function normalizeSchemaDefinition(definition) {
	return Object.fromEntries(Object.entries(definition).map(([tableName, tableDefinition]) => [tableName, unwrapTableDefinition(tableDefinition)]));
}
function renameTableFrom(oldName) {
	return {
		_type: "renameTable",
		oldName
	};
}
function buildRenameTableMap(renameTables, fromDefinition, toDefinition) {
	const map = /* @__PURE__ */ new Map();
	const usedSources = /* @__PURE__ */ new Set();
	if (!renameTables) return map;
	for (const [tableName, operation] of Object.entries(renameTables)) {
		if (!(tableName in toDefinition)) throw new Error(`Table rename references unknown target table ${tableName}.`);
		if (tableName in fromDefinition) throw new Error(`Table rename target ${tableName} already exists in the source schema; renameTables only supports target-only tables.`);
		if (!(operation.oldName in fromDefinition)) throw new Error(`Table rename references unknown source table ${operation.oldName}.`);
		if (operation.oldName in toDefinition) throw new Error(`Table rename source ${operation.oldName} still exists in the target schema; renameTables only supports source-only tables.`);
		if (usedSources.has(operation.oldName)) throw new Error(`Table rename source ${operation.oldName} is used more than once.`);
		usedSources.add(operation.oldName);
		map.set(tableName, operation.oldName);
	}
	return map;
}
function buildAddedTableSet(createTables, fromDefinition, toDefinition, renameTableMap) {
	const set = /* @__PURE__ */ new Set();
	if (!createTables) return set;
	for (const [tableName, marker] of Object.entries(createTables)) {
		if (marker !== true) throw new Error(`createTables.${tableName} must be true.`);
		if (!(tableName in toDefinition)) throw new Error(`createTables references unknown target table ${tableName}.`);
		if (tableName in fromDefinition) throw new Error(`createTables only supports target-only tables; ${tableName} already exists in the source schema.`);
		if (renameTableMap.has(tableName)) throw new Error(`Table ${tableName} cannot be both added and renamed.`);
		set.add(tableName);
	}
	return set;
}
function buildRemovedTableSet(dropTables, fromDefinition, toDefinition, renamedSources) {
	const set = /* @__PURE__ */ new Set();
	if (!dropTables) return set;
	for (const [tableName, marker] of Object.entries(dropTables)) {
		if (marker !== true) throw new Error(`dropTables.${tableName} must be true.`);
		if (!(tableName in fromDefinition)) throw new Error(`dropTables references unknown source table ${tableName}.`);
		if (tableName in toDefinition) throw new Error(`dropTables only supports source-only tables; ${tableName} still exists in the target schema.`);
		if (renamedSources.has(tableName)) throw new Error(`Table ${tableName} cannot be both removed and renamed.`);
		set.add(tableName);
	}
	return set;
}
function columnShapeSignature(builder) {
	const column = builder._build("__migration_shape__");
	return JSON.stringify({
		sqlType: column.sqlType,
		nullable: column.nullable,
		references: column.references ?? null
	});
}
function tableMatchesAfterApplyingColumnOperations(sourceTable, targetTable, tableOps) {
	const transformed = new Map(Object.entries(sourceTable));
	for (const [columnName, operation] of Object.entries(tableOps)) switch (operation._type) {
		case "rename": {
			const builder = transformed.get(operation.oldName);
			if (!builder) return false;
			if (columnName !== operation.oldName && transformed.has(columnName)) return false;
			transformed.delete(operation.oldName);
			transformed.set(columnName, builder);
			break;
		}
		case "add": {
			const builder = targetTable[columnName];
			if (!builder || transformed.has(columnName)) return false;
			transformed.set(columnName, builder);
			break;
		}
		case "drop":
			if (!transformed.delete(columnName)) return false;
			break;
	}
	const targetEntries = Object.entries(targetTable);
	if (transformed.size !== targetEntries.length) return false;
	for (const [columnName, targetBuilder] of targetEntries) {
		const sourceBuilder = transformed.get(columnName);
		if (!sourceBuilder) return false;
		if (columnShapeSignature(sourceBuilder) !== columnShapeSignature(targetBuilder)) return false;
	}
	return true;
}
function buildForwardLenses(migrate, renameTables, createTables, dropTables, fromDefinition, toDefinition) {
	const renameTableMap = buildRenameTableMap(renameTables, fromDefinition, toDefinition);
	const renamedSources = new Set(renameTableMap.values());
	const addedTableSet = buildAddedTableSet(createTables, fromDefinition, toDefinition, renameTableMap);
	const removedTableSet = buildRemovedTableSet(dropTables, fromDefinition, toDefinition, renamedSources);
	if (!migrate && renameTableMap.size === 0 && addedTableSet.size === 0 && removedTableSet.size === 0) return [];
	const forward = [];
	const orderedTableNames = [...new Set([
		...Object.keys(createTables ?? {}),
		...Object.keys(dropTables ?? {}),
		...Object.keys(renameTables ?? {}),
		...Object.keys(migrate ?? {})
	])];
	const sourceTables = fromDefinition;
	const targetTables = toDefinition;
	for (const tableName of orderedTableNames) {
		const added = addedTableSet.has(tableName) ? true : void 0;
		const removed = removedTableSet.has(tableName) ? true : void 0;
		const renamedFrom = renameTableMap.get(tableName);
		const rawTableOps = migrate?.[tableName];
		const tableOps = rawTableOps && typeof rawTableOps === "object" ? rawTableOps : {};
		const operationEntries = Object.entries(tableOps);
		if (added && removed) throw new Error(`Table ${tableName} cannot be both added and removed.`);
		if ((added || removed) && renamedFrom) throw new Error(`Table ${tableName} cannot be combined with both table markers and renameTables.`);
		if ((added || removed) && operationEntries.length > 0) throw new Error(`Table ${tableName} cannot have column operations when declared in createTables or dropTables.`);
		const operations = [];
		const renamedSources = /* @__PURE__ */ new Set();
		const droppedColumns = /* @__PURE__ */ new Set();
		const sourceTableName = renamedFrom ?? tableName;
		for (const [columnName, operation] of operationEntries) switch (operation._type) {
			case "rename":
				assertUserColumnNameAllowed(columnName);
				if (renamedSources.has(operation.oldName)) throw new Error(`Migration for ${tableName} renames ${operation.oldName} more than once.`);
				if (droppedColumns.has(operation.oldName)) throw new Error(`Migration for ${tableName} cannot both drop and rename ${operation.oldName}.`);
				renamedSources.add(operation.oldName);
				operations.push({
					type: "rename",
					column: operation.oldName,
					value: columnName
				});
				break;
			case "add": {
				assertUserColumnNameAllowed(columnName);
				const builder = targetTables[tableName]?.[columnName];
				if (!builder) throw new Error(`Migration references unknown target column ${tableName}.${columnName}.`);
				operations.push({
					type: "introduce",
					column: columnName,
					sqlType: builder._sqlType,
					value: operation.default
				});
				break;
			}
			case "drop": {
				if (renamedSources.has(columnName)) throw new Error(`Migration for ${tableName} cannot both drop and rename ${columnName}.`);
				droppedColumns.add(columnName);
				const builder = sourceTables[sourceTableName]?.[columnName];
				if (!builder) throw new Error(`Migration references unknown source column ${sourceTableName}.${columnName}.`);
				operations.push({
					type: "drop",
					column: columnName,
					sqlType: builder._sqlType,
					value: operation.backwardsDefault
				});
				break;
			}
		}
		if (renamedFrom) {
			const sourceTable = sourceTables[sourceTableName];
			const targetTable = targetTables[tableName];
			if (!sourceTable || !targetTable) throw new Error(`Table rename ${sourceTableName} -> ${tableName} references a missing source or target table.`);
			if (!tableMatchesAfterApplyingColumnOperations(sourceTable, targetTable, tableOps)) throw new Error(`Table rename ${sourceTableName} -> ${tableName} does not match the target table after applying its column migrations.`);
		}
		if (added || removed || renamedFrom || operations.length > 0) forward.push({
			table: tableName,
			added,
			removed,
			renamedFrom,
			operations
		});
	}
	return forward;
}
/**
* Create a new migration lens: a bidirectional transformation between two schema versions.
* The forward direction applies the migration; the backward direction is generated automatically
* so older clients can still read data written under the new schema.
*
* Migration stubs can be generated with the `jazz-tools@alpha migrations create` command
* and published with the `jazz-tools@alpha migrations push` command.
*
* @example
* ```typescript
* export default s.defineMigration({
*   migrate: {
*     todos: {
*       priority: s.add.enum("low", "medium", "high", { default: "medium" }),
*     },
*   },
*   fromHash: "aaaaaaaaaaaa",
*   toHash: "bbbbbbbbbbbb",
*   from: {
*     todos: s.table({
*       title: s.string(),
*       done: s.boolean(),
*     }),
*   },
*   to: {
*     todos: s.table({
*       title: s.string(),
*       done: s.boolean(),
*       priority: s.enum("low", "medium", "high"),
*     }),
*   },
* });
* ```
*/
function defineMigration(config) {
	const fromDefinition = normalizeSchemaDefinition(config.from);
	const toDefinition = normalizeSchemaDefinition(config.to);
	return {
		fromHash: config.fromHash,
		toHash: config.toHash,
		from: config.from,
		to: config.to,
		forward: buildForwardLenses(config.migrate, config.renameTables, config.createTables, config.dropTables, fromDefinition, toDefinition)
	};
}
//#endregion
//#region ../../node_modules/.bun/pluralize-esm@9.0.5/node_modules/pluralize-esm/dist/index.js
var pluralRules = [];
var singularRules = [];
var uncountables = /* @__PURE__ */ new Set();
var irregularPlurals = /* @__PURE__ */ new Map();
var irregularSingles = /* @__PURE__ */ new Map();
var sanitizeRule = (rule) => typeof rule === "string" ? new RegExp("^".concat(rule, "$"), "i") : rule;
var restoreCase = (word, token) => {
	if (typeof token !== "string") return word;
	if (word === token) return token;
	if (word === word.toLowerCase()) return token.toLowerCase();
	if (word === word.toUpperCase()) return token.toUpperCase();
	if (word[0] === word[0].toUpperCase()) return token.charAt(0).toUpperCase() + token.substr(1).toLowerCase();
	return token.toLowerCase();
};
var sanitizeWord = (token, word, rules) => {
	if (!token.length || uncountables.has(token)) return word;
	let { length: len } = rules;
	while (len--) {
		const rule = rules[len];
		if (rule[0].test(word)) return word.replace(rule[0], function() {
			for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) args[_key] = arguments[_key];
			const [match, index] = args;
			const result = rule[1].replace(/\$(\d{1,2})/g, (_, index2) => args[index2] || "");
			if (match === "") return restoreCase(word[index - 1], result);
			return restoreCase(match, result);
		});
	}
	return word;
};
var compute = (word, replaceMap, keepMap, rules) => {
	const token = word.toLowerCase();
	if (keepMap.has(token)) return restoreCase(word, token);
	if (replaceMap.has(token)) return restoreCase(word, replaceMap.get(token));
	return sanitizeWord(token, word, rules);
};
var mapHas = (word, replaceMap, keepMap, rules) => {
	const token = word.toLowerCase();
	if (keepMap.has(token)) return true;
	if (replaceMap.has(token)) return false;
	return sanitizeWord(token, token, rules) === token;
};
var pluralize = (word, count, inclusive) => {
	const pluralized = count === 1 ? pluralize.singular(word) : pluralize.plural(word);
	if (inclusive) return "".concat(count, " ").concat(pluralized);
	return pluralized;
};
pluralize.plural = (word) => compute(word, irregularSingles, irregularPlurals, pluralRules);
pluralize.singular = (word) => compute(word, irregularPlurals, irregularSingles, singularRules);
pluralize.addPluralRule = (rule, replacement) => {
	pluralRules.push([sanitizeRule(rule), replacement]);
};
pluralize.addSingularRule = (rule, replacement) => {
	singularRules.push([sanitizeRule(rule), replacement]);
};
pluralize.addIrregularRule = (single, plural) => {
	const _plural = plural.toLowerCase();
	const _single = single.toLowerCase();
	irregularSingles.set(_single, _plural);
	irregularPlurals.set(_plural, _single);
};
pluralize.addUncountableRule = (rule) => {
	if (typeof rule === "string") {
		uncountables.add(rule.toLowerCase());
		return;
	}
	pluralize.addPluralRule(rule, "$0");
	pluralize.addSingularRule(rule, "$0");
};
pluralize.isPlural = (word) => mapHas(word, irregularSingles, irregularPlurals, pluralRules);
pluralize.isSingular = (word) => mapHas(word, irregularPlurals, irregularSingles, singularRules);
var defaultIrregulars = [
	["I", "we"],
	["me", "us"],
	["he", "they"],
	["she", "they"],
	["them", "them"],
	["myself", "ourselves"],
	["yourself", "yourselves"],
	["itself", "themselves"],
	["herself", "themselves"],
	["himself", "themselves"],
	["themself", "themselves"],
	["is", "are"],
	["was", "were"],
	["has", "have"],
	["this", "these"],
	["that", "those"],
	["my", "our"],
	["its", "their"],
	["his", "their"],
	["her", "their"],
	["echo", "echoes"],
	["dingo", "dingoes"],
	["volcano", "volcanoes"],
	["tornado", "tornadoes"],
	["torpedo", "torpedoes"],
	["genus", "genera"],
	["viscus", "viscera"],
	["stigma", "stigmata"],
	["stoma", "stomata"],
	["dogma", "dogmata"],
	["lemma", "lemmata"],
	["schema", "schemata"],
	["anathema", "anathemata"],
	["ox", "oxen"],
	["axe", "axes"],
	["die", "dice"],
	["yes", "yeses"],
	["foot", "feet"],
	["eave", "eaves"],
	["goose", "geese"],
	["tooth", "teeth"],
	["quiz", "quizzes"],
	["human", "humans"],
	["proof", "proofs"],
	["carve", "carves"],
	["valve", "valves"],
	["looey", "looies"],
	["thief", "thieves"],
	["groove", "grooves"],
	["pickaxe", "pickaxes"],
	["passerby", "passersby"],
	["canvas", "canvases"]
];
var defaultPlurals = [
	[/s?$/i, "s"],
	[/[^\u0000-\u007F]$/i, "$0"],
	[/([^aeiou]ese)$/i, "$1"],
	[/(ax|test)is$/i, "$1es"],
	[/(alias|[^aou]us|t[lm]as|gas|ris)$/i, "$1es"],
	[/(e[mn]u)s?$/i, "$1s"],
	[/([^l]ias|[aeiou]las|[ejzr]as|[iu]am)$/i, "$1"],
	[/(alumn|syllab|vir|radi|nucle|fung|cact|stimul|termin|bacill|foc|uter|loc|strat)(?:us|i)$/i, "$1i"],
	[/(alumn|alg|vertebr)(?:a|ae)$/i, "$1ae"],
	[/(seraph|cherub)(?:im)?$/i, "$1im"],
	[/(her|at|gr)o$/i, "$1oes"],
	[/(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|automat|quor)(?:a|um)$/i, "$1a"],
	[/(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat)(?:a|on)$/i, "$1a"],
	[/sis$/i, "ses"],
	[/(?:(kni|wi|li)fe|(ar|l|ea|eo|oa|hoo)f)$/i, "$1$2ves"],
	[/([^aeiouy]|qu)y$/i, "$1ies"],
	[/([^ch][ieo][ln])ey$/i, "$1ies"],
	[/(x|ch|ss|sh|zz)$/i, "$1es"],
	[/(matr|cod|mur|sil|vert|ind|append)(?:ix|ex)$/i, "$1ices"],
	[/\b((?:tit)?m|l)(?:ice|ouse)$/i, "$1ice"],
	[/(pe)(?:rson|ople)$/i, "$1ople"],
	[/(child)(?:ren)?$/i, "$1ren"],
	[/eaux$/i, "$0"],
	[/m[ae]n$/i, "men"],
	["thou", "you"]
];
var defaultSingles = [
	[/s$/i, ""],
	[/(ss)$/i, "$1"],
	[/(wi|kni|(?:after|half|high|low|mid|non|night|[^\w]|^)li)ves$/i, "$1fe"],
	[/(ar|(?:wo|[ae])l|[eo][ao])ves$/i, "$1f"],
	[/ies$/i, "y"],
	[/(dg|ss|ois|lk|ok|wn|mb|th|ch|ec|oal|is|ck|ix|sser|ts|wb)ies$/i, "$1ie"],
	[/\b(l|(?:neck|cross|hog|aun)?t|coll|faer|food|gen|goon|group|hipp|junk|vegg|(?:pork)?p|charl|calor|cut)ies$/i, "$1ie"],
	[/\b(mon|smil)ies$/i, "$1ey"],
	[/\b((?:tit)?m|l)ice$/i, "$1ouse"],
	[/(seraph|cherub)im$/i, "$1"],
	[/(x|ch|ss|sh|zz|tto|go|cho|alias|[^aou]us|t[lm]as|gas|(?:her|at|gr)o|[aeiou]ris)(?:es)?$/i, "$1"],
	[/(analy|diagno|parenthe|progno|synop|the|empha|cri|ne)(?:sis|ses)$/i, "$1sis"],
	[/(movie|twelve|abuse|e[mn]u)s$/i, "$1"],
	[/(test)(?:is|es)$/i, "$1is"],
	[/(alumn|syllab|vir|radi|nucle|fung|cact|stimul|termin|bacill|foc|uter|loc|strat)(?:us|i)$/i, "$1us"],
	[/(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|quor)a$/i, "$1um"],
	[/(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat)a$/i, "$1on"],
	[/(alumn|alg|vertebr)ae$/i, "$1a"],
	[/(cod|mur|sil|vert|ind)ices$/i, "$1ex"],
	[/(matr|append)ices$/i, "$1ix"],
	[/(pe)(rson|ople)$/i, "$1rson"],
	[/(child)ren$/i, "$1"],
	[/(eau)x?$/i, "$1"],
	[/men$/i, "man"]
];
var defaultUncountables = [
	"adulthood",
	"advice",
	"agenda",
	"aid",
	"aircraft",
	"alcohol",
	"ammo",
	"analytics",
	"anime",
	"athletics",
	"audio",
	"bison",
	"blood",
	"bream",
	"buffalo",
	"butter",
	"carp",
	"cash",
	"chassis",
	"chess",
	"clothing",
	"cod",
	"commerce",
	"cooperation",
	"corps",
	"debris",
	"diabetes",
	"digestion",
	"elk",
	"energy",
	"equipment",
	"excretion",
	"expertise",
	"firmware",
	"flounder",
	"fun",
	"gallows",
	"garbage",
	"graffiti",
	"hardware",
	"headquarters",
	"health",
	"herpes",
	"highjinks",
	"homework",
	"housework",
	"information",
	"jeans",
	"justice",
	"kudos",
	"labour",
	"literature",
	"machinery",
	"mackerel",
	"mail",
	"media",
	"mews",
	"moose",
	"music",
	"mud",
	"manga",
	"news",
	"only",
	"personnel",
	"pike",
	"plankton",
	"pliers",
	"police",
	"pollution",
	"premises",
	"rain",
	"research",
	"rice",
	"salmon",
	"scissors",
	"series",
	"sewage",
	"shambles",
	"shrimp",
	"software",
	"staff",
	"swine",
	"tennis",
	"traffic",
	"transportation",
	"trout",
	"tuna",
	"wealth",
	"welfare",
	"whiting",
	"wildebeest",
	"wildlife",
	"you",
	/pok[eé]mon$/i,
	/[^aeiou]ese$/i,
	/deer$/i,
	/fish$/i,
	/measles$/i,
	/o[iu]s$/i,
	/pox$/i,
	/sheep$/i
];
for (const [single, plural] of defaultIrregulars) pluralize.addIrregularRule(single, plural);
for (const [search, replacement] of defaultPlurals) pluralize.addPluralRule(search, replacement);
for (const [search, replacement] of defaultSingles) pluralize.addSingularRule(search, replacement);
for (const search of defaultUncountables) pluralize.addUncountableRule(search);
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/codegen/relation-analyzer.js
/**
* Analyze schema to derive forward and reverse relations.
*/
/**
* Capitalize the first letter of a string.
*/
function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
function forwardRefNameFromFK(columnName) {
	const withoutIdSuffix = columnName.replace(/(?:_ids|Ids|_id|Id)$/, "");
	return columnName.endsWith("s") ? pluralize.plural(withoutIdSuffix) : withoutIdSuffix;
}
/**
* Analyze a WasmSchema and derive all forward and reverse relations.
*
* Forward relations: Created from FK columns, stripping Id/_id/Ids/_ids suffixes.
*   e.g., parent_id -> parent, assignees_ids -> assignees
*
* Reverse relations: Created on the target table of each FK.
*   e.g., todos.owner_id -> users gets a todosViaOwner reverse relation
*
* @param schema The WasmSchema to analyze
* @returns Map from table name to array of relations on that table
*/
function analyzeRelations(schema) {
	const relations = /* @__PURE__ */ new Map();
	for (const tableName of Object.keys(schema)) relations.set(tableName, []);
	for (const [tableName, table] of Object.entries(schema)) for (const col of table.columns) if (col.references) {
		if (!(col.column_type.type === "Uuid" || col.column_type.type === "Array" && col.column_type.element.type === "Uuid")) throw new Error(`Column "${tableName}.${col.name}" uses references but is not UUID or UUID[]`);
		const isForwardArray = col.column_type.type === "Array" && col.column_type.element.type === "Uuid";
		const forwardName = forwardRefNameFromFK(col.name);
		const forwardRelation = {
			name: forwardName,
			type: "forward",
			fromTable: tableName,
			toTable: col.references,
			fromColumn: col.name,
			toColumn: "id",
			isArray: isForwardArray,
			nullable: col.nullable
		};
		relations.get(tableName).push(forwardRelation);
		if (!relations.has(col.references)) throw new Error(`Table "${tableName}" references unknown table "${col.references}" via column "${col.name}"`);
		const reverseRelation = {
			name: `${tableName}Via${capitalize(forwardName)}`,
			type: "reverse",
			fromTable: col.references,
			toTable: tableName,
			fromColumn: "id",
			toColumn: col.name,
			isArray: true,
			nullable: false
		};
		relations.get(col.references).push(reverseRelation);
	}
	return relations;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/permissions/index.js
var OUTER_ROW_SESSION_PREFIX = "__jazz_outer_row";
var RECURSIVE_POLICY_MAX_DEPTH_DEFAULT = 10;
var RECURSIVE_POLICY_MAX_DEPTH_HARD_CAP = 64;
var CREATOR_CONDITION = {
	type: "Cmp",
	column: "$createdBy",
	op: "Eq",
	value: {
		type: "SessionRef",
		path: ["user_id"]
	}
};
function relationJoinAlias(kind, join, index) {
	if (kind === "recursive") return `__recursive_join_${index}`;
	return join.viaHop ? `__hop_${index}` : `__join_${index}`;
}
var PermissionRelationBuilder = class PermissionRelationBuilder {
	state;
	relations;
	constructor(state, relations) {
		this.state = state;
		this.relations = relations;
	}
	where(input) {
		if (this.state.kind === "union") throw new Error("where(...) does not support union(...) relations in MVP.");
		const where = resolveRelationWhereInput(input);
		const filters = [...this.state.filters, ...extractRelationFilters(where, this.state)];
		return new PermissionRelationBuilder({
			...this.state,
			filters
		}, this.relations);
	}
	join(target, on) {
		if (this.state.kind === "union") throw new Error("join(...) does not support union(...) relations in MVP.");
		const table = relationJoinTargetToTable(target);
		const joins = [...this.state.joins, {
			table,
			left: on.left,
			right: on.right
		}];
		return new PermissionRelationBuilder({
			...this.state,
			joins
		}, this.relations);
	}
	select(columns) {
		if (this.state.kind === "union") throw new Error("select(...) does not support union(...) relations in MVP.");
		return new PermissionRelationBuilder({
			...this.state,
			selectMap: normalizeRelationSelectMap(columns)
		}, this.relations);
	}
	hopTo(relation) {
		if (this.state.kind === "union") throw new Error("hopTo(...) does not support union(...) relations in MVP.");
		const relationName = relation.trim();
		if (!relationName) throw new Error("hopTo(...) requires a non-empty relation name.");
		if (this.state.kind === "table") {
			if (this.state.joins.length > 0) throw new Error("hopTo(...) currently supports a single hop per relation in MVP.");
			if (this.state.selectMap && Object.keys(this.state.selectMap).length > 0) throw new Error("hopTo(...) cannot be composed after select(...).");
			const rel = resolveNamedRelation(this.relations, this.state.outputTable, relationName);
			const join = rel.type === "forward" ? {
				table: rel.toTable,
				left: rel.fromColumn,
				right: "id",
				viaHop: true
			} : {
				table: rel.toTable,
				left: "id",
				right: rel.toColumn,
				viaHop: true
			};
			return new PermissionRelationBuilder({
				...this.state,
				outputTable: rel.toTable,
				joins: [...this.state.joins, join]
			}, this.relations);
		}
		if (this.state.joins.length > 0) throw new Error("hopTo(...) currently supports a single hop per relation in MVP.");
		const rel = resolveNamedRelation(this.relations, this.state.outputTable, relationName);
		if (rel.type !== "reverse") throw new Error(`Recursive hopTo("${relationName}") currently requires a reverse relation from "${this.state.outputTable}".`);
		return new PermissionRelationBuilder({
			...this.state,
			outputTable: rel.toTable,
			joins: [...this.state.joins, {
				table: rel.toTable,
				left: "id",
				right: rel.toColumn,
				viaHop: true
			}]
		}, this.relations);
	}
	gather(options) {
		if (typeof options.step !== "function") throw new Error("gather(...) requires a step callback.");
		if (this.state.selectMap && Object.keys(this.state.selectMap).length > 0) throw new Error("gather(...) does not support select(...) seeds in MVP.");
		if (options.start && this.state.kind === "union") throw new Error("gather(...) start does not support union(...) seeds in MVP.");
		const seedState = buildGatherSeedState(this.state, options.start, this.relations);
		const currentToken = { __jazzPermissionKind: "recursive-current" };
		const stepState = getRelationState(options.step({ current: currentToken }));
		if (stepState.kind !== "table") throw new Error("gather(...) step must return a relation built from policy.<table>.");
		if (stepState.joins.length !== 1 || !stepState.joins[0]?.viaHop) throw new Error("gather(...) step must include exactly one hopTo(...).");
		if (stepState.selectMap && Object.keys(stepState.selectMap).length > 0) throw new Error("gather(...) step does not support select(...).");
		const currentFilters = stepState.filters.filter((filter) => isRecursiveCurrentFilter(filter.raw, currentToken));
		if (currentFilters.length !== 1) throw new Error("gather(...) step must include exactly one where condition bound to current.");
		const currentFilter = currentFilters[0];
		if (!currentFilter) throw new Error("gather(...) step must include exactly one where condition bound to current.");
		const stepFilters = stepState.filters.filter((filter) => filter !== currentFilter);
		const stepJoin = stepState.joins[0];
		if (stepJoin.table !== this.state.outputTable || stripQualifier$1(stepJoin.right) !== "id") throw new Error(`gather(...) step must hop back to "${this.state.outputTable}" rows via hopTo(...).`);
		const seed = relationStateToRelExpr(seedState);
		const stepPredicates = [...stepFilters.flatMap((filter) => relationFilterToPredicates(filter)), { Cmp: {
			left: {
				scope: stepState.outputTable,
				column: stripQualifier$1(currentFilter.column)
			},
			op: "Eq",
			right: { RowId: "Frontier" }
		} }];
		const stepFiltered = applyRelFilter(stepState.base, stepPredicates);
		const recursiveHopScope = "__recursive_hop_0";
		const stepProjected = { Project: {
			input: { Join: {
				left: stepFiltered,
				right: { TableScan: { table: this.state.outputTable } },
				on: [{
					left: {
						scope: stepState.outputTable,
						column: stripQualifier$1(stepJoin.left)
					},
					right: {
						scope: recursiveHopScope,
						column: "id"
					}
				}],
				join_kind: "Inner"
			} },
			columns: projectHopResult(recursiveHopScope)
		} };
		const maxDepth = normalizeRecursiveRelationDepth(options.maxDepth);
		return new PermissionRelationBuilder({
			kind: "recursive",
			outputTable: this.state.outputTable,
			base: { Gather: {
				seed,
				step: stepProjected,
				frontier_key: { RowId: "Current" },
				max_depth: maxDepth,
				dedupe_key: [{ RowId: "Current" }]
			} },
			initialScope: this.state.outputTable,
			filters: [],
			joins: [],
			selectMap: void 0
		}, this.relations);
	}
	toState() {
		return this.state;
	}
};
var UpdateRuleBuilder = class {
	table;
	registerRule;
	oldCondition;
	newCondition;
	isRegistered = false;
	constructor(table, registerRule) {
		this.table = table;
		this.registerRule = registerRule;
	}
	where(input) {
		const condition = resolveWhereInput(input);
		const rule = {
			table: this.table,
			action: "update",
			using: condition,
			withCheck: condition
		};
		this.registerRule?.(rule);
		return rule;
	}
	never() {
		return this.where(neverCondition());
	}
	always() {
		return this.where(alwaysCondition());
	}
	whereOld(input) {
		this.oldCondition = resolveWhereInput(input);
		this.registerBuilder();
		return this;
	}
	whereNew(input) {
		this.newCondition = resolveWhereInput(input);
		this.registerBuilder();
		return this;
	}
	registerBuilder() {
		if (this.isRegistered) return;
		this.isRegistered = true;
		this.registerRule?.(this);
	}
	toRule() {
		if (!this.oldCondition && !this.newCondition) throw new Error(`Missing update policy conditions for table "${this.table}"`);
		return {
			table: this.table,
			action: "update",
			using: this.oldCondition ?? this.newCondition,
			withCheck: this.newCondition ?? this.oldCondition
		};
	}
};
function definePermissions(app, factory) {
	const fkReferencesByTable = collectFkReferencesByTable(app);
	const relationsByTable = collectRelationsByTable(app);
	const tableNames = Object.keys(app).filter((key) => key !== "wasmSchema");
	const rules = [];
	const seenRules = /* @__PURE__ */ new Set();
	const collectRule = (ruleLike) => {
		if (seenRules.has(ruleLike)) return;
		seenRules.add(ruleLike);
		rules.push(ruleLike);
	};
	factory({
		policy: buildPolicyContext(tableNames, relationsByTable, collectRule),
		anyOf,
		allOf,
		isCreator: CREATOR_CONDITION,
		allowedTo: createAllowedToContext(),
		session: createSessionContext()
	});
	return compileRules(rules, fkReferencesByTable, relationsByTable);
}
function collectFkReferencesByTable(app) {
	const result = /* @__PURE__ */ new Map();
	const schema = app.wasmSchema;
	if (!schema || typeof schema !== "object") return result;
	const typedSchema = schema;
	for (const [tableName, table] of Object.entries(typedSchema)) {
		if (!table || typeof table !== "object" || !Array.isArray(table.columns)) continue;
		const fkColumns = /* @__PURE__ */ new Map();
		for (const column of table.columns) if (column.references) fkColumns.set(column.name, column.references);
		result.set(tableName, fkColumns);
	}
	return result;
}
function collectRelationsByTable(app) {
	const schema = app.wasmSchema;
	if (!schema || typeof schema !== "object") return /* @__PURE__ */ new Map();
	const typedSchema = schema;
	try {
		return analyzeRelations(typedSchema);
	} catch {
		return /* @__PURE__ */ new Map();
	}
}
function buildPolicyContext(tableNames, relationsByTable, collectRule) {
	const context = {};
	for (const table of tableNames) context[table] = buildTablePolicyBuilder(table, relationsByTable, collectRule);
	context.exists = (relation) => ({
		__jazzPermissionKind: "exists-relation",
		relation
	});
	context.union = (relations) => createUnionRelation(relations, relationsByTable);
	return context;
}
function buildTablePolicyBuilder(table, relationsByTable, collectRule) {
	const registerRule = (rule) => {
		collectRule(rule);
		return rule;
	};
	const read = {
		where: (input) => registerRule({
			table,
			action: "read",
			using: resolveWhereInput(input)
		}),
		always: () => read.where(alwaysCondition()),
		never: () => read.where(neverCondition())
	};
	const insert = {
		where: (input) => registerRule({
			table,
			action: "insert",
			withCheck: resolveWhereInput(input)
		}),
		always: () => insert.where(alwaysCondition()),
		never: () => insert.where(neverCondition())
	};
	const del = {
		where: (input) => registerRule({
			table,
			action: "delete",
			using: resolveWhereInput(input)
		}),
		always: () => del.where(alwaysCondition()),
		never: () => del.where(neverCondition())
	};
	const updateFactory = () => new UpdateRuleBuilder(table, collectRule);
	const managedByCreator = () => {
		read.where(CREATOR_CONDITION);
		insert.where(CREATOR_CONDITION);
		updateFactory().where(CREATOR_CONDITION);
		del.where(CREATOR_CONDITION);
	};
	return {
		__jazzPermissionKind: "table-builder",
		__jazzPermissionTable: table,
		allowRead: read,
		allowReads: read,
		allowInsert: insert,
		allowInserts: insert,
		allowDelete: del,
		allowDeletes: del,
		get allowUpdate() {
			return updateFactory();
		},
		get allowUpdates() {
			return updateFactory();
		},
		managedByCreator,
		exists: { where: (input) => ({
			__jazzPermissionKind: "exists",
			table,
			where: normalizeWhereObject(input)
		}) },
		where(input) {
			return createTableRelation(table, relationsByTable).where(input);
		},
		select(columns) {
			return createTableRelation(table, relationsByTable).select(columns);
		},
		hopTo(relation) {
			return createTableRelation(table, relationsByTable).hopTo(relation);
		},
		gather(options) {
			return createTableRelation(table, relationsByTable).gather(options);
		}
	};
}
function createTableRelation(table, relationsByTable) {
	return new PermissionRelationBuilder({
		kind: "table",
		outputTable: table,
		base: { TableScan: { table } },
		initialScope: table,
		filters: [],
		joins: [],
		selectMap: void 0
	}, relationsByTable);
}
function createUnionRelation(relations, relationsByTable) {
	if (relations.length === 0) throw new Error("union(...) requires at least one relation.");
	const states = relations.map((relation) => getRelationState(relation));
	const firstState = states[0];
	if (!firstState) throw new Error("union(...) requires at least one relation.");
	if (states.some((state) => state.outputTable !== firstState.outputTable)) throw new Error("union(...) requires all relations to output the same table.");
	if (states.some((state) => state.selectMap && Object.keys(state.selectMap).length > 0)) throw new Error("union(...) does not support select(...) relations in MVP.");
	return new PermissionRelationBuilder({
		kind: "union",
		outputTable: firstState.outputTable,
		base: { Union: { inputs: states.map((state) => relationStateToRelExpr(state)) } },
		initialScope: "",
		filters: [],
		joins: [],
		selectMap: void 0
	}, relationsByTable);
}
function buildGatherSeedState(state, start, relationsByTable) {
	if (start === void 0) return state;
	const startWhere = resolveRelationWhereInput(start);
	const baseScope = currentRelationScope(state);
	const joins = [...state.joins];
	const filters = [...state.filters];
	const qualifiedRelationByPrefix = /* @__PURE__ */ new Map();
	const qualifiedScopeByPrefix = /* @__PURE__ */ new Map();
	for (const [column, raw] of Object.entries(startWhere)) {
		if (raw === void 0) continue;
		const [prefix, bare] = splitQualifiedColumn(column);
		if (!prefix || prefix === state.outputTable) {
			filters.push({
				column: bare,
				raw,
				scope: baseScope
			});
			continue;
		}
		const relation = resolveQualifiedGatherStartRelation(relationsByTable, state.outputTable, prefix, bare);
		const existingRelation = qualifiedRelationByPrefix.get(prefix);
		if (existingRelation && existingRelation.name !== relation.name) throw new Error(`gather(...) qualified start table "${prefix}" is ambiguous from "${state.outputTable}"; use an explicit relation seed instead.`);
		qualifiedRelationByPrefix.set(prefix, relation);
		let scope = qualifiedScopeByPrefix.get(prefix);
		if (!scope) {
			const join = relationToJoinSpec(relation);
			joins.push(join);
			scope = relationJoinAlias(state.kind, join, joins.length - 1);
			qualifiedScopeByPrefix.set(prefix, scope);
		}
		filters.push({
			column: bare,
			raw,
			scope
		});
	}
	return {
		...state,
		joins,
		filters
	};
}
function resolveQualifiedGatherStartRelation(relationsByTable, outputTable, qualifiedTable, column) {
	const candidates = (relationsByTable.get(outputTable) ?? []).filter((relation) => relation.toTable === qualifiedTable);
	if (candidates.length === 0) throw new Error(`gather(...) qualified start column "${qualifiedTable}.${column}" does not match a direct relation from "${outputTable}".`);
	if (candidates.length === 1) return candidates[0];
	const disambiguated = candidates.filter((relation) => relation.type === "forward" ? relation.fromColumn === column : relation.toColumn === column);
	if (disambiguated.length === 1) return disambiguated[0];
	throw new Error(`gather(...) qualified start table "${qualifiedTable}" is ambiguous from "${outputTable}"; use an explicit relation seed instead.`);
}
function resolveQualifiedRuleRelation(relationsByTable, outputTable, qualifiedTable, column) {
	const candidates = (relationsByTable.get(outputTable) ?? []).filter((relation) => relation.toTable === qualifiedTable);
	if (candidates.length === 0) throw new Error(`Qualified where(...) column "${qualifiedTable}.${column}" does not match a direct relation from "${outputTable}".`);
	if (candidates.length === 1) return candidates[0];
	const disambiguated = candidates.filter((relation) => relation.type === "forward" ? relation.fromColumn === column : relation.toColumn === column);
	if (disambiguated.length === 1) return disambiguated[0];
	throw new Error(`Qualified where(...) table "${qualifiedTable}" is ambiguous from "${outputTable}"; use an explicit relation instead.`);
}
function relationToJoinSpec(relation) {
	if (relation.type === "forward") return {
		table: relation.toTable,
		left: relation.fromColumn,
		right: "id"
	};
	return {
		table: relation.toTable,
		left: "id",
		right: relation.toColumn
	};
}
function relationJoinTargetToTable(target) {
	if (typeof target === "string") return target;
	if (isPlainObject$1(target) && target.__jazzPermissionKind === "table-builder" && typeof target.__jazzPermissionTable === "string") return target.__jazzPermissionTable;
	throw new Error("join(...) expects a table builder (policy.<table>) or table name string.");
}
function resolveNamedRelation(relationsByTable, table, relationName) {
	const relation = (relationsByTable.get(table) ?? []).find((candidate) => candidate.name === relationName);
	if (!relation) throw new Error(`Unknown relation "${relationName}" on table "${table}".`);
	return relation;
}
function isRecursiveCurrentFilter(raw, token) {
	if (raw === token) return true;
	if (!isPlainObject$1(raw)) return false;
	const keys = Object.keys(raw).filter((key) => raw[key] !== void 0);
	return keys.length === 1 && keys[0] === "eq" && raw.eq === token;
}
function resolveRelationWhereInput(input) {
	if (typeof input === "function") return resolveRelationWhereInput(input(createRowContext()));
	return normalizeWhereObject(input);
}
function currentRelationScope(state) {
	if (state.joins.length === 0) return state.initialScope;
	const joinIndex = state.joins.length - 1;
	const join = state.joins[joinIndex];
	return relationJoinAlias(state.kind, join, joinIndex);
}
function extractRelationFilters(where, state) {
	const filters = [];
	const defaultScope = currentRelationScope(state);
	for (const [column, raw] of Object.entries(where)) {
		if (raw === void 0) continue;
		const [prefix, bare] = splitQualifiedColumn(column);
		filters.push({
			column: bare,
			raw,
			scope: prefix ? resolveQualifiedRelationFilterScope(state, prefix, bare) : defaultScope
		});
	}
	return filters;
}
function relationBaseScopeBinding(state) {
	if (!state.initialScope) return null;
	return {
		table: state.initialScope,
		scope: state.initialScope
	};
}
function resolveQualifiedRelationFilterScope(state, qualifiedTable, column) {
	const scopes = /* @__PURE__ */ new Set();
	const baseBinding = relationBaseScopeBinding(state);
	if (baseBinding && baseBinding.table === qualifiedTable) scopes.add(baseBinding.scope);
	state.joins.forEach((join, index) => {
		if (join.table === qualifiedTable) scopes.add(relationJoinAlias(state.kind, join, index));
	});
	if (scopes.size === 0) throw new Error(`Qualified relation where(...) column "${qualifiedTable}.${column}" does not match the current relation scopes.`);
	if (scopes.size > 1) throw new Error(`Qualified relation where(...) table "${qualifiedTable}" is ambiguous in the current relation; use an unambiguous relation shape instead.`);
	return scopes.values().next().value;
}
function normalizeRelationSelectMap(columns) {
	if (!isPlainObject$1(columns)) throw new Error("select(...) expects an object map: { alias: column }.");
	const entries = Object.entries(columns);
	if (entries.length === 0) throw new Error("select(...) requires at least one projected column.");
	const selectMap = {};
	for (const [alias, column] of entries) {
		const normalizedAlias = alias.trim();
		if (!normalizedAlias) throw new Error("select(...) alias names must be non-empty strings.");
		if (typeof column !== "string" || !column.trim()) throw new Error(`select(...) column for alias "${alias}" must be a non-empty string.`);
		selectMap[normalizedAlias] = stripQualifier$1(column);
	}
	return selectMap;
}
function normalizeRecursiveRelationDepth(maxDepth) {
	if (maxDepth === void 0) return RECURSIVE_POLICY_MAX_DEPTH_DEFAULT;
	if (!Number.isInteger(maxDepth) || maxDepth <= 0) throw new Error("gather(...) maxDepth must be a positive integer.");
	if (maxDepth > RECURSIVE_POLICY_MAX_DEPTH_HARD_CAP) throw new Error(`gather(...) maxDepth ${maxDepth} exceeds hard cap ${RECURSIVE_POLICY_MAX_DEPTH_HARD_CAP}.`);
	return maxDepth;
}
function getRelationState(relation) {
	if (relation instanceof PermissionRelationBuilder) return relation.toState();
	throw new Error("Expected a relation built from policy.<table> with where/join/hopTo/gather.");
}
function relationColumnRef(column, defaultScope) {
	const [prefix, bare] = splitQualifiedColumn(column);
	if (prefix) return {
		scope: prefix,
		column: bare
	};
	return defaultScope ? {
		scope: defaultScope,
		column: bare
	} : { column: bare };
}
function toRelValueRef(value, options) {
	if (isSessionRefValue(value)) return { SessionRef: value.path };
	if (isRowRefValue(value)) {
		if (!options.allowRowRefs) throw new Error("Row references are only valid inside exists() clauses.");
		return { OuterColumn: { column: value.column } };
	}
	return { Literal: value };
}
function relationFilterToPredicates(filter) {
	const left = relationColumnRef(filter.column, filter.scope);
	const raw = filter.raw;
	if (raw === null) return [{ IsNull: { column: left } }];
	if (isSessionRefValue(raw) || isRowRefValue(raw)) return [{ Cmp: {
		left,
		op: "Eq",
		right: toRelValueRef(raw, { allowRowRefs: true })
	} }];
	if (!isPlainObject$1(raw)) return [{ Cmp: {
		left,
		op: "Eq",
		right: { Literal: raw }
	} }];
	const predicates = [];
	for (const [op, value] of Object.entries(raw)) {
		if (value === void 0) continue;
		switch (op) {
			case "eq":
				if (value === null) predicates.push({ IsNull: { column: left } });
				else predicates.push({ Cmp: {
					left,
					op: "Eq",
					right: toRelValueRef(value, { allowRowRefs: true })
				} });
				break;
			case "ne":
				if (value === null) predicates.push({ IsNotNull: { column: left } });
				else predicates.push({ Cmp: {
					left,
					op: "Ne",
					right: toRelValueRef(value, { allowRowRefs: true })
				} });
				break;
			case "gt":
				predicates.push({ Cmp: {
					left,
					op: "Gt",
					right: toRelValueRef(value, { allowRowRefs: true })
				} });
				break;
			case "gte":
				predicates.push({ Cmp: {
					left,
					op: "Ge",
					right: toRelValueRef(value, { allowRowRefs: true })
				} });
				break;
			case "lt":
				predicates.push({ Cmp: {
					left,
					op: "Lt",
					right: toRelValueRef(value, { allowRowRefs: true })
				} });
				break;
			case "lte":
				predicates.push({ Cmp: {
					left,
					op: "Le",
					right: toRelValueRef(value, { allowRowRefs: true })
				} });
				break;
			case "isNull":
				if (typeof value !== "boolean") throw new Error(`"${filter.column}.isNull" expects a boolean value.`);
				predicates.push(value ? { IsNull: { column: left } } : { IsNotNull: { column: left } });
				break;
			case "in":
				if (!Array.isArray(value)) throw new Error(`"${filter.column}.in" expects an array value.`);
				predicates.push({ In: {
					left,
					values: value.map((entry) => toRelValueRef(entry, { allowRowRefs: true }))
				} });
				break;
			case "contains":
				predicates.push({ Contains: {
					left,
					right: toRelValueRef(value, { allowRowRefs: true })
				} });
				break;
			default: throw new Error(`Unsupported where operator "${op}" in relation IR lowering.`);
		}
	}
	return predicates.length > 0 ? predicates : ["True"];
}
function andRelPredicates(predicates) {
	if (predicates.length === 0) return "True";
	if (predicates.length === 1) return predicates[0];
	return { And: predicates };
}
function applyRelFilter(input, predicates) {
	const predicate = andRelPredicates(predicates);
	if (predicate === "True") return input;
	return { Filter: {
		input,
		predicate
	} };
}
function joinConditionFromSpec(join, leftScope, rightScope) {
	return {
		left: relationColumnRef(join.left, leftScope),
		right: relationColumnRef(join.right, rightScope)
	};
}
function projectHopResult(scope) {
	return [{
		alias: "id",
		expr: { Column: {
			scope,
			column: "id"
		} }
	}];
}
function applyRelationTail(options) {
	let relation = options.base;
	let defaultScope = options.initialScope;
	let hasHopJoin = false;
	for (let i = 0; i < options.joins.length; i += 1) {
		const join = options.joins[i];
		const rightScope = options.joinAlias(join, i);
		relation = { Join: {
			left: relation,
			right: { TableScan: { table: join.table } },
			on: [joinConditionFromSpec(join, defaultScope, rightScope)],
			join_kind: "Inner"
		} };
		defaultScope = rightScope;
		hasHopJoin ||= Boolean(join.viaHop);
	}
	const predicates = options.filters.flatMap((filter) => relationFilterToPredicates(filter));
	relation = applyRelFilter(relation, predicates);
	if (options.selectMap && Object.keys(options.selectMap).length > 0) {
		const columns = Object.entries(options.selectMap).map(([alias, column]) => ({
			alias,
			expr: { Column: relationColumnRef(column, defaultScope) }
		}));
		relation = { Project: {
			input: relation,
			columns
		} };
	} else if (hasHopJoin) relation = { Project: {
		input: relation,
		columns: projectHopResult(defaultScope)
	} };
	return relation;
}
function relationStateToRelExpr(state) {
	return applyRelationTail({
		base: state.base,
		initialScope: state.initialScope,
		joins: state.joins,
		filters: state.filters,
		selectMap: state.selectMap,
		joinAlias: (join, index) => relationJoinAlias(state.kind, join, index)
	});
}
function relationToIr(relation) {
	return relationStateToRelExpr(getRelationState(relation));
}
function splitQualifiedColumn(column) {
	const dotIndex = column.indexOf(".");
	if (dotIndex < 0) return [void 0, column];
	return [column.slice(0, dotIndex), column.slice(dotIndex + 1)];
}
function stripQualifier$1(column) {
	const [, bare] = splitQualifiedColumn(column);
	return bare;
}
/** @internal */
function createSessionContext() {
	const claimRef = (path) => ({
		__jazzPermissionKind: "session-ref",
		path: normalizeSessionPath(path)
	});
	const whereBuilder = ((input) => ({
		__jazzPermissionKind: "session-where",
		where: normalizeWhereObject(input)
	}));
	return new Proxy({}, { get(_target, prop, _receiver) {
		if (typeof prop === "string") {
			if (prop === "where") return whereBuilder;
			return claimRef(prop);
		}
	} });
}
function createAllowedToContext() {
	const inheritsExpr = (operation, fkColumn, options) => {
		const maxDepth = options?.maxDepth;
		if (maxDepth !== void 0) {
			if (!Number.isInteger(maxDepth) || maxDepth <= 0) throw new Error(`allowedTo.*("${fkColumn}") maxDepth must be a positive integer.`);
		}
		const expr = {
			type: "Inherits",
			operation,
			via_column: fkColumn
		};
		if (maxDepth !== void 0) expr.max_depth = maxDepth;
		return expr;
	};
	const inheritsReferencingExpr = (operation, sourceTable, fkColumn, options) => {
		const maxDepth = options?.maxDepth;
		if (maxDepth !== void 0) {
			if (!Number.isInteger(maxDepth) || maxDepth <= 0) throw new Error(`allowedTo.*Referencing(..., "${fkColumn}") maxDepth must be a positive integer.`);
		}
		const expr = {
			type: "InheritsReferencing",
			operation,
			source_table: relationJoinTargetToTable(sourceTable),
			via_column: fkColumn
		};
		if (maxDepth !== void 0) expr.max_depth = maxDepth;
		return expr;
	};
	return {
		read(fkColumn, options) {
			return inheritsExpr("Select", fkColumn, options);
		},
		insert(fkColumn, options) {
			return inheritsExpr("Insert", fkColumn, options);
		},
		update(fkColumn, options) {
			return inheritsExpr("Update", fkColumn, options);
		},
		delete(fkColumn, options) {
			return inheritsExpr("Delete", fkColumn, options);
		},
		readReferencing(sourceTable, fkColumn, options) {
			return inheritsReferencingExpr("Select", sourceTable, fkColumn, options);
		},
		insertReferencing(sourceTable, fkColumn, options) {
			return inheritsReferencingExpr("Insert", sourceTable, fkColumn, options);
		},
		updateReferencing(sourceTable, fkColumn, options) {
			return inheritsReferencingExpr("Update", sourceTable, fkColumn, options);
		},
		deleteReferencing(sourceTable, fkColumn, options) {
			return inheritsReferencingExpr("Delete", sourceTable, fkColumn, options);
		}
	};
}
function normalizeSessionPath(path) {
	return (Array.isArray(path) ? path : path.split(".")).map((part) => part.trim()).filter((part) => part.length > 0);
}
function createRowContext() {
	return new Proxy({}, { get(_target, prop) {
		if (typeof prop === "string") return {
			__jazzPermissionKind: "row-ref",
			column: prop
		};
	} });
}
function normalizeWhereObject(input) {
	if (!isPlainObject$1(input)) throw new Error("Expected a where-object condition.");
	return input;
}
function resolveWhereInput(input) {
	if (typeof input === "function") return resolveWhereInput(input(createRowContext()));
	if (isSessionWhereCondition(input)) return input;
	if (isExistsCondition(input)) return input;
	if (isExistsRelationCondition(input)) return input;
	if (isCompoundCondition(input)) return input;
	if (isPolicyExpr(input)) return input;
	if (isPlainObject$1(input)) return {
		__jazzPermissionKind: "where-object",
		where: normalizeWhereObject(input)
	};
	throw new Error("Unsupported permission condition input.");
}
function filtersToCondition(filters, options) {
	const exprs = [];
	for (const filter of filters) exprs.push(...columnFilterToExprs(filter.column, filter.raw, options));
	return andExpr(exprs);
}
function analyzeQualifiedWhereObject(table, where, relationsByTable) {
	const joins = [];
	const filters = [];
	const qualifiedRelationByPrefix = /* @__PURE__ */ new Map();
	const qualifiedScopeByPrefix = /* @__PURE__ */ new Map();
	let hasQualifiedFilters = false;
	for (const [column, raw] of Object.entries(where)) {
		if (raw === void 0) continue;
		const [prefix, bare] = splitQualifiedColumn(column);
		if (!prefix || prefix === table) {
			filters.push({
				column: bare,
				raw,
				scope: table
			});
			continue;
		}
		hasQualifiedFilters = true;
		const relation = resolveQualifiedRuleRelation(relationsByTable, table, prefix, bare);
		const existingRelation = qualifiedRelationByPrefix.get(prefix);
		if (existingRelation && existingRelation.name !== relation.name) throw new Error(`Qualified where(...) table "${prefix}" is ambiguous from "${table}"; use an explicit relation instead.`);
		qualifiedRelationByPrefix.set(prefix, relation);
		let scope = qualifiedScopeByPrefix.get(prefix);
		if (!scope) {
			const join = relationToJoinSpec(relation);
			joins.push(join);
			scope = relationJoinAlias("table", join, joins.length - 1);
			qualifiedScopeByPrefix.set(prefix, scope);
		}
		filters.push({
			column: bare,
			raw,
			scope
		});
	}
	return {
		hasQualifiedFilters,
		joins,
		filters
	};
}
function compileQualifiedWhereRelation(table, where, relationsByTable, options) {
	const analysis = analyzeQualifiedWhereObject(table, where, relationsByTable);
	let relation = applyRelationTail({
		base: { TableScan: { table } },
		initialScope: table,
		joins: analysis.joins,
		filters: analysis.filters,
		selectMap: void 0,
		joinAlias: (join, index) => relationJoinAlias("table", join, index)
	});
	if (!options.anchorOuterRow) return relation;
	relation = applyRelFilter(relation, [{ Cmp: {
		left: {
			scope: table,
			column: "id"
		},
		op: "Eq",
		right: { RowId: "Outer" }
	} }]);
	return relation;
}
function sessionWhereObjectToCondition(where) {
	const exprs = [];
	for (const [path, raw] of Object.entries(where)) {
		if (raw === void 0) continue;
		exprs.push(...sessionPathFilterToExprs(path, raw));
	}
	return andExpr(exprs);
}
function columnFilterToExprs(column, raw, options) {
	if (raw === null) return [{
		type: "IsNull",
		column
	}];
	if (isSessionRefValue(raw)) return [cmpExpr(column, "Eq", raw, options)];
	if (isRowRefValue(raw)) {
		if (!options.allowRowRefs) throw new Error("Row references are only valid inside exists() clauses.");
		return [cmpExpr(column, "Eq", raw, options)];
	}
	if (isPlainObject$1(raw)) {
		const exprs = [];
		for (const [op, value] of Object.entries(raw)) {
			if (value === void 0) continue;
			switch (op) {
				case "eq":
					if (value === null) exprs.push({
						type: "IsNull",
						column
					});
					else exprs.push(cmpExpr(column, "Eq", value, options));
					break;
				case "ne":
					if (value === null) exprs.push({
						type: "IsNotNull",
						column
					});
					else exprs.push(cmpExpr(column, "Ne", value, options));
					break;
				case "gt":
					exprs.push(cmpExpr(column, "Gt", value, options));
					break;
				case "gte":
					exprs.push(cmpExpr(column, "Ge", value, options));
					break;
				case "lt":
					exprs.push(cmpExpr(column, "Lt", value, options));
					break;
				case "lte":
					exprs.push(cmpExpr(column, "Le", value, options));
					break;
				case "isNull":
					if (typeof value !== "boolean") throw new Error(`"${column}.isNull" expects a boolean value.`);
					exprs.push(value ? {
						type: "IsNull",
						column
					} : {
						type: "IsNotNull",
						column
					});
					break;
				case "contains":
					exprs.push({
						type: "Contains",
						column,
						value: toPolicyValue(value, options)
					});
					break;
				case "in":
					if (isSessionRefValue(value)) {
						exprs.push({
							type: "In",
							column,
							session_path: value.path
						});
						break;
					}
					if (!Array.isArray(value)) throw new Error(`"${column}.in" expects an array or session reference.`);
					if (value.length === 0) {
						exprs.push({ type: "False" });
						break;
					}
					exprs.push({
						type: "InList",
						column,
						values: value.map((entry) => toPolicyValue(entry, options))
					});
					break;
				default: throw new Error(`Unsupported where operator "${op}" in permissions DSL.`);
			}
		}
		return exprs.length === 0 ? [{ type: "True" }] : exprs;
	}
	return [cmpExpr(column, "Eq", raw, options)];
}
function sessionPathFilterToExprs(path, raw) {
	const sessionPath = normalizeSessionPath(path);
	if (sessionPath.length === 0) throw new Error("session.where(...) requires non-empty session path keys.");
	if (raw === null) return [{
		type: "SessionIsNull",
		path: sessionPath
	}];
	if (!isPlainObject$1(raw) || isSessionRefValue(raw) || isRowRefValue(raw) || isRecursiveCurrentValue(raw) || isExistsCondition(raw) || isExistsRelationCondition(raw) || isCompoundCondition(raw) || isPolicyExpr(raw)) return [sessionCmpExpr(sessionPath, "Eq", raw, path)];
	const exprs = [];
	for (const [op, value] of Object.entries(raw)) {
		if (value === void 0) continue;
		switch (op) {
			case "eq":
				if (value === null) exprs.push({
					type: "SessionIsNull",
					path: sessionPath
				});
				else exprs.push(sessionCmpExpr(sessionPath, "Eq", value, path));
				break;
			case "ne":
				if (value === null) exprs.push({
					type: "SessionIsNotNull",
					path: sessionPath
				});
				else exprs.push(sessionCmpExpr(sessionPath, "Ne", value, path));
				break;
			case "gt":
				exprs.push(sessionCmpExpr(sessionPath, "Gt", value, path));
				break;
			case "gte":
				exprs.push(sessionCmpExpr(sessionPath, "Ge", value, path));
				break;
			case "lt":
				exprs.push(sessionCmpExpr(sessionPath, "Lt", value, path));
				break;
			case "lte":
				exprs.push(sessionCmpExpr(sessionPath, "Le", value, path));
				break;
			case "isNull":
				if (typeof value !== "boolean") throw new Error(`session.where("${path}.isNull") expects a boolean value.`);
				exprs.push(value ? {
					type: "SessionIsNull",
					path: sessionPath
				} : {
					type: "SessionIsNotNull",
					path: sessionPath
				});
				break;
			case "contains":
				exprs.push({
					type: "SessionContains",
					path: sessionPath,
					value: toPolicyLiteralValue(value, `session.where("${path}.contains")`)
				});
				break;
			case "in":
				if (!Array.isArray(value)) throw new Error(`session.where("${path}.in") expects an array of literal values.`);
				if (value.length === 0) {
					exprs.push({ type: "False" });
					break;
				}
				exprs.push({
					type: "SessionInList",
					path: sessionPath,
					values: value.map((entry) => toPolicyLiteralValue(entry, `session.where("${path}.in")`))
				});
				break;
			default: throw new Error(`Unsupported session.where operator "${op}" in permissions DSL. Nested object claim syntax is not supported; use dotted path keys instead.`);
		}
	}
	return exprs.length === 0 ? [{ type: "True" }] : exprs;
}
function cmpExpr(column, op, value, options) {
	return {
		type: "Cmp",
		column,
		op,
		value: toPolicyValue(value, options)
	};
}
function sessionCmpExpr(path, op, value, originalPath) {
	return {
		type: "SessionCmp",
		path,
		op,
		value: toPolicyLiteralValue(value, `session.where("${originalPath}")`)
	};
}
function toPolicyValue(value, options) {
	if (isSessionRefValue(value)) return {
		type: "SessionRef",
		path: value.path
	};
	if (isRowRefValue(value)) {
		if (!options.allowRowRefs) throw new Error("Row references are only valid inside exists() clauses.");
		return {
			type: "SessionRef",
			path: [OUTER_ROW_SESSION_PREFIX, value.column]
		};
	}
	return {
		type: "Literal",
		value
	};
}
function toPolicyLiteralValue(value, context) {
	assertSessionWhereLiteralValue(value, context);
	return {
		type: "Literal",
		value
	};
}
function assertSessionWhereLiteralValue(value, context) {
	if (isSessionRefValue(value)) throw new Error(`${context} only accepts literal values; session references are not supported.`);
	if (isRowRefValue(value)) throw new Error(`${context} only accepts literal values; row references are not supported.`);
	if (isRecursiveCurrentValue(value)) throw new Error(`${context} only accepts literal values; recursive current refs are not supported.`);
	if (isExistsCondition(value) || isExistsRelationCondition(value) || isCompoundCondition(value) || isPolicyExpr(value)) throw new Error(`${context} only accepts literal values; relation and policy expressions are not supported.`);
	if (typeof value === "function" || value === void 0) throw new Error(`${context} only accepts literal values.`);
	if (Array.isArray(value)) {
		for (const entry of value) assertSessionWhereLiteralValue(entry, context);
		return;
	}
	if (isPlainObject$1(value)) throw new Error(`${context} only accepts literal values; nested objects are not supported.`);
}
function andExpr(exprs) {
	if (exprs.length === 0) return { type: "True" };
	if (exprs.length === 1) return exprs[0];
	return {
		type: "And",
		exprs
	};
}
function anyOf(conditions) {
	return compoundCondition("Or", conditions);
}
function allOf(conditions) {
	return compoundCondition("And", conditions);
}
function alwaysCondition() {
	return allOf([]);
}
function neverCondition() {
	return anyOf([]);
}
function compoundCondition(op, inputs) {
	if (!Array.isArray(inputs)) throw new Error(`"${op === "And" ? "allOf" : "anyOf"}(...)" expects an array of conditions.`);
	return {
		__jazzPermissionKind: "compound",
		op,
		conditions: inputs.map((input) => resolveWhereInput(input))
	};
}
function compileRules(rules, fkReferencesByTable, relationsByTable) {
	const compiled = {};
	for (const ruleLike of rules) {
		const rule = isUpdateRuleBuilder(ruleLike) ? ruleLike.toRule() : ruleLike;
		if (!compiled[rule.table]) compiled[rule.table] = emptyTablePolicies();
		const tablePolicies = compiled[rule.table];
		switch (rule.action) {
			case "read":
				tablePolicies.select = mergeOperationPolicy(tablePolicies.select, { using: compileCondition(rule.using, rule.table, fkReferencesByTable, relationsByTable) });
				break;
			case "insert":
				tablePolicies.insert = mergeOperationPolicy(tablePolicies.insert, { with_check: compileCondition(rule.withCheck, rule.table, fkReferencesByTable, relationsByTable) });
				break;
			case "update":
				tablePolicies.update = mergeOperationPolicy(tablePolicies.update, {
					using: compileCondition(rule.using, rule.table, fkReferencesByTable, relationsByTable),
					with_check: compileCondition(rule.withCheck, rule.table, fkReferencesByTable, relationsByTable)
				});
				break;
			case "delete":
				tablePolicies.delete = mergeOperationPolicy(tablePolicies.delete, { using: compileCondition(rule.using, rule.table, fkReferencesByTable, relationsByTable) });
				break;
			default: throw new Error(`Unsupported action ${rule.action}`);
		}
	}
	return compiled;
}
function emptyOperationPolicy() {
	return {};
}
function emptyTablePolicies() {
	return {
		select: emptyOperationPolicy(),
		insert: emptyOperationPolicy(),
		update: emptyOperationPolicy(),
		delete: emptyOperationPolicy()
	};
}
function mergeOperationPolicy(existing, incoming) {
	return {
		using: mergeExprWithOr(existing?.using, incoming.using),
		with_check: mergeExprWithOr(existing?.with_check, incoming.with_check)
	};
}
function mergeExprWithOr(left, right) {
	if (!left) return right;
	if (!right) return left;
	const exprs = [];
	if (left.type === "Or") exprs.push(...left.exprs);
	else exprs.push(left);
	if (right.type === "Or") exprs.push(...right.exprs);
	else exprs.push(right);
	return {
		type: "Or",
		exprs
	};
}
function compileCondition(condition, table, fkReferencesByTable, relationsByTable) {
	if (!condition) return;
	if (isWhereObjectCondition(condition)) {
		const analysis = analyzeQualifiedWhereObject(table, condition.where, relationsByTable);
		if (analysis.hasQualifiedFilters) return {
			type: "ExistsRel",
			rel: compileQualifiedWhereRelation(table, condition.where, relationsByTable, { anchorOuterRow: true })
		};
		const compiledCondition = filtersToCondition(analysis.filters, { allowRowRefs: false });
		resolveAndAssertInheritsColumns(compiledCondition, table, fkReferencesByTable);
		return compiledCondition;
	}
	if (isPolicyExpr(condition)) {
		resolveAndAssertInheritsColumns(condition, table, fkReferencesByTable);
		return condition;
	}
	if (isSessionWhereCondition(condition)) return sessionWhereObjectToCondition(condition.where);
	if (isExistsRelationCondition(condition)) return {
		type: "ExistsRel",
		rel: relationToIr(condition.relation)
	};
	if (isExistsCondition(condition)) {
		const analysis = analyzeQualifiedWhereObject(condition.table, condition.where, relationsByTable);
		if (analysis.hasQualifiedFilters) return {
			type: "ExistsRel",
			rel: compileQualifiedWhereRelation(condition.table, condition.where, relationsByTable, { anchorOuterRow: false })
		};
		const compiledCondition = filtersToCondition(analysis.filters, { allowRowRefs: true });
		resolveAndAssertInheritsColumns(compiledCondition, condition.table, fkReferencesByTable);
		return {
			type: "Exists",
			table: condition.table,
			condition: compiledCondition
		};
	}
	if (isCompoundCondition(condition)) {
		const exprs = condition.conditions.map((child) => compileCondition(child, table, fkReferencesByTable, relationsByTable)).filter((expr) => Boolean(expr));
		if (exprs.length === 0) return condition.op === "And" ? { type: "True" } : { type: "False" };
		if (exprs.length === 1) return exprs[0];
		return condition.op === "And" ? {
			type: "And",
			exprs
		} : {
			type: "Or",
			exprs
		};
	}
	throw new Error("Unsupported condition in permissions compiler.");
}
function resolveFkColumn(name, fkColumns) {
	if (fkColumns.has(name)) return name;
	const withId = name + "Id";
	if (fkColumns.has(withId)) return withId;
	const withUnderId = name + "_id";
	if (fkColumns.has(withUnderId)) return withUnderId;
}
function resolveAndAssertInheritsColumns(expr, table, fkReferencesByTable) {
	const check = (node, currentTable) => {
		switch (node.type) {
			case "Inherits": {
				const fkColumns = fkReferencesByTable.get(currentTable);
				if (!fkColumns) throw new Error(`allowedTo.${node.operation.toLowerCase()}("${node.via_column}") is invalid for table "${currentTable}": table metadata is missing in app.wasmSchema.`);
				const resolved = resolveFkColumn(node.via_column, fkColumns);
				if (!resolved) {
					const fkList = [...fkColumns.keys()].sort();
					const available = fkList.length > 0 ? fkList.join(", ") : "(none)";
					throw new Error(`allowedTo.${node.operation.toLowerCase()}("${node.via_column}") is invalid for table "${currentTable}": column is not a foreign key reference. Available FK columns: ${available}.`);
				}
				node.via_column = resolved;
				break;
			}
			case "InheritsReferencing": {
				const originalColumn = node.via_column;
				const sourceFks = fkReferencesByTable.get(node.source_table);
				if (!sourceFks) throw new Error(`allowedTo.${node.operation.toLowerCase()}Referencing(policy.${node.source_table}, "${originalColumn}") is invalid for table "${currentTable}": source table metadata is missing in app.wasmSchema.`);
				const resolved = resolveFkColumn(originalColumn, sourceFks);
				if (!resolved) {
					const fkList = [...sourceFks.keys()].sort();
					const available = fkList.length > 0 ? fkList.join(", ") : "(none)";
					throw new Error(`allowedTo.${node.operation.toLowerCase()}Referencing(policy.${node.source_table}, "${originalColumn}") is invalid for table "${currentTable}": column is not a foreign key reference on source table. Available FK columns: ${available}.`);
				}
				node.via_column = resolved;
				const referenced = sourceFks.get(resolved);
				if (referenced !== currentTable) throw new Error(`allowedTo.${node.operation.toLowerCase()}Referencing(policy.${node.source_table}, "${originalColumn}") is invalid for table "${currentTable}": source FK references "${referenced}" but this rule is for "${currentTable}".`);
				break;
			}
			case "And":
			case "Or":
				for (const child of node.exprs) check(child, currentTable);
				break;
			case "Not":
				check(node.expr, currentTable);
				break;
			case "Exists":
				check(node.condition, node.table);
				break;
			default: break;
		}
	};
	check(expr, table);
}
function isPlainObject$1(value) {
	return Object.prototype.toString.call(value) === "[object Object]";
}
function isPolicyExpr(input) {
	return isPlainObject$1(input) && typeof input.type === "string";
}
function isSessionRefValue(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "session-ref" && Array.isArray(input.path);
}
function isSessionWhereCondition(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "session-where" && isPlainObject$1(input.where);
}
function isRowRefValue(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "row-ref" && typeof input.column === "string";
}
function isExistsCondition(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "exists" && typeof input.table === "string" && isPlainObject$1(input.where);
}
function isExistsRelationCondition(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "exists-relation" && isPlainObject$1(input.relation);
}
function isWhereObjectCondition(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "where-object" && isPlainObject$1(input.where);
}
function isCompoundCondition(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "compound" && (input.op === "And" || input.op === "Or") && Array.isArray(input.conditions);
}
function isRecursiveCurrentValue(input) {
	return isPlainObject$1(input) && input.__jazzPermissionKind === "recursive-current";
}
function isUpdateRuleBuilder(input) {
	return isPlainObject$1(input) && typeof input.toRule === "function";
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/drivers/schema-wire.js
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isWasmSchema(value) {
	return isRecord$1(value);
}
var runtimeSchemaCacheKeys = /* @__PURE__ */ new WeakMap();
function normalizeRuntimeSchema(schema) {
	if (schema instanceof Map) return Object.fromEntries(schema.entries());
	if (!isWasmSchema(schema)) throw new Error("Invalid runtime schema value.");
	return schema;
}
/**
* Schemas can contain Uint8Array values (as defaults for bytea columns).
* Since they are not serializable by JSON.stringify, we need to replace them
* with regular arrays.
*/
function runtimeSchemaJsonReplacer(_key, value) {
	if (value instanceof Uint8Array) return Array.from(value);
	return value;
}
function serializeRuntimeSchema(schema, options) {
	const envelope = {
		__jazzRuntimeSchema: 1,
		schema,
		loadedPolicyBundle: options?.loadedPolicyBundle ?? false
	};
	return JSON.stringify(envelope, runtimeSchemaJsonReplacer);
}
function getRuntimeSchemaCacheKey(schema, options) {
	const loadedPolicyBundle = options?.loadedPolicyBundle ?? false;
	let keysByPolicyBundle = runtimeSchemaCacheKeys.get(schema);
	if (!keysByPolicyBundle) {
		keysByPolicyBundle = /* @__PURE__ */ new Map();
		runtimeSchemaCacheKeys.set(schema, keysByPolicyBundle);
	}
	const cached = keysByPolicyBundle.get(loadedPolicyBundle);
	if (cached !== void 0) return cached;
	const key = serializeRuntimeSchema(schema, options);
	keysByPolicyBundle.set(loadedPolicyBundle, key);
	return key;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/sync-transport.js
/**
* Shared sync transport utilities.
*
* Provides auth header helpers, outbox routing, and URL builders used by
* worker-bridge (main-thread ↔ worker postMessage path) and React Native.
* HTTP/SSE transport code has been removed — server sync is now handled
* by the Rust-owned WebSocket transport via `runtime.connect()`.
*/
function isOutboxDestinationKind(value) {
	return value === "server" || value === "client";
}
function isOutboxPayload(value) {
	return typeof value === "string" || value instanceof Uint8Array;
}
function normalizeOutboxCallbackArgs(args) {
	if (isOutboxDestinationKind(args[0])) {
		const payload = args[2];
		if (!isOutboxPayload(payload)) return null;
		return {
			destinationKind: args[0],
			payload,
			isCatalogue: Boolean(args[3]),
			sequence: typeof args[4] === "number" ? args[4] : null
		};
	}
	if (isOutboxDestinationKind(args[1])) {
		const payload = args[3];
		if (!isOutboxPayload(payload)) return null;
		return {
			destinationKind: args[1],
			payload,
			isCatalogue: Boolean(args[4]),
			sequence: typeof args[5] === "number" ? args[5] : null
		};
	}
	if (Array.isArray(args[1]) && isOutboxDestinationKind(args[1][0])) {
		const payload = args[1][2];
		if (!isOutboxPayload(payload)) return null;
		return {
			destinationKind: args[1][0],
			payload,
			isCatalogue: Boolean(args[1][3]),
			sequence: typeof args[1][4] === "number" ? args[1][4] : null
		};
	}
	return null;
}
/**
* Create a shared runtime outbox router for server/client destinations.
*/
function createSyncOutboxRouter(options) {
	const logPrefix = options.logPrefix ?? "";
	return (...args) => {
		const normalized = normalizeOutboxCallbackArgs(args);
		if (!normalized) {
			console.error(`${logPrefix}Invalid sync outbox callback arguments`, args);
			return;
		}
		const { destinationKind, payload, isCatalogue, sequence } = normalized;
		if (destinationKind === "client") {
			options.onClientPayload?.(payload, sequence);
			return;
		}
		Promise.resolve(options.onServerPayload(payload, isCatalogue, sequence)).catch((error) => {
			if (options.onServerPayloadError) {
				options.onServerPayloadError(error);
				return;
			}
			console.error(`${logPrefix}Sync POST error:`, error);
		});
	};
}
/**
* Apply end-user auth headers. Sets `Authorization: Bearer <token>` when a JWT is available.
*/
function applyUserAuthHeaders(headers, auth) {
	if (auth.jwtToken) headers["Authorization"] = `Bearer ${auth.jwtToken}`;
}
var ANONYMOUS_JWT_ISSUER = "urn:jazz:anonymous";
function trimOptional(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function asNonEmptyString(value) {
	return typeof value === "string" ? trimOptional(value) : void 0;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function maybeBuffer() {
	return globalThis.Buffer;
}
function base64UrlToBase64(input) {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const padding = normalized.length % 4;
	if (padding === 0) return normalized;
	return normalized + "=".repeat(4 - padding);
}
function decodeBase64ToUtf8(base64) {
	const buffer = maybeBuffer();
	if (buffer) try {
		return buffer.from(base64, "base64").toString("utf8");
	} catch {
		return null;
	}
	if (typeof atob === "function") try {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
	return null;
}
function parseJwtPayload(jwtToken) {
	const token = trimOptional(jwtToken);
	if (!token) return null;
	const parts = token.split(".");
	if (parts.length < 2) return null;
	const payloadPart = parts[1];
	if (payloadPart === void 0) return null;
	const payloadJson = decodeBase64ToUtf8(base64UrlToBase64(payloadPart));
	if (!payloadJson) return null;
	try {
		const parsed = JSON.parse(payloadJson);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function sessionFromJwtPayload(payload) {
	const subject = asNonEmptyString(payload.sub);
	if (!subject) return null;
	const issuer = asNonEmptyString(payload.iss);
	const claimsSource = payload.claims;
	const claims = isRecord(claimsSource) ? { ...claimsSource } : {};
	claims.subject = subject;
	if (issuer) claims.issuer = issuer;
	let authMode;
	if (issuer === "urn:jazz:local-first") authMode = "local-first";
	else if (issuer === "urn:jazz:anonymous") authMode = "anonymous";
	else authMode = "external";
	return {
		user_id: subject,
		claims,
		authMode
	};
}
function resolveJwtSession(jwtToken) {
	const payload = parseJwtPayload(jwtToken);
	if (!payload) return null;
	return sessionFromJwtPayload(payload);
}
/**
* Resolve the client session state that will be used for permission checks.
*
* Resolves the JWT bearer token to a session, or returns no session.
*/
function resolveClientSessionStateSync(config) {
	const jwtSession = resolveJwtSession(config.jwtToken ?? "");
	if (jwtSession) return {
		transport: "bearer",
		session: jwtSession
	};
	if (config.cookieSession) return {
		transport: "cookie",
		session: config.cookieSession
	};
	return {
		transport: null,
		session: null
	};
}
function resolveClientSessionSync(config) {
	return resolveClientSessionStateSync(config).session;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/auth-state.js
function mapAuthReason(reason) {
	const lower = reason.toLowerCase();
	if (lower.includes("expired")) return "expired";
	if (lower.includes("missing")) return "missing";
	if (lower.includes("disabled")) return "disabled";
	return "invalid";
}
function authStateEquals(a, b) {
	if (a.authMode !== b.authMode || a.error !== b.error) return false;
	const as = a.session;
	const bs = b.session;
	if (as === bs) return true;
	if (!as || !bs) return false;
	if (as.user_id !== bs.user_id || as.authMode !== bs.authMode) return false;
	return JSON.stringify(as.claims) === JSON.stringify(bs.claims);
}
function deriveAuthMode(input) {
	return resolveClientSessionStateSync(input).session?.authMode ?? "external";
}
function deriveInitialState(input) {
	const resolved = resolveClientSessionStateSync(input);
	return {
		authMode: resolved.session?.authMode ?? "external",
		session: resolved.session
	};
}
function createAuthStateStore(input, options) {
	const initialAuthMode = deriveAuthMode(input);
	let state = options?.initialState ?? deriveInitialState(input);
	const listeners = /* @__PURE__ */ new Set();
	const emit = () => {
		for (const listener of listeners) listener(state);
	};
	return {
		getState() {
			return state;
		},
		onChange(listener) {
			listeners.add(listener);
			listener(state);
			return () => {
				listeners.delete(listener);
			};
		},
		markUnauthenticated(reason) {
			const nextState = {
				authMode: initialAuthMode,
				session: state.session,
				error: reason
			};
			if (authStateEquals(state, nextState)) return state;
			state = nextState;
			emit();
			return state;
		},
		applyJwtToken(jwtToken) {
			if (options?.lockAuthenticatedState) return state;
			const resolved = resolveClientSessionStateSync({
				appId: input.appId,
				jwtToken,
				cookieSession: input.cookieSession
			});
			if ((state.session?.user_id ?? null) !== (resolved.session?.user_id ?? null)) throw new Error("Changing auth principal on a live client is not supported. Recreate the Db.");
			const nextState = {
				authMode: initialAuthMode,
				session: resolved.session
			};
			if (authStateEquals(state, nextState)) return state;
			state = nextState;
			emit();
			return state;
		},
		applyCookieSession(cookieSession) {
			if (options?.lockAuthenticatedState) return state;
			const resolved = resolveClientSessionStateSync({
				appId: input.appId,
				jwtToken: input.jwtToken,
				cookieSession
			});
			if ((state.session?.user_id ?? null) !== (resolved.session?.user_id ?? null)) throw new Error("Changing auth principal on a live client is not supported. Recreate the Db.");
			const nextState = {
				authMode: initialAuthMode,
				session: resolved.session
			};
			if (authStateEquals(state, nextState)) return state;
			state = nextState;
			emit();
			return state;
		}
	};
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/query-builder-shape.js
var INTERNAL_REQUIRE_INCLUDES_KEY = "__jazz_requireIncludes";
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeConditions(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((condition) => isPlainObject(condition) && typeof condition.column === "string" && typeof condition.op === "string");
}
function normalizeOrderBy(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && (entry[1] === "asc" || entry[1] === "desc"));
}
function normalizeSelect(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((column) => typeof column === "string");
}
function normalizeGather(value) {
	const maxDepth = isPlainObject(value) && typeof value.max_depth === "number" ? value.max_depth : NaN;
	if (!isPlainObject(value) || !Number.isInteger(maxDepth) || maxDepth <= 0 || typeof value.step_table !== "string" || typeof value.step_current_column !== "string") return;
	return {
		...isPlainObject(value) && value.seed ? { seed: normalizeBuiltRelation(value.seed) } : {},
		max_depth: maxDepth,
		step_table: value.step_table,
		step_current_column: value.step_current_column,
		step_conditions: normalizeConditions(value.step_conditions),
		step_hops: Array.isArray(value.step_hops) ? value.step_hops.filter((hop) => typeof hop === "string") : []
	};
}
function normalizeBuiltRelation(value) {
	if (!isPlainObject(value)) return {};
	const normalized = {
		...typeof value.table === "string" && value.table.length > 0 ? { table: value.table } : {},
		conditions: normalizeConditions(value.conditions),
		hops: Array.isArray(value.hops) ? value.hops.filter((hop) => typeof hop === "string") : [],
		gather: normalizeGather(value.gather)
	};
	if (isPlainObject(value.union) && Array.isArray(value.union.inputs)) normalized.union = { inputs: value.union.inputs.map((input) => normalizeBuiltRelation(input)) };
	return normalized;
}
function createEmptyIncludeEntry() {
	return {
		conditions: [],
		includes: {},
		requireIncludes: false,
		select: [],
		orderBy: [],
		hops: []
	};
}
function normalizeShorthandIncludeEntries(raw) {
	const nested = { ...raw };
	delete nested[INTERNAL_REQUIRE_INCLUDES_KEY];
	return normalizeIncludeEntries(nested);
}
function isBuiltQueryShape(value) {
	return "table" in value && "conditions" in value && "includes" in value && "orderBy" in value;
}
function isNormalizedIncludeEntryShape(value) {
	return "conditions" in value && "includes" in value && "select" in value && "orderBy" in value;
}
function normalizeIncludeEntry(raw) {
	if (raw === true) return createEmptyIncludeEntry();
	if (!isPlainObject(raw)) return null;
	if (isBuiltQueryShape(raw)) {
		const normalized = normalizeBuiltQuery(raw, "");
		return {
			table: normalized.table || void 0,
			conditions: normalized.conditions,
			includes: normalized.includes,
			requireIncludes: normalized.requireIncludes,
			select: normalized.select,
			orderBy: normalized.orderBy,
			limit: normalized.limit,
			offset: normalized.offset,
			hops: normalized.hops,
			gather: normalized.gather
		};
	}
	if (isNormalizedIncludeEntryShape(raw)) return {
		table: typeof raw.table === "string" ? raw.table : void 0,
		conditions: normalizeConditions(raw.conditions),
		includes: normalizeIncludeEntries(raw.includes),
		requireIncludes: raw[INTERNAL_REQUIRE_INCLUDES_KEY] === true,
		select: normalizeSelect(raw.select),
		orderBy: normalizeOrderBy(raw.orderBy),
		limit: typeof raw.limit === "number" ? raw.limit : void 0,
		offset: typeof raw.offset === "number" ? raw.offset : void 0,
		hops: Array.isArray(raw.hops) ? raw.hops.filter((hop) => typeof hop === "string") : [],
		gather: normalizeGather(raw.gather)
	};
	const entry = createEmptyIncludeEntry();
	entry.requireIncludes = raw[INTERNAL_REQUIRE_INCLUDES_KEY] === true;
	entry.includes = normalizeShorthandIncludeEntries(raw);
	return entry;
}
function normalizeIncludeEntries(raw) {
	if (!isPlainObject(raw)) return {};
	const includes = {};
	for (const [relationName, spec] of Object.entries(raw)) {
		if (!spec) continue;
		const normalized = normalizeIncludeEntry(spec);
		if (normalized) includes[relationName] = normalized;
	}
	return includes;
}
function normalizeBuiltQuery(raw, fallbackTable) {
	const value = isPlainObject(raw) ? raw : {};
	return {
		table: typeof value.table === "string" && value.table.length > 0 ? value.table : fallbackTable,
		conditions: normalizeConditions(value.conditions),
		includes: normalizeIncludeEntries(value.includes),
		requireIncludes: value[INTERNAL_REQUIRE_INCLUDES_KEY] === true,
		select: normalizeSelect(value.select),
		orderBy: normalizeOrderBy(value.orderBy),
		limit: typeof value.limit === "number" ? value.limit : void 0,
		offset: typeof value.offset === "number" ? value.offset : void 0,
		hops: Array.isArray(value.hops) ? value.hops.filter((hop) => typeof hop === "string") : [],
		gather: normalizeGather(value.gather)
	};
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/select-projection.js
var HIDDEN_INCLUDE_COLUMN_PREFIX = "__jazz_include_";
function hiddenIncludeColumnName(relationName) {
	return `${HIDDEN_INCLUDE_COLUMN_PREFIX}${relationName}`;
}
function isHiddenIncludeColumnName(columnName) {
	return columnName.startsWith(HIDDEN_INCLUDE_COLUMN_PREFIX);
}
function resolveSelectedColumns(tableName, schema, projection) {
	const table = schema[tableName];
	if (!table) throw new Error(`Unknown table "${tableName}" in schema`);
	if (!projection || projection.length === 0) return table.columns.map((column) => column.name);
	const schemaColumnNames = new Set(table.columns.map((column) => column.name));
	const selection = {
		explicitColumnsInSchema: /* @__PURE__ */ new Set(),
		explicitColumnsNotInSchema: /* @__PURE__ */ new Set(),
		hasWildcard: false
	};
	for (const column of projection) {
		if (column === "*") {
			selection.hasWildcard = true;
			continue;
		}
		if (column === "id") continue;
		if (schemaColumnNames.has(column)) selection.explicitColumnsInSchema.add(column);
		else selection.explicitColumnsNotInSchema.add(column);
	}
	if (!selection.hasWildcard) return [...selection.explicitColumnsInSchema, ...selection.explicitColumnsNotInSchema];
	if (selection.explicitColumnsNotInSchema.size === 0) return [...schemaColumnNames];
	return [...schemaColumnNames, ...selection.explicitColumnsNotInSchema];
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/query-adapter.js
/**
* Translate QueryBuilder JSON to WASM Query format.
*
* QueryBuilder produces a compact JSON structure:
* { table, conditions, includes, orderBy, limit, offset, hops?, gather? }
*
* Runtime semantics are driven by `relation_ir`. The wire payload keeps only
* fields required for execution (`table`, `relation_ir`, and `array_subqueries`).
*/
function relColumn(column, scope) {
	return scope ? {
		scope,
		column
	} : { column };
}
function relationColumnsForTable(table, scope, schema) {
	const tableSchema = schema[table];
	if (!tableSchema) throw new Error(`Unknown table "${table}" in relation projection.`);
	return [{
		alias: "id",
		expr: { Column: relColumn("id", scope) }
	}, ...tableSchema.columns.map((column) => ({
		alias: column.name,
		expr: { Column: relColumn(column.name, scope) }
	}))];
}
function getColumnType(schema, table, column) {
	if (column === "id") return { type: "Uuid" };
	const magicType = magicColumnType(column);
	if (magicType) return magicType;
	const tableSchema = schema[table];
	if (!tableSchema) return void 0;
	return tableSchema.columns.find((c) => c.name === column)?.column_type;
}
function stripQualifier(column) {
	const parts = column.split(".");
	return parts[parts.length - 1] ?? column;
}
function toTimestampMs(value) {
	if (value instanceof Date) {
		const ts = value.getTime();
		if (!Number.isFinite(ts)) throw new Error("Invalid Date value for timestamp condition");
		return ts;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Invalid number value for timestamp condition");
		return value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
			const fromNumber = Number(trimmed);
			if (Number.isFinite(fromNumber)) return fromNumber;
		}
		const fromIso = Date.parse(trimmed);
		if (Number.isFinite(fromIso)) return fromIso;
	}
	throw new Error("Invalid timestamp condition. Expected Date, ISO string, or finite number.");
}
function toRuntimeTimestampValue(value, columnName) {
	const timestampMs = toTimestampMs(value);
	return columnName && isProvenanceMagicTimestampColumn(columnName) ? timestampMs * 1e3 : timestampMs;
}
/**
* Translate a JavaScript value to WasmValue format.
*/
function toWasmValue(value, columnType, columnName) {
	if (value === null || value === void 0) return { type: "Null" };
	if (columnType.type === "Json") return {
		type: "Text",
		value: toJsonText(value)
	};
	if (columnType.type === "Timestamp" && value instanceof Date) return {
		type: "Timestamp",
		value: toRuntimeTimestampValue(value, columnName)
	};
	if (columnType.type === "Bytea") {
		if (value instanceof Uint8Array) return {
			type: "Bytea",
			value: [...value]
		};
		if (Array.isArray(value)) return {
			type: "Bytea",
			value: value.map((entry) => {
				const n = Number(entry);
				if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Bytea values must contain integers in range 0..255");
				return n;
			})
		};
		throw new Error("Bytea values must be Uint8Array or byte arrays");
	}
	if (Array.isArray(value)) {
		if (columnType.type !== "Array") throw new Error("Unexpected array value for scalar column");
		return {
			type: "Array",
			value: value.map((item) => toWasmValue(item, columnType.element))
		};
	}
	if (typeof value === "boolean") return {
		type: "Boolean",
		value
	};
	if (typeof value === "number") {
		if (columnType?.type === "Timestamp") return {
			type: "Timestamp",
			value: toRuntimeTimestampValue(value, columnName)
		};
		return {
			type: "Integer",
			value
		};
	}
	if (typeof value === "string") {
		if (columnType?.type === "Timestamp") return {
			type: "Timestamp",
			value: toRuntimeTimestampValue(value, columnName)
		};
		if (columnType?.type === "Uuid") return {
			type: "Uuid",
			value
		};
		if (columnType?.type === "Enum" && !columnType.variants.includes(value)) throw new Error(`Invalid enum value "${value}". Expected one of: ${columnType.variants.join(", ")}`);
		return {
			type: "Text",
			value
		};
	}
	throw new Error(`Unsupported value type: ${typeof value}`);
}
function includeRequirementForRelation(relation, requireIncludes) {
	if (!requireIncludes || relation.type !== "forward" || relation.nullable) return;
	return relation.isArray ? "MatchCorrelationCardinality" : "AtLeastOne";
}
function visibleSelectColumns(resolvedSelect, includeProjectionColumns = []) {
	const columns = [...resolvedSelect, ...includeProjectionColumns];
	return columns.length > 0 ? columns : null;
}
function validateIncludeBuilderSpec(relation, spec, relationName) {
	if (spec.table && spec.table !== relation.toTable) throw new Error(`Include builder for relation "${relationName}" must target table "${relation.toTable}", got "${spec.table}".`);
	if (typeof spec.offset === "number" && spec.offset !== 0) throw new Error(`Include builder for relation "${relationName}" does not support offset().`);
	if (spec.hops.length > 0) throw new Error(`Include builder for relation "${relationName}" does not support hopTo(...).`);
	if (spec.gather) throw new Error(`Include builder for relation "${relationName}" does not support gather(...).`);
}
function conditionToArraySubqueryFilter(cond, schema, table) {
	const column = stripQualifier(cond.column);
	const columnType = getColumnType(schema, table, column);
	if (!columnType) throw new Error(`Unknown column "${column}" in table "${table}"`);
	if (columnType.type === "Bytea" && [
		"gt",
		"gte",
		"lt",
		"lte"
	].includes(cond.op)) throw new Error(`BYTEA column "${column}" only supports eq/ne operators.`);
	if (columnType.type === "Bytea" && cond.op === "contains") throw new Error(`BYTEA column "${column}" does not support contains filters.`);
	if (columnType.type === "Json" && [
		"gt",
		"gte",
		"lt",
		"lte",
		"contains"
	].includes(cond.op)) throw new Error(`JSON column "${column}" only supports eq/ne/in/isNull operators.`);
	const valueTypeForCondition = cond.op === "contains" && columnType.type === "Array" ? columnType.element : columnType;
	const literalValue = toWasmValue(cond.value, valueTypeForCondition, column);
	const isNullValue = cond.value === void 0 ? true : cond.value;
	switch (cond.op) {
		case "eq":
			if (cond.value === null) return { IsNull: { column } };
			return { Eq: {
				column,
				value: literalValue
			} };
		case "ne":
			if (cond.value === null) return { IsNotNull: { column } };
			return { Ne: {
				column,
				value: literalValue
			} };
		case "gt": return { Gt: {
			column,
			value: literalValue
		} };
		case "gte": return { Ge: {
			column,
			value: literalValue
		} };
		case "lt": return { Lt: {
			column,
			value: literalValue
		} };
		case "lte": return { Le: {
			column,
			value: literalValue
		} };
		case "isNull":
			if (typeof isNullValue !== "boolean") throw new Error("\"isNull\" operator requires a boolean value.");
			return isNullValue ? { IsNull: { column } } : { IsNotNull: { column } };
		case "contains": return { Contains: {
			column,
			value: literalValue
		} };
		default: throw new Error(`Include builder for table "${table}" does not support "${cond.op}" filters.`);
	}
}
function toArraySubqueries(includes, tableName, relations, schema, options) {
	const tableRels = relations.get(tableName) || [];
	const subqueries = [];
	const hideCurrentLevelColumnNames = options?.hideCurrentLevelColumnNames === true;
	const requireCurrentLevelIncludes = options?.requireIncludes === true;
	for (const [relName, spec] of Object.entries(includes)) {
		const rel = tableRels.find((r) => r.name === relName);
		if (!rel) throw new Error(`Unknown relation "${relName}" on table "${tableName}"`);
		validateIncludeBuilderSpec(rel, spec, relName);
		const hasExplicitSelect = spec.select.length > 0;
		const resolvedSelectColumns = hasExplicitSelect ? resolveSelectedColumns(rel.toTable, schema, spec.select) : [];
		const includeProjectionColumns = hasExplicitSelect ? Object.keys(spec.includes).map((relationName) => hiddenIncludeColumnName(relationName)) : [];
		const filters = spec.conditions.map((condition) => conditionToArraySubqueryFilter(condition, schema, rel.toTable));
		const orderBy = spec.orderBy.map(([column, direction]) => [stripQualifier(column), direction === "desc" ? "Descending" : "Ascending"]);
		const nestedArrays = toArraySubqueries(spec.includes, rel.toTable, relations, schema, {
			hideCurrentLevelColumnNames: hasExplicitSelect,
			requireIncludes: spec.requireIncludes
		});
		const selectColumns = visibleSelectColumns(resolvedSelectColumns, includeProjectionColumns);
		if (rel.type === "forward") {
			const requirement = includeRequirementForRelation(rel, requireCurrentLevelIncludes);
			subqueries.push({
				column_name: hideCurrentLevelColumnNames ? hiddenIncludeColumnName(relName) : relName,
				table: rel.toTable,
				inner_column: "id",
				outer_column: `${tableName}.${rel.fromColumn}`,
				filters,
				joins: [],
				select_columns: selectColumns,
				order_by: orderBy,
				limit: spec.limit ?? null,
				...requirement ? { requirement } : {},
				nested_arrays: nestedArrays
			});
		} else subqueries.push({
			column_name: hideCurrentLevelColumnNames ? hiddenIncludeColumnName(relName) : relName,
			table: rel.toTable,
			inner_column: rel.toColumn,
			outer_column: `${tableName}.id`,
			filters,
			joins: [],
			select_columns: selectColumns,
			order_by: orderBy,
			limit: spec.limit ?? null,
			nested_arrays: nestedArrays
		});
	}
	return subqueries;
}
function conditionToRelPredicate(cond, schema, table, scope) {
	const columnRef = relColumn(stripQualifier(cond.column), scope);
	const column = stripQualifier(cond.column);
	const columnType = getColumnType(schema, table, column);
	if (!columnType) throw new Error(`Unknown column "${column}" in table "${table}"`);
	const valueTypeForCondition = cond.op === "contains" && columnType.type === "Array" ? columnType.element : columnType;
	const rightLiteral = isFrontierRowIdToken(cond.value) && cond.op === "eq" ? { RowId: "Frontier" } : { Literal: toWasmValue(cond.value, valueTypeForCondition, column) };
	const isNullValue = cond.value === void 0 ? true : cond.value;
	if (columnType.type === "Bytea" && [
		"gt",
		"gte",
		"lt",
		"lte"
	].includes(cond.op)) throw new Error(`BYTEA column "${column}" only supports eq/ne operators.`);
	if (columnType.type === "Bytea" && cond.op === "contains") throw new Error(`BYTEA column "${column}" does not support contains filters.`);
	if (columnType.type === "Json" && [
		"gt",
		"gte",
		"lt",
		"lte",
		"contains"
	].includes(cond.op)) throw new Error(`JSON column "${column}" only supports eq/ne/in/isNull operators.`);
	switch (cond.op) {
		case "eq":
			if (cond.value === null) return { IsNull: { column: columnRef } };
			return { Cmp: {
				left: columnRef,
				op: "Eq",
				right: rightLiteral
			} };
		case "ne":
			if (cond.value === null) return { IsNotNull: { column: columnRef } };
			return { Cmp: {
				left: columnRef,
				op: "Ne",
				right: rightLiteral
			} };
		case "gt": return { Cmp: {
			left: columnRef,
			op: "Gt",
			right: rightLiteral
		} };
		case "gte": return { Cmp: {
			left: columnRef,
			op: "Ge",
			right: rightLiteral
		} };
		case "lt": return { Cmp: {
			left: columnRef,
			op: "Lt",
			right: rightLiteral
		} };
		case "lte": return { Cmp: {
			left: columnRef,
			op: "Le",
			right: rightLiteral
		} };
		case "isNull":
			if (typeof isNullValue !== "boolean") throw new Error("\"isNull\" operator requires a boolean value.");
			return isNullValue ? { IsNull: { column: columnRef } } : { IsNotNull: { column: columnRef } };
		case "contains": return { Contains: {
			left: columnRef,
			right: rightLiteral
		} };
		case "in":
			if (!Array.isArray(cond.value)) throw new Error("\"in\" operator requires an array value");
			return { In: {
				left: columnRef,
				values: cond.value.map((value) => ({ Literal: toWasmValue(value, columnType, column) }))
			} };
		default: throw new Error(`Unknown operator: ${cond.op}`);
	}
}
function isFrontierRowIdToken(value) {
	if (typeof value !== "object" || value === null) return false;
	return value.__jazz_ir_frontier_row_id === true;
}
function conditionsToRelPredicate(conditions, schema, table, scope) {
	if (conditions.length === 0) return "True";
	if (conditions.length === 1) return conditionToRelPredicate(conditions[0], schema, table, scope);
	return { And: conditions.map((condition) => conditionToRelPredicate(condition, schema, table, scope)) };
}
function applyFilter(input, predicate) {
	if (predicate === "True") return input;
	return { Filter: {
		input,
		predicate
	} };
}
function lowerHopsToRelExpr(input, seedTable, hops, relations, schema) {
	if (hops.length === 0) return input;
	let currentExpr = input;
	let currentTable = seedTable;
	let currentScope = seedTable;
	for (let i = 0; i < hops.length; i += 1) {
		const hopName = hops[i];
		const relation = (relations.get(currentTable) ?? []).find((candidate) => candidate.name === hopName);
		if (!relation) throw new Error(`Unknown relation "${hopName}" on table "${currentTable}"`);
		const hopAlias = `__hop_${i}`;
		const joinOn = relation.type === "forward" ? {
			left: relColumn(relation.fromColumn, currentScope),
			right: relColumn("id", hopAlias)
		} : {
			left: relColumn("id", currentScope),
			right: relColumn(relation.toColumn, hopAlias)
		};
		currentExpr = { Join: {
			left: currentExpr,
			right: { TableScan: { table: relation.toTable } },
			on: [joinOn],
			join_kind: "Inner"
		} };
		currentTable = relation.toTable;
		currentScope = hopAlias;
	}
	return { Project: {
		input: currentExpr,
		columns: relationColumnsForTable(currentTable, currentScope, schema)
	} };
}
function gatherToRelExpr(gather, seedTable, seedExpr, relations, schema) {
	if (!schema[gather.step_table]) throw new Error(`Unknown gather step table "${gather.step_table}"`);
	if (!Number.isInteger(gather.max_depth) || gather.max_depth <= 0) throw new Error("gather(...) max_depth must be a positive integer.");
	const stepHops = Array.isArray(gather.step_hops) ? gather.step_hops.filter((hop) => typeof hop === "string") : [];
	if (stepHops.length !== 1) throw new Error("gather(...) currently requires exactly one hopTo(...) step.");
	const stepRelations = relations.get(gather.step_table) ?? [];
	const hopName = stepHops[0];
	const hopRelation = stepRelations.find((rel) => rel.name === hopName);
	if (!hopRelation) throw new Error(`Unknown relation "${hopName}" on table "${gather.step_table}"`);
	if (hopRelation.type !== "forward") throw new Error("gather(...) currently only supports forward hopTo(...) relations.");
	if (hopRelation.toTable !== seedTable) throw new Error(`gather(...) step must hop back to "${seedTable}" rows, got "${hopRelation.toTable}".`);
	const stepBase = { TableScan: { table: gather.step_table } };
	const stepConditions = Array.isArray(gather.step_conditions) ? gather.step_conditions : [];
	const stepScope = gather.step_table;
	const stepFiltered = applyFilter(stepBase, conditionsToRelPredicate([...stepConditions, {
		column: stripQualifier(gather.step_current_column),
		op: "eq",
		value: { __jazz_ir_frontier_row_id: true }
	}], schema, gather.step_table, stepScope));
	const recursiveHopAlias = "__recursive_hop_0";
	return { Gather: {
		seed: seedExpr,
		step: { Project: {
			input: { Join: {
				left: stepFiltered,
				right: { TableScan: { table: hopRelation.toTable } },
				on: [{
					left: relColumn(hopRelation.fromColumn, gather.step_table),
					right: relColumn("id", recursiveHopAlias)
				}],
				join_kind: "Inner"
			} },
			columns: relationColumnsForTable(seedTable, recursiveHopAlias, schema)
		} },
		frontier_key: { RowId: "Current" },
		max_depth: gather.max_depth,
		dedupe_key: [{ RowId: "Current" }]
	} };
}
function resolveHopsOutputTable(seedTable, hops, relations) {
	let currentTable = seedTable;
	for (const hopName of hops) {
		const relation = (relations.get(currentTable) ?? []).find((candidate) => candidate.name === hopName);
		if (!relation) throw new Error(`Unknown relation "${hopName}" on table "${currentTable}"`);
		currentTable = relation.toTable;
	}
	return currentTable;
}
function translateBuiltRelationToRelExpr(relation, relations, schema) {
	if (relation.union) {
		const inputs = relation.union.inputs.map((input) => translateBuiltRelationToRelExpr(input, relations, schema));
		const first = inputs[0];
		if (!first) throw new Error("union(...) requires at least one seed relation.");
		if (inputs.some((input) => input.outputTable !== first.outputTable)) throw new Error("union(...) requires all seed relations to output the same table.");
		return {
			expr: { Union: { inputs: inputs.map((input) => input.expr) } },
			outputTable: first.outputTable
		};
	}
	if (!relation.table) throw new Error("gather(...) seed relation is missing table metadata.");
	let expr = { TableScan: { table: relation.table } };
	expr = applyFilter(expr, conditionsToRelPredicate(relation.conditions ?? [], schema, relation.table, relation.table));
	let outputTable = relation.table;
	if (relation.gather) {
		const seed = relation.gather.seed ? translateBuiltRelationToRelExpr(relation.gather.seed, relations, schema) : {
			expr,
			outputTable
		};
		expr = gatherToRelExpr(relation.gather, seed.outputTable, seed.expr, relations, schema);
		outputTable = seed.outputTable;
	}
	const hops = relation.hops ?? [];
	expr = lowerHopsToRelExpr(expr, outputTable, hops, relations, schema);
	outputTable = resolveHopsOutputTable(outputTable, hops, relations);
	return {
		expr,
		outputTable
	};
}
/**
* Translate QueryBuilder JSON to relation IR.
*
* This emits the canonical compositional form:
* - hopTo => Join + Project
* - gather => Gather with step Join + Project
*/
function translateBuilderToRelationIr(builderJson, schema) {
	const builder = normalizeBuiltQuery(JSON.parse(builderJson), "");
	const relations = analyzeRelations(schema);
	const hops = builder.hops;
	if (builder.gather && Object.keys(builder.includes).length > 0) throw new Error("gather(...) does not yet support include(...).");
	if (hops.length > 0 && Object.keys(builder.includes).length > 0) throw new Error("hopTo(...) does not yet support include(...).");
	let relation;
	let relationTable;
	if (builder.gather?.seed) {
		const seed = translateBuiltRelationToRelExpr(builder.gather.seed, relations, schema);
		relation = gatherToRelExpr(builder.gather, seed.outputTable, seed.expr, relations, schema);
		relationTable = seed.outputTable;
		relation = applyFilter(relation, conditionsToRelPredicate(builder.conditions, schema, relationTable, relationTable));
		relation = lowerHopsToRelExpr(relation, relationTable, hops, relations, schema);
		relationTable = resolveHopsOutputTable(relationTable, hops, relations);
	} else {
		const translated = translateBuiltRelationToRelExpr({
			table: builder.table,
			conditions: builder.conditions,
			hops: builder.hops,
			gather: builder.gather
		}, relations, schema);
		relation = translated.expr;
		relationTable = translated.outputTable;
	}
	if (Array.isArray(builder.orderBy) && builder.orderBy.length > 0) {
		for (const [column] of builder.orderBy) {
			const columnType = getColumnType(schema, relationTable, stripQualifier(column));
			if (columnType?.type === "Bytea") throw new Error(`BYTEA column "${column}" cannot be used in orderBy().`);
			if (columnType?.type === "Json") throw new Error(`JSON column "${column}" cannot be used in orderBy().`);
		}
		relation = { OrderBy: {
			input: relation,
			terms: builder.orderBy.map(([column, direction]) => ({
				column: relColumn(column),
				direction: direction === "desc" ? "Desc" : "Asc"
			}))
		} };
	}
	if (typeof builder.offset === "number" && builder.offset > 0) relation = { Offset: {
		input: relation,
		offset: builder.offset
	} };
	if (typeof builder.limit === "number") relation = { Limit: {
		input: relation,
		limit: builder.limit
	} };
	return relation;
}
/**
* Translate QueryBuilder JSON to WASM Query JSON.
*
* @param builderJson JSON string from QueryBuilder._build()
* @param schema WasmSchema for relation analysis
* @returns JSON string for WASM runtime query()
*/
function translateQuery(builderJson, schema) {
	const builder = normalizeBuiltQuery(JSON.parse(builderJson), "");
	const relations = analyzeRelations(schema);
	const relation = translateBuilderToRelationIr(builderJson, schema);
	const hasExplicitSelect = builder.select.length > 0;
	const projectedColumns = visibleSelectColumns(hasExplicitSelect ? resolveSelectedColumns(builder.table, schema, builder.select) : [], hasExplicitSelect ? Object.keys(builder.includes).map((relationName) => hiddenIncludeColumnName(relationName)) : []);
	const query = {
		table: builder.table,
		array_subqueries: toArraySubqueries(builder.includes, builder.table, relations, schema, {
			hideCurrentLevelColumnNames: hasExplicitSelect,
			requireIncludes: builder.requireIncludes
		}),
		relation_ir: relation,
		...projectedColumns ? { select_columns: projectedColumns } : {}
	};
	return JSON.stringify(query);
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/runtime-config.js
function isHttpUrl(moduleUrl) {
	const protocol = new URL(moduleUrl).protocol;
	return protocol === "http:" || protocol === "https:";
}
function isBundledPageContext(locationHref) {
	const protocol = new URL(locationHref).protocol;
	return protocol === "http:" || protocol === "https:" || protocol === "blob:";
}
function resolveBrowserAssetBase(locationHref) {
	return new URL("/", locationHref).href;
}
function resolveConfiguredUrl(url, locationHref) {
	try {
		return new URL(url).href;
	} catch {}
	if (locationHref) try {
		return new URL(url, locationHref).href;
	} catch {}
	return url;
}
function resolveConfiguredBaseUrl(baseUrl, locationHref) {
	if (!locationHref) return null;
	return new URL(baseUrl, locationHref).href;
}
function resolveDerivedWasmUrl(runtimeModuleUrl, locationHref, allowHttpPageFallback) {
	if (!locationHref || isHttpUrl(runtimeModuleUrl) || !allowHttpPageFallback && isBundledPageContext(locationHref)) return null;
	return new URL("jazz_wasm_bg.wasm", resolveBrowserAssetBase(locationHref)).href;
}
function resolveRuntimeConfigSyncInitInput(runtime) {
	if (runtime?.wasmModule) return { module: runtime.wasmModule };
	if (runtime?.wasmSource) return { module: runtime.wasmSource };
	return null;
}
function resolveRuntimeConfigWasmUrl(runtimeModuleUrl, locationHref, runtime) {
	if (runtime?.wasmUrl) return resolveConfiguredUrl(runtime.wasmUrl, locationHref);
	if (runtime?.baseUrl) {
		const baseUrl = resolveConfiguredBaseUrl(runtime.baseUrl, locationHref);
		if (baseUrl) return new URL("jazz_wasm_bg.wasm", baseUrl).href;
	}
	return resolveDerivedWasmUrl(runtimeModuleUrl, locationHref, false);
}
function resolveWorkerBootstrapWasmUrl(runtimeModuleUrl, locationHref, runtime) {
	if (runtime?.wasmUrl) return resolveConfiguredUrl(runtime.wasmUrl, locationHref);
	if (runtime?.baseUrl) {
		const baseUrl = resolveConfiguredBaseUrl(runtime.baseUrl, locationHref);
		if (baseUrl) return new URL("jazz_wasm_bg.wasm", baseUrl).href;
	}
	return resolveDerivedWasmUrl(runtimeModuleUrl, locationHref, true);
}
function resolveRuntimeConfigWorkerUrl(runtimeModuleUrl, locationHref, runtime) {
	if (runtime?.workerUrl) return resolveConfiguredUrl(runtime.workerUrl, locationHref);
	if (runtime?.baseUrl) {
		const baseUrl = resolveConfiguredBaseUrl(runtime.baseUrl, locationHref);
		if (baseUrl) return new URL("worker/jazz-worker.js", baseUrl).href;
	}
	if (!locationHref || isHttpUrl(runtimeModuleUrl)) return new URL("../worker/jazz-worker.js", runtimeModuleUrl).href;
	return new URL("worker/jazz-worker.js", resolveBrowserAssetBase(locationHref)).href;
}
function appendWorkerRuntimeWasmUrl(workerUrl, wasmUrl) {
	if (!wasmUrl) return workerUrl;
	const url = new URL(workerUrl);
	url.searchParams.set("jazz-wasm-url", wasmUrl);
	return url.href;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/url.js
/**
* Build an app-scoped URL under `/apps/<appId>`.
*
* Preserves any base path already present in `serverUrl`, trims surrounding
* whitespace, rejects query/hash fragments, and accepts path inputs with or
* without a leading slash.
*/
function appScopedUrl(serverUrl, appId, path) {
	const base = normalizeServerUrlBase(serverUrl);
	const normalizedPath = path.trim().replace(/^\/+/, "");
	const appBase = `${base}/apps/${encodeURIComponent(appId)}`;
	return normalizedPath ? `${appBase}/${normalizedPath}` : appBase;
}
/**
* Convert an HTTP(S) server URL to the WebSocket `/ws` endpoint URL.
*
* Mirrors the Rust `http_url_to_ws` helper in `crates/jazz-tools/src/client.rs`.
*
* - `http://host`, `xyz` → `ws://host/apps/xyz/ws`
* - `https://host`, `xyz` → `wss://host/apps/xyz/ws`
* - `ws://host`, `xyz` → `ws://host/apps/xyz/ws`
* - `ws://host/ws`, `xyz` → `ws://host/apps/xyz/ws`
*/
function httpUrlToWs(serverUrl, appId) {
	const parsed = parseServerUrl(serverUrl);
	if (parsed.protocol === "http:") {
		parsed.protocol = "ws:";
		return appScopedUrl(parsed.toString(), appId, "ws");
	}
	if (parsed.protocol === "https:") {
		parsed.protocol = "wss:";
		return appScopedUrl(parsed.toString(), appId, "ws");
	}
	parsed.pathname = parsed.pathname.replace(/\/ws\/?$/, "");
	return appScopedUrl(parsed.toString(), appId, "ws");
}
var ALLOWED_SERVER_URL_PROTOCOLS = new Set([
	"http:",
	"https:",
	"ws:",
	"wss:"
]);
function normalizeServerUrlBase(serverUrl) {
	const parsed = parseServerUrl(serverUrl);
	parsed.pathname = parsed.pathname.replace(/\/+$/, "");
	return parsed.toString().replace(/\/+$/, "");
}
function parseServerUrl(serverUrl) {
	let parsed;
	try {
		parsed = new URL(serverUrl.trim());
	} catch {
		throw invalidServerUrl(serverUrl);
	}
	if (!ALLOWED_SERVER_URL_PROTOCOLS.has(parsed.protocol)) throw invalidServerUrl(serverUrl);
	if (parsed.search || parsed.hash) throw new Error(`Invalid server URL "${serverUrl}": must not include query parameters or a hash fragment`);
	return parsed;
}
function invalidServerUrl(serverUrl) {
	return /* @__PURE__ */ new Error(`Invalid server URL "${serverUrl}": expected http://, https://, ws://, or wss://`);
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/client.js
/**
* JazzClient - High-level TypeScript client for Jazz.
*
* Wraps the WASM runtime and provides a clean API for CRUD operations,
* subscriptions, and sync.
*/
function resolveDefaultDurabilityTier(context) {
	if (context.defaultDurabilityTier) return context.defaultDurabilityTier;
	if (isBrowserRuntime()) return "local";
	return context.serverUrl ? "edge" : "local";
}
function resolveEffectiveQueryExecutionOptions(context, options) {
	return {
		tier: options?.tier ?? resolveDefaultDurabilityTier(context),
		localUpdates: options?.localUpdates ?? "immediate",
		propagation: options?.propagation ?? "full",
		visibility: options?.visibility ?? "public"
	};
}
function resolveQueryJson(query) {
	if (typeof query === "string") return query;
	const builtQuery = query._build();
	const schema = query._schema;
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return builtQuery;
	try {
		const parsed = JSON.parse(builtQuery);
		if (parsed && typeof parsed === "object" && "relation_ir" in parsed) return builtQuery;
	} catch {
		return builtQuery;
	}
	return translateQuery(builtQuery, schema);
}
function resolveRelationIrOutputTable(node) {
	if (!node || typeof node !== "object") return null;
	const relation = node;
	if ("TableScan" in relation) {
		const tableScan = relation.TableScan;
		return typeof tableScan?.table === "string" ? tableScan.table : null;
	}
	if ("Filter" in relation) return resolveRelationIrOutputTable(relation.Filter?.input);
	if ("OrderBy" in relation) return resolveRelationIrOutputTable(relation.OrderBy?.input);
	if ("Limit" in relation) return resolveRelationIrOutputTable(relation.Limit?.input);
	if ("Offset" in relation) return resolveRelationIrOutputTable(relation.Offset?.input);
	if ("Project" in relation) return resolveRelationIrOutputTable(relation.Project?.input);
	if ("Gather" in relation) {
		const gather = relation.Gather;
		return resolveRelationIrOutputTable(gather?.seed);
	}
	return null;
}
function parseArraySubqueryPlans(value) {
	if (!Array.isArray(value)) return [];
	const plans = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const plan = entry;
		if (typeof plan.table !== "string") continue;
		plans.push({
			table: plan.table,
			selectColumns: Array.isArray(plan.select_columns) ? plan.select_columns.filter((column) => typeof column === "string") : [],
			nested: parseArraySubqueryPlans(plan.nested_arrays)
		});
	}
	return plans;
}
function resolveQueryAlignmentPlan(queryJson) {
	try {
		const parsed = JSON.parse(queryJson);
		return {
			outputTable: typeof parsed.table === "string" ? parsed.table : resolveRelationIrOutputTable(parsed.relation_ir),
			arraySubqueries: parseArraySubqueryPlans(parsed.array_subqueries),
			selectColumns: Array.isArray(parsed.select_columns) ? parsed.select_columns.filter((column) => typeof column === "string") : []
		};
	} catch {
		return {
			outputTable: null,
			arraySubqueries: [],
			selectColumns: []
		};
	}
}
function resolveNodeTier(tier) {
	if (!tier) return void 0;
	if (Array.isArray(tier)) return tier[0];
	return tier;
}
function isBrowserRuntime() {
	return typeof window !== "undefined" && typeof document !== "undefined";
}
function getScheduler() {
	if ("scheduler" in globalThis) return (task) => {
		globalThis.scheduler.postTask(task, { priority: "user-visible" });
	};
	return (task) => queueMicrotask(task);
}
function encodeQueryExecutionOptions(options) {
	const payload = {};
	if ((options.propagation ?? "full") !== "full") payload.propagation = options.propagation;
	if ((options.localUpdates ?? "immediate") !== "immediate") payload.local_updates = options.localUpdates;
	if (options.transactionOverlay && options.transactionOverlay.rowIds.length > 0) payload.transaction_overlay = {
		batch_id: options.transactionOverlay.batchId,
		branch_name: options.transactionOverlay.branchName,
		row_ids: options.transactionOverlay.rowIds
	};
	if (!payload.propagation && !payload.local_updates && !payload.transaction_overlay) return;
	return JSON.stringify(payload);
}
function readHeader(request, name) {
	const lower = name.toLowerCase();
	const fromMethod = request.header?.(name) ?? request.header?.(lower);
	if (typeof fromMethod === "string") return fromMethod;
	const headers = request.headers;
	if (!headers) return;
	if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name) ?? headers.get(lower) ?? void 0;
	const record = headers;
	const raw = record[name] ?? record[lower];
	if (Array.isArray(raw)) return raw[0];
	return raw;
}
function normalizeSubscriptionCallbackArgs(args) {
	if (args.length === 1) return args[0];
	if (args.length === 2 && args[0] == null) return args[1];
	console.error("Invalid subscription callback arguments", args);
}
function decodeBase64Url(value) {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
	if (typeof atob === "function") return atob(padded);
	if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
	throw new Error("No base64 decoder available in this runtime");
}
function sessionFromRequest(request) {
	const authHeader = readHeader(request, "authorization");
	if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing or invalid Authorization header");
	const parts = authHeader.slice(7).trim().split(".");
	if (parts.length < 2) throw new Error("Invalid JWT format");
	const payloadPart = parts[1];
	if (payloadPart === void 0) throw new Error("Invalid JWT format");
	let payload;
	try {
		payload = JSON.parse(decodeBase64Url(payloadPart));
	} catch {
		throw new Error("Invalid JWT payload");
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid JWT payload");
	const typedPayload = payload;
	if (typeof typedPayload.sub !== "string" || typedPayload.sub.length === 0) throw new Error("JWT payload missing sub");
	const claims = typedPayload.claims && typeof typedPayload.claims === "object" && !Array.isArray(typedPayload.claims) ? typedPayload.claims : {};
	const issuer = typeof typedPayload.iss === "string" ? typedPayload.iss.trim() : void 0;
	let authMode;
	if (issuer === "urn:jazz:local-first") authMode = "local-first";
	else if (issuer === "urn:jazz:anonymous") authMode = "anonymous";
	else authMode = "external";
	return {
		user_id: typedPayload.sub,
		claims,
		authMode
	};
}
function shouldFallbackToUpsertUpdate(error) {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("object already exists") || message.includes("Create failed: Conflict");
}
function composeTargetBranchName(schemaContext) {
	return `${schemaContext.env}-${schemaContext.schema_hash.slice(0, 12)}-${schemaContext.user_branch}`;
}
function generateBatchId() {
	const cryptoObj = globalThis.crypto;
	const bytes = new Uint8Array(16);
	if (cryptoObj && typeof cryptoObj.getRandomValues === "function") cryptoObj.getRandomValues(bytes);
	else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
	const timestamp = Date.now();
	bytes[0] = Math.floor(timestamp / 2 ** 40) & 255;
	bytes[1] = Math.floor(timestamp / 2 ** 32) & 255;
	bytes[2] = Math.floor(timestamp / 2 ** 24) & 255;
	bytes[3] = Math.floor(timestamp / 2 ** 16) & 255;
	bytes[4] = Math.floor(timestamp / 2 ** 8) & 255;
	bytes[5] = timestamp & 255;
	bytes[6] = bytes[6] & 15 | 112;
	bytes[8] = bytes[8] & 63 | 128;
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function normalizeUpdatedAt(updatedAt) {
	if (updatedAt === void 0) return;
	if (!Number.isFinite(updatedAt) || !Number.isInteger(updatedAt) || updatedAt < 0) throw new Error("Invalid updatedAt override. Expected a non-negative integer.");
	return updatedAt;
}
function durabilityTierRank(tier) {
	switch (tier) {
		case "local": return 0;
		case "edge": return 1;
		case "global": return 2;
	}
}
function settlementSatisfiesTier(settlement, tier) {
	if (!settlement) return false;
	if (settlement.kind !== "durableDirect" && settlement.kind !== "acceptedTransaction") return false;
	return durabilityTierRank(settlement.confirmedTier) >= durabilityTierRank(tier);
}
function rejectionFromSettlement(settlement) {
	if (!settlement || settlement.kind !== "rejected") return null;
	return new PersistedWriteRejectedError(settlement.batchId, settlement.code, settlement.reason);
}
/**
* Error returned when a write fails to be persisted at a given durability tier.
*/
var PersistedWriteRejectedError = class extends Error {
	batchId;
	code;
	reason;
	name = "PersistedWriteRejectedError";
	constructor(batchId, code, reason) {
		super(`Persisted batch ${batchId} was rejected (${code}): ${reason}`);
		this.batchId = batchId;
		this.code = code;
		this.reason = reason;
	}
};
/**
* Returned by upsert, update, and delete operations, and explicitly-committed transactions.
* Allows waiting for the write to be persisted at a given durability tier.
*/
var WriteHandle = class {
	batchId;
	#client;
	constructor(batchId, client) {
		this.batchId = batchId;
		this.#client = client;
	}
	/**
	* Wait for the write to be persisted at a given durability tier.
	*
	* Rejects with a {@link PersistedWriteRejectedError} if the write is rejected.
	*/
	async wait(options) {
		return this.#client.waitForPersistedBatch(this.batchId, options.tier);
	}
	client() {
		return this.#client;
	}
};
/**
* Returned by insert operations and auto-committed transactions.
* Allows getting the inserted value and waiting for the write
* to be persisted at a given durability tier.
*/
var WriteResult = class WriteResult extends WriteHandle {
	value;
	constructor(value, batchId, client) {
		super(batchId, client);
		this.value = value;
	}
	/**
	* Wait for the write to be persisted at a given durability tier.
	*
	* Rejects with a {@link PersistedWriteRejectedError} if the write is rejected.
	* @returns the inserted row.
	*/
	async wait(options) {
		await super.wait(options);
		return this.value;
	}
	mapValue(transformValue) {
		return new WriteResult(transformValue(this.value), this.batchId, this.client());
	}
};
function isPromiseLike(value) {
	return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}
function runInBatch(batchOrTx, callback, client) {
	const value = callback(batchOrTx);
	const resultClient = typeof client === "function" ? client : () => client;
	if (isPromiseLike(value)) return value.then((resolvedValue) => {
		return new WriteResult(resolvedValue, batchOrTx.commit().batchId, resultClient());
	});
	return new WriteResult(value, batchOrTx.commit().batchId, resultClient());
}
var Transaction = class {
	client;
	batchContext;
	session;
	attribution;
	committedHandle = null;
	touchedRowIds = /* @__PURE__ */ new Set();
	constructor(client, batchContext, session, attribution) {
		this.client = client;
		this.batchContext = batchContext;
		this.session = session;
		this.attribution = attribution;
	}
	get committed() {
		return this.committedHandle !== null;
	}
	ensureActive() {
		if (this.committed) throw new Error(`Transaction ${this.batchContext.batchId} is already committed`);
	}
	markTouchedRow(rowId) {
		this.touchedRowIds.add(rowId);
	}
	queryOptions(options) {
		return {
			...options,
			localUpdates: "deferred",
			transactionOverlay: {
				batchId: this.batchContext.batchId,
				branchName: this.batchContext.targetBranchName,
				rowIds: [...this.touchedRowIds]
			}
		};
	}
	batchId() {
		return this.batchContext.batchId;
	}
	commit() {
		if (this.committedHandle) return this.committedHandle;
		const handle = this.client.sealBatch(this.batchId());
		this.committedHandle = handle;
		return handle;
	}
	create(table, values, options) {
		this.ensureActive();
		const row = this.client.createInternal(table, values, this.session, this.attribution, options, this.batchContext);
		this.markTouchedRow(row.id);
		return row;
	}
	upsert(table, values, options) {
		this.ensureActive();
		this.client.upsertInternal(table, values, options.id, this.session, this.attribution, options.updatedAt, this.batchContext);
		this.markTouchedRow(options.id);
	}
	update(objectId, updates) {
		this.ensureActive();
		this.client.updateInternal(objectId, updates, this.session, this.attribution, this.batchContext);
		this.markTouchedRow(objectId);
	}
	delete(objectId) {
		this.ensureActive();
		this.client.deleteInternal(objectId, this.session, this.attribution, this.batchContext);
		this.markTouchedRow(objectId);
	}
	async query(query, options) {
		this.ensureActive();
		return this.client.queryInternal(query, this.session, this.queryOptions(options));
	}
	localBatchRecord(batchId = this.batchId()) {
		return this.client.localBatchRecord(batchId);
	}
	localBatchRecords() {
		return this.client.localBatchRecords();
	}
	acknowledgeRejectedBatch(batchId = this.batchId()) {
		return this.client.acknowledgeRejectedBatch(batchId);
	}
};
var DirectBatch = class {
	client;
	batchContext;
	session;
	attribution;
	committedHandle = null;
	constructor(client, batchContext, session, attribution) {
		this.client = client;
		this.batchContext = batchContext;
		this.session = session;
		this.attribution = attribution;
	}
	batchId() {
		return this.batchContext.batchId;
	}
	ensureActive() {
		if (this.committedHandle) throw new Error(`Direct batch ${this.batchContext.batchId} is already committed`);
	}
	commit() {
		if (this.committedHandle) return this.committedHandle;
		const handle = this.client.sealBatch(this.batchId());
		this.committedHandle = handle;
		return handle;
	}
	create(table, values, options) {
		this.ensureActive();
		return this.client.createInternal(table, values, this.session, this.attribution, options, this.batchContext);
	}
	upsert(table, values, options) {
		this.ensureActive();
		this.client.upsertInternal(table, values, options.id, this.session, this.attribution, options.updatedAt, this.batchContext);
	}
	update(objectId, updates) {
		this.ensureActive();
		this.client.updateInternal(objectId, updates, this.session, this.attribution, this.batchContext);
	}
	delete(objectId) {
		this.ensureActive();
		this.client.deleteInternal(objectId, this.session, this.attribution, this.batchContext);
	}
	localBatchRecord(batchId = this.batchId()) {
		return this.client.localBatchRecord(batchId);
	}
	localBatchRecords() {
		return this.client.localBatchRecords();
	}
	acknowledgeRejectedBatch(batchId = this.batchId()) {
		return this.client.acknowledgeRejectedBatch(batchId);
	}
};
/**
* Session-scoped client for backend operations.
*
* Created by `JazzClient.forSession()`. Allows backend applications
* to perform operations as a specific user via header-based authentication.
*/
var SessionClient = class {
	client;
	session;
	constructor(client, session) {
		this.client = client;
		this.session = session;
	}
	/**
	* Create a new row as this session's user.
	*/
	async create(table, values, options) {
		if (!this.client.getServerUrl()) throw new Error("No server connection");
		const response = await this.client.sendRequest(this.client.getRequestUrl("/sync/object"), "POST", {
			table,
			values,
			schema_context: this.client.getSchemaContext(),
			...options?.id ? { object_id: options.id } : {},
			...options?.updatedAt !== void 0 ? { updated_at: normalizeUpdatedAt(options.updatedAt) } : {}
		}, this.session);
		if (!response.ok) throw new Error(`Create failed: ${response.statusText}`);
		return (await response.json()).object_id;
	}
	/**
	* Create or update a row as this session's user using a caller-supplied id.
	*/
	async upsert(table, values, options) {
		try {
			await this.create(table, values, options);
			return;
		} catch (error) {
			if (!shouldFallbackToUpsertUpdate(error)) throw error;
		}
		await this.update(options.id, values, { updatedAt: options.updatedAt });
	}
	/**
	* Update a row as this session's user.
	*/
	async update(objectId, updates, options) {
		if (!this.client.getServerUrl()) throw new Error("No server connection");
		const updateArray = Object.entries(updates);
		const response = await this.client.sendRequest(this.client.getRequestUrl("/sync/object"), "PUT", {
			object_id: objectId,
			updates: updateArray,
			schema_context: this.client.getSchemaContext(),
			...options?.updatedAt !== void 0 ? { updated_at: normalizeUpdatedAt(options.updatedAt) } : {}
		}, this.session);
		if (!response.ok) throw new Error(`Update failed: ${response.statusText}`);
	}
	/**
	* Delete a row as this session's user.
	*/
	async delete(objectId) {
		if (!this.client.getServerUrl()) throw new Error("No server connection");
		const response = await this.client.sendRequest(this.client.getRequestUrl("/sync/object/delete"), "POST", {
			object_id: objectId,
			schema_context: this.client.getSchemaContext()
		}, this.session);
		if (!response.ok) throw new Error(`Delete failed: ${response.statusText}`);
	}
	/**
	* Query as this session's user.
	*/
	async query(query, options) {
		return this.client.queryInternal(query, this.session, options);
	}
	/**
	* Subscribe to a query as this session's user.
	*/
	subscribe(query, callback, options) {
		return this.client.subscribeInternal(query, callback, this.session, options);
	}
	beginTransaction() {
		return this.client.beginTransactionInternal(this.session);
	}
	transaction(callback) {
		return runInBatch(this.beginTransaction(), callback, this.client);
	}
	beginBatch() {
		return this.client.beginBatchInternal(this.session);
	}
	batch(callback) {
		return runInBatch(this.beginBatch(), callback, this.client);
	}
	localBatchRecord(batchId) {
		return this.client.localBatchRecord(batchId);
	}
	localBatchRecords() {
		return this.client.localBatchRecords();
	}
	acknowledgeRejectedBatch(batchId) {
		return this.client.acknowledgeRejectedBatch(batchId);
	}
};
/**
* High-level Jazz client.
*/
var JazzClient = class JazzClient {
	runtime;
	scheduler;
	context;
	resolvedSession;
	defaultDurabilityTier;
	/**
	* Promises created with {@link DirectBatch.wait} or {@TODO_link WriteHandle.wait}
	* that are waiting for a batch to be settled.
	*/
	pendingBatchWaiters = /* @__PURE__ */ new Map();
	/**
	* Listeners attached with {@link JazzClient.onMutationError} that are notified when a batch is rejected.
	*/
	mutationErrorListeners = /* @__PURE__ */ new Set();
	acknowledgedRejectedBatchErrors = /* @__PURE__ */ new Map();
	pendingBatchWaitPollTimer = null;
	shutdownPromise = null;
	cachedRuntimeSchemaHash = null;
	cachedRuntimeSchema = null;
	resolveSessionFromContext() {
		return resolveClientSessionStateSync({
			appId: this.context.appId,
			jwtToken: this.context.jwtToken,
			cookieSession: this.context.cookieSession
		}).session;
	}
	buildTransportAuthPayload() {
		const payload = { jwt_token: this.context.jwtToken ?? null };
		if (this.context.adminSecret) payload.admin_secret = this.context.adminSecret;
		if (this.context.backendSecret) payload.backend_secret = this.context.backendSecret;
		return payload;
	}
	returnsDeclaredSchemaRows() {
		return this.runtime.returnsDeclaredSchemaRows === true;
	}
	constructor(runtime, context, defaultDurabilityTier, runtimeOptions) {
		this.runtime = this.wrapRuntime(runtime);
		this.scheduler = getScheduler();
		this.context = context;
		this.defaultDurabilityTier = defaultDurabilityTier;
		this.resolvedSession = this.resolveSessionFromContext();
		if (runtimeOptions?.onAuthFailure) {
			const handler = runtimeOptions.onAuthFailure;
			this.runtime.onAuthFailure?.((reason) => {
				handler(mapAuthReason(reason));
			});
		}
	}
	wrapRuntime(runtime) {
		return new Proxy(runtime, { get: (target, property, receiver) => {
			const value = Reflect.get(target, property, receiver);
			if (property === "onSyncMessageReceived" && typeof value === "function") return (payload, seq) => {
				const batchesWithPendingWaiters = new Set(this.pendingBatchWaiters.keys());
				value.call(target, payload, seq);
				this.flushPendingBatchWaiters();
				this.flushUnhandledMutationErrors(this.drainRejectedBatchIds(), batchesWithPendingWaiters);
			};
			if (typeof value === "function") return value.bind(target);
			return value;
		} });
	}
	/**
	* Connect to Jazz with the given context.
	*
	* @param context Application context with driver and schema
	* @returns Connected JazzClient instance
	*/
	static async connect(context, runtimeOptions) {
		const wasmModule = await loadWasmModule(context.runtimeSources);
		const schemaJson = serializeRuntimeSchema(context.schema);
		return new JazzClient(new wasmModule.WasmRuntime(schemaJson, context.appId, context.env ?? "dev", context.userBranch ?? "main", resolveNodeTier(context.tier)), context, resolveDefaultDurabilityTier(context), runtimeOptions);
	}
	/**
	* Create client synchronously with a pre-loaded WASM module.
	*
	* Use this after loading WASM via `loadWasmModule()` to avoid
	* async client creation. This enables sync mutations in the Db class.
	*
	* @param wasmModule Pre-loaded WASM module from loadWasmModule()
	* @param context Application context with driver and schema
	* @returns Connected JazzClient instance (created synchronously)
	*/
	static connectSync(wasmModule, context, runtimeOptions) {
		const schemaJson = serializeRuntimeSchema(context.schema);
		return new JazzClient(new wasmModule.WasmRuntime(schemaJson, context.appId, context.env ?? "dev", context.userBranch ?? "main", resolveNodeTier(context.tier), runtimeOptions?.useBinaryEncoding ?? false), context, resolveDefaultDurabilityTier(context), runtimeOptions);
	}
	/**
	* Create client from a pre-constructed runtime (e.g., NapiRuntime).
	*
	* This allows server-side apps to use the native NAPI backend directly
	* without WASM loading.
	*
	* @param runtime A runtime implementing the Runtime interface
	* @param context Application context
	* @returns Connected JazzClient instance
	*/
	static connectWithRuntime(runtime, context, runtimeOptions) {
		return new JazzClient(runtime, context, resolveDefaultDurabilityTier(context), runtimeOptions);
	}
	/**
	* Create a session-scoped client for backend operations.
	*
	* This allows backend applications to perform operations as a specific user.
	* Requires `backendSecret` to be configured in the `AppContext`.
	*
	* @param session Session to impersonate
	* @returns SessionClient for performing operations as the given user
	* @throws Error if backendSecret is not configured
	*
	* @example
	* ```typescript
	* const userSession = { user_id: "user-123", claims: {} };
	* const userClient = client.forSession(userSession);
	* const id = await userClient.create("todos", {
	*   title: { type: "Text", value: "Buy milk" },
	*   done: { type: "Boolean", value: false },
	* });
	* ```
	*/
	forSession(session) {
		if (!this.context.backendSecret) throw new Error("backendSecret required for session impersonation");
		if (!this.context.serverUrl) throw new Error("serverUrl required for session impersonation");
		return new SessionClient(this, session);
	}
	/**
	* Create a session-scoped client from an authenticated HTTP request.
	*
	* Extracts `Authorization: Bearer <jwt>` and maps payload fields:
	* - `sub` -> `session.user_id`
	* - `claims` -> `session.claims` (defaults to `{}`)
	*
	* This helper only extracts payload fields and does not validate JWT signatures.
	* JWT verification should happen in your auth middleware before request handling.
	*/
	forRequest(request) {
		return this.forSession(sessionFromRequest(request));
	}
	beginTransaction() {
		return this.beginTransactionInternal();
	}
	transaction(callback) {
		return runInBatch(this.beginTransaction(), callback, this);
	}
	beginBatch() {
		return this.beginBatchInternal();
	}
	batch(callback) {
		return runInBatch(this.beginBatch(), callback, this);
	}
	createBatchContext(batchMode) {
		return {
			batchMode,
			batchId: generateBatchId(),
			targetBranchName: composeTargetBranchName(this.getSchemaContext())
		};
	}
	beginTransactionInternal(session, attribution) {
		return new Transaction(this, this.createBatchContext("transactional"), this.resolveWriteSession(session, attribution), attribution);
	}
	beginBatchInternal(session, attribution) {
		return new DirectBatch(this, this.createBatchContext("direct"), this.resolveWriteSession(session, attribution), attribution);
	}
	localBatchRecord(batchId) {
		return this.requireBatchRecordMethod("loadLocalBatchRecord")(batchId);
	}
	localBatchRecords() {
		return [...this.requireBatchRecordMethod("loadLocalBatchRecords")()].sort((left, right) => left.batchId.localeCompare(right.batchId));
	}
	onMutationError(listener) {
		this.mutationErrorListeners.add(listener);
		this.flushUnhandledMutationErrors();
		return () => {
			this.mutationErrorListeners.delete(listener);
		};
	}
	acknowledgeRejectedBatchInternal(batchId) {
		const rejection = rejectionFromSettlement(this.localBatchRecord(batchId)?.latestSettlement);
		const acknowledged = this.requireBatchRecordMethod("acknowledgeRejectedBatch")(batchId);
		if (acknowledged && rejection) this.acknowledgedRejectedBatchErrors.set(batchId, rejection);
		return acknowledged;
	}
	acknowledgeRejectedBatch(batchId) {
		const acknowledged = this.acknowledgeRejectedBatchInternal(batchId);
		this.flushPendingBatchWaiters();
		return acknowledged;
	}
	sealBatch(batchId) {
		this.requireBatchRecordMethod("sealBatch")(batchId);
		return new WriteHandle(batchId, this);
	}
	/**
	* Enable backend-scoped sync auth for this client.
	*
	* In backend mode, sync/event transport uses `X-Jazz-Backend-Secret` instead
	* of end-user auth headers and intentionally does not send admin headers.
	*/
	asBackend() {
		if (!this.context.backendSecret) throw new Error("backendSecret required for backend mode");
		if (!this.context.serverUrl) throw new Error("serverUrl required for backend mode");
		return this;
	}
	updateAuthToken(jwtToken) {
		this.context.jwtToken = jwtToken;
		this.resolvedSession = this.resolveSessionFromContext();
		this.runtime.updateAuth?.(JSON.stringify(this.buildTransportAuthPayload()));
	}
	updateCookieSession(cookieSession) {
		this.context.cookieSession = cookieSession;
		this.resolvedSession = this.resolveSessionFromContext();
		this.runtime.updateAuth?.(JSON.stringify(this.buildTransportAuthPayload()));
	}
	normalizeQueryExecutionOptions(options) {
		const resolved = resolveEffectiveQueryExecutionOptions({
			...this.context,
			defaultDurabilityTier: this.defaultDurabilityTier
		}, options);
		if (!options?.transactionOverlay) return resolved;
		return {
			...resolved,
			transactionOverlay: options.transactionOverlay
		};
	}
	encodeWriteContext(session, attribution, batchContext, updatedAt) {
		if (!session && attribution === void 0 && !batchContext && updatedAt === void 0) return;
		if (attribution === void 0 && session && !batchContext && updatedAt === void 0) return JSON.stringify(session);
		const payload = {};
		if (session) payload.session = session;
		if (attribution !== void 0) payload.attribution = attribution;
		if (updatedAt !== void 0) payload.updated_at = normalizeUpdatedAt(updatedAt);
		if (batchContext) {
			payload.batch_mode = batchContext.batchMode;
			payload.batch_id = batchContext.batchId;
			payload.target_branch_name = batchContext.targetBranchName;
		}
		return JSON.stringify(payload);
	}
	resolveWriteSession(session, attribution) {
		if (session) return session;
		if (attribution !== void 0) return;
		return this.resolvedSession ?? void 0;
	}
	requireSessionWriteMethod(method) {
		const runtimeMethod = this.runtime[method];
		if (!runtimeMethod) throw new Error(`${String(method)} is not supported by this runtime`);
		return runtimeMethod.bind(this.runtime);
	}
	requireBatchRecordMethod(method) {
		const runtimeMethod = this.runtime[method];
		if (!runtimeMethod) throw new Error(`${String(method)} is not supported by this runtime`);
		return runtimeMethod.bind(this.runtime);
	}
	alignRowValuesToDeclaredSchema(table, values, runtimeSchema, arraySubqueries = [], selectColumns = []) {
		if (this.returnsDeclaredSchemaRows()) return values;
		const effectiveRuntimeSchema = runtimeSchema ?? this.getSchema();
		const declaredTable = this.context.schema[table];
		const runtimeTable = effectiveRuntimeSchema[table];
		if (!declaredTable || !runtimeTable) return values;
		const projectedVisibleColumnCount = selectColumns.length > 0 ? resolveSelectedColumns(table, this.context.schema, selectColumns).filter((columnName) => !isHiddenIncludeColumnName(columnName)).length : 0;
		if (projectedVisibleColumnCount > 0) {
			if (values.length < projectedVisibleColumnCount) return values;
			const projectedValues = values.slice(0, projectedVisibleColumnCount);
			const trailingValues = values.slice(projectedVisibleColumnCount);
			if (arraySubqueries.length === 0) return projectedValues.concat(trailingValues);
			const alignedTrailingValues = trailingValues.map((value, index) => {
				const plan = arraySubqueries[index];
				if (!plan) return value;
				return this.alignIncludedValueToDeclaredSchema(value, plan, effectiveRuntimeSchema);
			});
			return projectedValues.concat(alignedTrailingValues);
		}
		if (values.length < runtimeTable.columns.length) return values;
		const valuesByColumn = /* @__PURE__ */ new Map();
		for (let index = 0; index < runtimeTable.columns.length; index += 1) {
			const column = runtimeTable.columns[index];
			if (!column) return values;
			const value = values[index];
			if (value === void 0) return values;
			valuesByColumn.set(column.name, value);
		}
		const reorderedValues = [];
		for (const column of declaredTable.columns) {
			const value = valuesByColumn.get(column.name);
			if (value === void 0) return values;
			reorderedValues.push(value);
		}
		const trailingValues = values.slice(runtimeTable.columns.length);
		if (arraySubqueries.length === 0) return reorderedValues.concat(trailingValues);
		const alignedTrailingValues = trailingValues.map((value, index) => {
			const plan = arraySubqueries[index];
			if (!plan) return value;
			return this.alignIncludedValueToDeclaredSchema(value, plan, effectiveRuntimeSchema);
		});
		return reorderedValues.concat(alignedTrailingValues);
	}
	alignIncludedValueToDeclaredSchema(value, plan, runtimeSchema) {
		if (this.returnsDeclaredSchemaRows()) return value;
		const effectiveRuntimeSchema = runtimeSchema ?? this.getSchema();
		if (value.type !== "Array") return value;
		return {
			...value,
			value: value.value.map((entry) => {
				if (entry.type !== "Row") return entry;
				return {
					...entry,
					value: {
						...entry.value,
						values: this.alignRowValuesToDeclaredSchema(plan.table, entry.value.values, effectiveRuntimeSchema, plan.nested, plan.selectColumns)
					}
				};
			})
		};
	}
	alignQueryRowsToDeclaredSchema(queryJson, rows, runtimeSchema) {
		if (this.returnsDeclaredSchemaRows()) return rows;
		const effectiveRuntimeSchema = runtimeSchema ?? this.getSchema();
		const { outputTable, arraySubqueries, selectColumns } = resolveQueryAlignmentPlan(queryJson);
		if (!outputTable) return rows;
		return rows.map((row) => ({
			...row,
			values: this.alignRowValuesToDeclaredSchema(outputTable, row.values, effectiveRuntimeSchema, arraySubqueries, selectColumns)
		}));
	}
	alignSubscriptionDeltaToDeclaredSchema(queryJson, delta, runtimeSchema) {
		if (this.returnsDeclaredSchemaRows()) return delta;
		const effectiveRuntimeSchema = runtimeSchema ?? this.getSchema();
		const { outputTable, arraySubqueries, selectColumns } = resolveQueryAlignmentPlan(queryJson);
		if (!outputTable || !Array.isArray(delta)) return delta;
		return delta.map((change) => {
			if ((change.kind === 0 || change.kind === 2) && change.row) return {
				...change,
				row: {
					...change.row,
					values: this.alignRowValuesToDeclaredSchema(outputTable, change.row.values, effectiveRuntimeSchema, arraySubqueries, selectColumns)
				}
			};
			return change;
		});
	}
	/**
	* Insert a new row into a table without waiting for durability.
	*/
	create(table, values, options) {
		return this.createHandleInternal(table, values, void 0, void 0, options);
	}
	createHandleInternal(table, values, session, attribution, options, batchContext) {
		const row = this.createInternal(table, values, session, attribution, options, batchContext);
		if (!batchContext) this.sealBatch(row.batchId);
		return new WriteResult(row, row.batchId, this);
	}
	/**
	* Create or update a row with a caller-supplied id without waiting for durability.
	*/
	upsert(table, values, options) {
		return this.upsertHandleInternal(table, values, options.id, void 0, void 0, options.updatedAt);
	}
	upsertHandleInternal(table, values, objectId, session, attribution, updatedAt, batchContext) {
		const result = this.upsertInternal(table, values, objectId, session, attribution, updatedAt, batchContext);
		if (!batchContext) this.sealBatch(result.batchId);
		return new WriteHandle(result.batchId, this);
	}
	/**
	* Insert a new row into a table with an optional session for policy checks.
	* @internal
	*/
	createInternal(table, values, session, attribution, options, batchContext) {
		const effectiveSession = this.resolveWriteSession(session, attribution);
		const row = effectiveSession || attribution !== void 0 || batchContext || options?.updatedAt !== void 0 ? options?.id ? this.requireSessionWriteMethod("insertWithSession")(table, values, this.encodeWriteContext(effectiveSession, attribution, batchContext, options.updatedAt), options.id) : this.requireSessionWriteMethod("insertWithSession")(table, values, this.encodeWriteContext(effectiveSession, attribution, batchContext, options?.updatedAt)) : options?.id ? this.runtime.insert(table, values, options.id) : this.runtime.insert(table, values);
		return {
			...row,
			values: this.alignRowValuesToDeclaredSchema(table, row.values, this.context.schema)
		};
	}
	/**
	* Create or update a row with a caller-supplied id, optionally scoped to a session.
	* @internal
	*/
	upsertInternal(table, values, objectId, session, attribution, updatedAt, batchContext) {
		try {
			return { batchId: this.createInternal(table, values, session, attribution, {
				id: objectId,
				updatedAt
			}, batchContext).batchId };
		} catch (error) {
			if (!shouldFallbackToUpsertUpdate(error)) throw error;
		}
		return this.updateInternal(objectId, values, session, attribution, batchContext, updatedAt);
	}
	/**
	* Execute a query and return all matching rows.
	*
	* @param query Query builder or JSON-encoded query specification
	* @param options Optional read durability options
	* @returns Array of matching rows
	*/
	async query(query, options) {
		return this.queryInternal(query, this.resolvedSession ?? void 0, options);
	}
	/**
	* Internal query with optional session and read durability options.
	* @internal
	*/
	async queryInternal(query, session, options, runtimeSchema) {
		const normalizedOptions = this.normalizeQueryExecutionOptions(options);
		const queryJson = resolveQueryJson(query);
		const sessionJson = session ? JSON.stringify(session) : void 0;
		const optionsJson = encodeQueryExecutionOptions(normalizedOptions);
		const effectiveRuntimeSchema = runtimeSchema ?? (this.returnsDeclaredSchemaRows() ? void 0 : this.getSchema());
		const results = await this.runtime.query(queryJson, sessionJson, normalizedOptions.tier, optionsJson);
		return this.alignQueryRowsToDeclaredSchema(queryJson, results, effectiveRuntimeSchema);
	}
	/**
	* Update a row by ID without waiting for durability.
	*/
	update(objectId, updates, options) {
		return this.updateHandleInternal(objectId, updates, void 0, void 0, void 0, options?.updatedAt);
	}
	updateHandleInternal(objectId, updates, session, attribution, batchContext, updatedAt) {
		const result = this.updateInternal(objectId, updates, session, attribution, batchContext, updatedAt);
		if (!batchContext) this.sealBatch(result.batchId);
		return new WriteHandle(result.batchId, this);
	}
	/**
	* Update a row by ID without waiting for durability, optionally scoped to a session.
	* @internal
	*/
	updateInternal(objectId, updates, session, attribution, batchContext, updatedAt) {
		const effectiveSession = this.resolveWriteSession(session, attribution);
		if (effectiveSession || attribution !== void 0 || batchContext || updatedAt !== void 0) return this.requireSessionWriteMethod("updateWithSession")(objectId, updates, this.encodeWriteContext(effectiveSession, attribution, batchContext, updatedAt));
		return this.runtime.update(objectId, updates);
	}
	/**
	* Delete a row by ID without waiting for durability.
	*/
	delete(objectId) {
		return this.deleteHandleInternal(objectId);
	}
	deleteHandleInternal(objectId, session, attribution, batchContext, updatedAt) {
		const result = this.deleteInternal(objectId, session, attribution, batchContext, updatedAt);
		if (!batchContext) this.sealBatch(result.batchId);
		return new WriteHandle(result.batchId, this);
	}
	/**
	* Delete a row by ID without waiting for durability, optionally scoped to a session.
	* @internal
	*/
	deleteInternal(objectId, session, attribution, batchContext, updatedAt) {
		const effectiveSession = this.resolveWriteSession(session, attribution);
		if (effectiveSession || attribution !== void 0 || batchContext || updatedAt !== void 0) return this.requireSessionWriteMethod("deleteWithSession")(objectId, this.encodeWriteContext(effectiveSession, attribution, batchContext, updatedAt));
		return this.runtime.delete(objectId);
	}
	/**
	* Subscribe to a query and receive updates when results change.
	*
	* @param query Query builder or JSON-encoded query specification
	* @param callback Called with delta whenever results change
	* @param options Optional read durability options
	* @returns Subscription ID for unsubscribing
	*/
	subscribe(query, callback, options) {
		return this.subscribeInternal(query, callback, this.resolvedSession ?? void 0, options, void 0);
	}
	/**
	* Internal subscribe with optional session and read durability options.
	*
	* Uses the runtime's 2-phase subscribe API: `createSubscription` allocates
	* a handle synchronously (zero work), then `executeSubscription` is deferred
	* via the scheduler so compilation + first tick run outside the caller's
	* synchronous stack (e.g. outside a React render).
	*
	* @internal
	*/
	subscribeInternal(query, callback, session, options, runtimeSchema) {
		const normalizedOptions = this.normalizeQueryExecutionOptions(options);
		const sessionJson = session ? JSON.stringify(session) : void 0;
		const queryJson = resolveQueryJson(query);
		const optionsJson = encodeQueryExecutionOptions(normalizedOptions);
		const effectiveRuntimeSchema = runtimeSchema ?? (this.returnsDeclaredSchemaRows() ? void 0 : this.getSchema());
		const handle = this.runtime.createSubscription(queryJson, sessionJson, normalizedOptions.tier, optionsJson);
		this.scheduler(() => {
			this.runtime.executeSubscription(handle, (...args) => {
				const deltaJsonOrObject = normalizeSubscriptionCallbackArgs(args);
				if (deltaJsonOrObject === void 0) return;
				const delta = typeof deltaJsonOrObject === "string" ? JSON.parse(deltaJsonOrObject) : deltaJsonOrObject;
				callback(this.alignSubscriptionDeltaToDeclaredSchema(queryJson, delta, effectiveRuntimeSchema));
			});
		});
		return handle;
	}
	/**
	* Unsubscribe from a query.
	*
	* @param subscriptionId ID returned from subscribe()
	*/
	unsubscribe(subscriptionId) {
		this.runtime.unsubscribe(subscriptionId);
	}
	/**
	* Connect to a Jazz server over WebSocket using the Rust transport layer.
	*
	* Accepts an HTTP/HTTPS server URL (e.g. "http://localhost:4000") and
	* converts it to the corresponding WebSocket `/ws` endpoint URL before
	* passing it to the underlying Rust runtime's `connect()`.  Already-WS URLs
	* are passed through unchanged.
	*
	* @param url  Server URL — http(s):// or ws(s)://. `/apps/<appId>/ws` is appended automatically.
	* @param auth Authentication credentials for the connection.
	*/
	connectTransport(url, auth) {
		if (!this.runtime.connect) throw new Error("Underlying runtime does not support connect()");
		this.runtime.connect(httpUrlToWs(url, this.context.appId), JSON.stringify(auth));
	}
	/**
	* Disconnect from the Jazz server and drop the Rust transport handle.
	*
	* No-op if the underlying runtime does not support disconnect().
	*/
	disconnectTransport() {
		this.runtime.disconnect?.();
	}
	/**
	* Get the current schema.
	*/
	getSchema() {
		const schemaHash = this.runtime.getSchemaHash();
		if (this.cachedRuntimeSchemaHash === schemaHash && this.cachedRuntimeSchema) return this.cachedRuntimeSchema;
		const schema = normalizeRuntimeSchema(this.runtime.getSchema());
		this.cachedRuntimeSchemaHash = schemaHash;
		this.cachedRuntimeSchema = schema;
		return schema;
	}
	/**
	* Get the underlying runtime (for WorkerBridge).
	* @internal
	*/
	getRuntime() {
		return this.runtime;
	}
	/**
	* Get the server URL (for SessionClient).
	* @internal
	*/
	getServerUrl() {
		return this.context.serverUrl;
	}
	/**
	* Build a fully-qualified endpoint URL against the configured server.
	* @internal
	*/
	getRequestUrl(path) {
		if (!this.context.serverUrl) throw new Error("No server connection");
		return appScopedUrl(this.context.serverUrl, this.context.appId, path);
	}
	/**
	* Get schema context for server requests.
	* @internal
	*/
	getSchemaContext() {
		return {
			env: this.context.env ?? "dev",
			schema_hash: this.runtime.getSchemaHash(),
			user_branch: this.context.userBranch ?? "main"
		};
	}
	/**
	* Send an HTTP request with appropriate auth headers.
	* @internal
	*/
	async sendRequest(url, method, body, session) {
		const headers = { "Content-Type": "application/json" };
		if (session && this.context.backendSecret) {
			headers["X-Jazz-Backend-Secret"] = this.context.backendSecret;
			headers["X-Jazz-Session"] = btoa(JSON.stringify(session));
		} else applyUserAuthHeaders(headers, { jwtToken: this.context.jwtToken });
		return fetch(url, {
			method,
			headers,
			body: JSON.stringify(body)
		});
	}
	batchWaitOutcome(batchId, tier) {
		const acknowledgedRejection = this.acknowledgedRejectedBatchErrors.get(batchId);
		if (acknowledgedRejection) return {
			settled: true,
			error: acknowledgedRejection
		};
		const settlement = this.localBatchRecord(batchId)?.latestSettlement;
		const rejection = rejectionFromSettlement(settlement);
		if (rejection) return {
			settled: true,
			error: rejection
		};
		if (settlementSatisfiesTier(settlement, tier)) return {
			settled: true,
			error: null
		};
		return { settled: false };
	}
	flushPendingBatchWaiters() {
		if (this.pendingBatchWaiters.size === 0) return;
		const rejectedBatchIdsHandledByWaiters = /* @__PURE__ */ new Set();
		for (const [batchId, waiters] of this.pendingBatchWaiters) {
			const remaining = [];
			for (const waiter of waiters) {
				const outcome = this.batchWaitOutcome(batchId, waiter.tier);
				if (!outcome.settled) {
					remaining.push(waiter);
					continue;
				}
				if (outcome.error) {
					waiter.reject(outcome.error);
					rejectedBatchIdsHandledByWaiters.add(batchId);
				} else waiter.resolve();
			}
			if (remaining.length > 0) this.pendingBatchWaiters.set(batchId, remaining);
			else this.pendingBatchWaiters.delete(batchId);
		}
		for (const batchId of rejectedBatchIdsHandledByWaiters) this.acknowledgeRejectedBatchInternal(batchId);
	}
	ensurePendingBatchWaitPolling() {
		if (this.pendingBatchWaitPollTimer !== null) return;
		if (this.pendingBatchWaiters.size === 0) return;
		this.pendingBatchWaitPollTimer = setTimeout(() => {
			this.pendingBatchWaitPollTimer = null;
			const batchesWithPendingWaiters = new Set(this.pendingBatchWaiters.keys());
			this.flushPendingBatchWaiters();
			this.flushUnhandledMutationErrors(this.drainRejectedBatchIds(), batchesWithPendingWaiters);
			this.ensurePendingBatchWaitPolling();
		}, 20);
	}
	cancelPendingBatchWaitPolling() {
		if (this.pendingBatchWaitPollTimer === null) return;
		clearTimeout(this.pendingBatchWaitPollTimer);
		this.pendingBatchWaitPollTimer = null;
	}
	flushUnhandledMutationErrors(rejectedBatchIds = this.drainRejectedBatchIds(), batchesHandledByLiveWaiters = /* @__PURE__ */ new Set()) {
		for (const batchId of rejectedBatchIds) {
			const record = this.localBatchRecord(batchId);
			if (!record) continue;
			const settlement = record.latestSettlement;
			if (!settlement || settlement.kind !== "rejected") continue;
			if (batchesHandledByLiveWaiters.has(record.batchId)) continue;
			if ((this.pendingBatchWaiters.get(record.batchId)?.length ?? 0) > 0) continue;
			const event = {
				code: settlement.code,
				reason: settlement.reason,
				batch: record
			};
			if (this.mutationErrorListeners.size === 0) console.error("Unhandled Jazz mutation error", event);
			else for (const listener of this.mutationErrorListeners) listener(event);
			this.acknowledgeRejectedBatchInternal(record.batchId);
		}
	}
	drainRejectedBatchIds() {
		const drainRejectedBatchIds = this.runtime.drainRejectedBatchIds;
		if (!drainRejectedBatchIds) return [];
		return [...new Set(drainRejectedBatchIds.call(this.runtime))].sort();
	}
	waitForPersistedBatch(batchId, tier) {
		const outcome = this.batchWaitOutcome(batchId, tier);
		if (outcome.settled) return outcome.error ? Promise.reject(outcome.error) : Promise.resolve();
		return new Promise((resolve, reject) => {
			const waiters = this.pendingBatchWaiters.get(batchId) ?? [];
			waiters.push({
				tier,
				resolve,
				reject
			});
			this.pendingBatchWaiters.set(batchId, waiters);
			this.flushPendingBatchWaiters();
			this.ensurePendingBatchWaitPolling();
		});
	}
	/**
	* Shutdown the client and release resources.
	*/
	async shutdown() {
		if (this.shutdownPromise) return await this.shutdownPromise;
		this.shutdownPromise = (async () => {
			this.cancelPendingBatchWaitPolling();
			this.runtime.disconnect?.();
			if (this.runtime.close) await this.runtime.close();
		})();
		return await this.shutdownPromise;
	}
};
async function tryLoadNodePackagedWasmBinary() {
	const moduleBuiltin = process.getBuiltinModule?.("module");
	const fsBuiltin = process.getBuiltinModule?.("fs");
	const pathBuiltin = process.getBuiltinModule?.("path");
	if (!moduleBuiltin || !fsBuiltin || !pathBuiltin) return null;
	const { createRequire } = moduleBuiltin;
	const { existsSync, readFileSync } = fsBuiltin;
	const { dirname, resolve } = pathBuiltin;
	const wasmPath = resolve(dirname(createRequire(import.meta.url).resolve("jazz-wasm/package.json")), "pkg/jazz_wasm_bg.wasm");
	if (!existsSync(wasmPath)) return null;
	return readFileSync(wasmPath);
}
/**
* Load and initialize the WASM module.
*
* Exported so that `createDb()` can pre-load the module for sync mutations.
*/
async function loadWasmModule(runtime) {
	const wasmModule = await import("./jazz_wasm.js");
	const syncInitInput = resolveRuntimeConfigSyncInitInput(runtime);
	if (syncInitInput) {
		wasmModule.initSync(syncInitInput);
		return wasmModule;
	}
	let nodeInitDone = false;
	if (typeof process !== "undefined" && process.versions?.node) try {
		const wasmBinary = await tryLoadNodePackagedWasmBinary();
		if (wasmBinary) {
			wasmModule.initSync({ module: wasmBinary });
			nodeInitDone = true;
		}
	} catch {}
	if (!nodeInitDone && typeof wasmModule.default === "function") {
		const wasmUrl = typeof location !== "undefined" ? resolveRuntimeConfigWasmUrl(import.meta.url, location.href, runtime) : null;
		if (wasmUrl) await wasmModule.default({ module_or_path: wasmUrl });
		else await wasmModule.default();
	}
	return wasmModule;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/worker-bridge.js
/**
* WorkerBridge — Main-thread side of the worker communication bridge.
*
* Wires a main-thread WasmRuntime (in-memory) to a dedicated worker
* (OPFS-persistent) via postMessage. The worker acts as the "server"
* for the main thread's runtime.
*/
var INIT_RESPONSE_TIMEOUT_MS = 12e3;
var SHUTDOWN_ACK_TIMEOUT_MS = 5e3;
function createDeferredPromise() {
	let resolve;
	return {
		promise: new Promise((resolver) => {
			resolve = resolver;
		}),
		resolve
	};
}
/**
* Bridge between main-thread runtime and dedicated worker.
*
* The bridge:
* - Forwards outgoing sync messages from the main runtime to the worker
* - Forwards incoming sync messages from the worker to the main runtime
* - The worker is treated as the main thread's "server" for sync purposes
*/
var WorkerBridge = class {
	worker;
	runtime;
	state;
	constructor(worker, runtime) {
		const upstreamReady = createDeferredPromise();
		this.worker = worker;
		this.runtime = runtime;
		this.state = {
			phase: "idle",
			workerClientId: null,
			initPromise: null,
			expectsUpstreamServer: false,
			upstreamServerConnected: false,
			upstreamServerReady: upstreamReady.promise,
			resolveUpstreamServerReady: upstreamReady.resolve,
			pendingSyncPayloadsForWorker: [],
			syncBatchFlushQueued: false,
			peerSyncListener: null,
			authFailureListener: null,
			serverPayloadForwarder: null
		};
		this.worker.onmessage = (event) => {
			const msg = event.data;
			if (msg.type === "sync") for (const entry of msg.payload) {
				const payload = isSequencedSyncPayload(entry) ? entry.payload : entry;
				const sequence = isSequencedSyncPayload(entry) ? entry.sequence : void 0;
				this.runtime.onSyncMessageReceived(payload, sequence);
			}
			else if (msg.type === "upstream-connected") this.markUpstreamServerConnected();
			else if (msg.type === "upstream-disconnected") this.markUpstreamServerDisconnected();
			else if (msg.type === "auth-failed") this.state.authFailureListener?.(msg.reason);
			else if (msg.type === "peer-sync") this.state.peerSyncListener?.({
				peerId: msg.peerId,
				term: msg.term,
				payload: msg.payload
			});
		};
		this.runtime.onSyncMessageToSend?.(createSyncOutboxRouter({ onServerPayload: (payload) => {
			if (this.isDisposedLike()) return;
			if (this.state.serverPayloadForwarder) this.state.serverPayloadForwarder(payload);
			else this.enqueueSyncMessageForWorker(payload);
		} }));
		this.runtime.addServer(null, 1);
	}
	/**
	* Initialize the worker with schema and config.
	*
	* Waits for the worker to respond with init-ok.
	*/
	init(options) {
		if (this.state.initPromise) return this.state.initPromise;
		if (this.isDisposedLike()) {
			const disposedError = Promise.reject(/* @__PURE__ */ new Error("WorkerBridge has been disposed"));
			this.state.initPromise = disposedError;
			return disposedError;
		}
		this.transition({ type: "INIT_CALLED" });
		const initMsg = {
			type: "init",
			schemaJson: options.schemaJson,
			appId: options.appId,
			env: options.env,
			userBranch: options.userBranch,
			dbName: options.dbName,
			serverUrl: options.serverUrl,
			jwtToken: options.jwtToken,
			adminSecret: options.adminSecret,
			runtimeSources: options.runtimeSources,
			fallbackWasmUrl: options.fallbackWasmUrl,
			logLevel: options.logLevel,
			clientId: ""
		};
		this.state.expectsUpstreamServer = Boolean(options.serverUrl);
		if (!this.state.expectsUpstreamServer) this.markUpstreamServerConnected();
		else this.markUpstreamServerDisconnected();
		const responsePromise = waitForMessage(this.worker, (msg) => msg.type === "init-ok" || msg.type === "error", INIT_RESPONSE_TIMEOUT_MS, "Worker init timeout");
		this.worker.postMessage(initMsg);
		const initPromise = responsePromise.then((response) => {
			if (this.isDisposedLike()) throw new Error("WorkerBridge has been disposed");
			if (response.type === "error") {
				this.transition({ type: "INIT_FAILED" });
				throw new Error(`Worker init failed: ${response.message}`);
			}
			if (response.type === "init-ok") {
				if (this.state.phase !== "initializing") throw new Error("Worker init response arrived after bridge left initializing state");
				this.transition({
					type: "INIT_OK",
					clientId: response.clientId
				});
				this.flushPendingSyncToWorker();
				return response.clientId;
			}
			throw new Error("Unexpected worker response");
		}).catch((error) => {
			if (this.state.phase !== "disposed") this.transition({ type: "INIT_FAILED" });
			throw error;
		});
		this.state.initPromise = initPromise;
		return initPromise;
	}
	/**
	* Update auth credentials in the worker.
	*/
	updateAuth(auth) {
		if (this.isDisposedLike()) return;
		this.worker.postMessage({
			type: "update-auth",
			...auth
		});
	}
	sendLifecycleHint(event) {
		if (this.isDisposedLike()) return;
		this.worker.postMessage({
			type: "lifecycle-hint",
			event,
			sentAtMs: Date.now()
		});
	}
	/**
	* Shut down the worker and wait for OPFS handles to be released.
	*
	* @param worker The Worker instance (needed for listening to shutdown-ok)
	*/
	async shutdown(worker) {
		if (this.isDisposedLike()) return;
		this.transition({ type: "SHUTDOWN_CALLED" });
		const shutdownAckPromise = waitForMessage(worker, (msg) => msg.type === "shutdown-ok", SHUTDOWN_ACK_TIMEOUT_MS, "Worker shutdown timeout");
		this.worker.postMessage({ type: "shutdown" });
		try {
			await shutdownAckPromise;
			this.transition({ type: "SHUTDOWN_FINISHED" });
		} catch {
			this.transition({ type: "SHUTDOWN_FINISHED" });
		}
	}
	/**
	* Get the client ID the worker assigned to the main thread.
	*/
	getWorkerClientId() {
		return this.state.workerClientId;
	}
	setServerPayloadForwarder(forwarder) {
		if (this.isDisposedLike()) return;
		this.state.serverPayloadForwarder = forwarder;
	}
	async waitForUpstreamServerConnection() {
		if (!this.state.expectsUpstreamServer) return;
		if (this.state.serverPayloadForwarder) return;
		if (this.state.upstreamServerConnected) return;
		await this.state.upstreamServerReady;
	}
	applyIncomingServerPayload(payload) {
		if (this.isDisposedLike()) return;
		this.runtime.onSyncMessageReceived(payload);
	}
	replayServerConnection() {
		if (this.isDisposedLike()) return;
		this.runtime.removeServer();
		this.runtime.addServer();
	}
	disconnectUpstream() {
		if (this.isDisposedLike()) return;
		this.worker.postMessage({ type: "disconnect-upstream" });
	}
	reconnectUpstream() {
		if (this.isDisposedLike()) return;
		this.worker.postMessage({ type: "reconnect-upstream" });
	}
	onPeerSync(listener) {
		this.state.peerSyncListener = listener;
	}
	onAuthFailure(listener) {
		this.state.authFailureListener = listener;
	}
	openPeer(peerId) {
		if (this.isDisposedLike()) return;
		this.worker.postMessage({
			type: "peer-open",
			peerId
		});
	}
	sendPeerSync(peerId, term, payload) {
		if (this.isDisposedLike()) return;
		if (payload.length === 0) return;
		const message = {
			type: "peer-sync",
			peerId,
			term,
			payload
		};
		const transfer = collectPayloadTransferables(payload);
		this.worker.postMessage(message, transfer);
	}
	closePeer(peerId) {
		if (this.isDisposedLike()) return;
		this.worker.postMessage({
			type: "peer-close",
			peerId
		});
	}
	enqueueSyncMessageForWorker(payload) {
		if (this.isDisposedLike()) return;
		this.state.pendingSyncPayloadsForWorker.push(payload);
		if (this.state.syncBatchFlushQueued) return;
		this.state.syncBatchFlushQueued = true;
		queueMicrotask(() => {
			if (this.isDisposedLike()) {
				this.state.syncBatchFlushQueued = false;
				this.state.pendingSyncPayloadsForWorker = [];
				return;
			}
			this.state.syncBatchFlushQueued = false;
			this.flushPendingSyncToWorker();
		});
	}
	flushPendingSyncToWorker() {
		if (this.state.phase !== "ready" || this.state.pendingSyncPayloadsForWorker.length === 0) return;
		const payloads = this.state.pendingSyncPayloadsForWorker;
		this.state.pendingSyncPayloadsForWorker = [];
		const message = {
			type: "sync",
			payload: payloads
		};
		const transfer = collectPayloadTransferables(payloads);
		this.worker.postMessage(message, transfer);
	}
	markUpstreamServerConnected() {
		this.state.upstreamServerConnected = true;
		const resolver = this.state.resolveUpstreamServerReady;
		this.state.resolveUpstreamServerReady = null;
		resolver?.();
	}
	markUpstreamServerDisconnected() {
		if (!this.state.expectsUpstreamServer) {
			this.state.upstreamServerConnected = true;
			return;
		}
		if (!this.state.upstreamServerConnected && this.state.resolveUpstreamServerReady) return;
		const deferred = createDeferredPromise();
		this.state.upstreamServerConnected = false;
		this.state.upstreamServerReady = deferred.promise;
		this.state.resolveUpstreamServerReady = deferred.resolve;
	}
	isDisposedLike() {
		return this.state.phase === "disposed" || this.state.phase === "shutting-down";
	}
	transition(event) {
		switch (event.type) {
			case "INIT_CALLED":
				if (this.state.phase === "idle" || this.state.phase === "failed") this.state.phase = "initializing";
				return;
			case "INIT_OK":
				if (this.state.phase !== "initializing") return;
				this.state.workerClientId = event.clientId;
				this.state.phase = "ready";
				return;
			case "INIT_FAILED":
				if (this.state.phase !== "initializing") return;
				this.state.phase = "failed";
				this.state.syncBatchFlushQueued = false;
				return;
			case "SHUTDOWN_CALLED":
				if (this.state.phase === "disposed" || this.state.phase === "shutting-down") return;
				this.state.phase = "shutting-down";
				this.runtime.removeServer();
				return;
			case "SHUTDOWN_FINISHED":
				if (this.state.phase === "disposed") return;
				this.state.phase = "disposed";
				this.disposeInternals();
				return;
		}
	}
	disposeInternals() {
		this.state.pendingSyncPayloadsForWorker = [];
		this.state.serverPayloadForwarder = null;
		this.state.peerSyncListener = null;
		this.state.syncBatchFlushQueued = false;
		this.runtime.onSyncMessageToSend?.(() => void 0);
	}
};
function collectPayloadTransferables(payloads) {
	return payloads.map((payload) => payload.buffer);
}
function isSequencedSyncPayload(value) {
	return typeof value === "object" && value !== null && "payload" in value && "sequence" in value && typeof value.sequence === "number";
}
/**
* Wait for a specific message type from a worker.
*/
function waitForMessage(worker, predicate, timeoutMs, timeoutMessage) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(timeoutMessage));
		}, timeoutMs);
		const handler = (event) => {
			if (predicate(event.data)) {
				cleanup();
				resolve(event.data);
			}
		};
		const cleanup = () => {
			clearTimeout(timeout);
			worker.removeEventListener("message", handler);
		};
		worker.addEventListener("message", handler);
	});
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/row-transformer.js
/**
* Transform WASM row results to typed TypeScript objects.
*/
function resolveBaseColumns(tableName, schema, projection) {
	const table = schema[tableName];
	if (!table) throw new Error(`Unknown table "${tableName}" in schema`);
	return resolveSelectedColumns(tableName, schema, projection).map((columnName) => {
		const magicType = magicColumnType(columnName);
		if (magicType) return {
			name: columnName,
			columnType: magicType
		};
		const column = table.columns.find((candidate) => candidate.name === columnName);
		return column ? {
			name: column.name,
			columnType: column.column_type
		} : null;
	}).filter((column) => column !== null);
}
function toByteArray(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (Array.isArray(value)) {
		const bytes = value.map((entry) => {
			if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 255) throw new Error("Invalid Bytea array value. Expected integers in range 0..255.");
			return entry;
		});
		return new Uint8Array(bytes);
	}
	throw new Error("Invalid Bytea value. Expected Uint8Array or byte array.");
}
function buildIncludePlans(tableName, includes, relationsByTable) {
	const relations = relationsByTable.get(tableName) || [];
	const plans = [];
	for (const [relationName, spec] of Object.entries(includes)) {
		const relation = relations.find((candidate) => candidate.name === relationName);
		if (!relation) throw new Error(`Unknown relation "${relationName}" on table "${tableName}"`);
		const nested = buildIncludePlans(relation.toTable, spec.includes, relationsByTable);
		plans.push({
			relation,
			nested,
			projection: spec.select.length > 0 ? spec.select : void 0
		});
	}
	return plans;
}
function transformIncludedValue(value, plan, schema) {
	if (value.type !== "Array") return unwrapValue(value);
	const rows = value.value.map((entry) => {
		if (entry.type !== "Row") return unwrapValue(entry);
		const rowId = entry.value.id;
		const columnValues = entry.value.values;
		return transformRowValues(columnValues, schema, plan.relation.toTable, plan.nested, rowId, plan.projection);
	});
	return plan.relation.isArray ? rows : rows[0] ?? null;
}
function transformRowValues(values, schema, tableName, includePlans, rowId, projection) {
	if (!schema[tableName]) throw new Error(`Unknown table "${tableName}" in schema`);
	const obj = {};
	if (rowId !== void 0) obj.id = rowId;
	const baseColumns = resolveBaseColumns(tableName, schema, projection);
	for (let i = 0; i < baseColumns.length; i++) {
		const col = baseColumns[i];
		if (!col) continue;
		const value = values[i];
		if (value !== void 0) obj[col.name] = unwrapValue(value, col.columnType, col.name);
	}
	for (let i = 0; i < includePlans.length; i++) {
		const value = values[baseColumns.length + i];
		if (value === void 0) continue;
		const plan = includePlans[i];
		if (!plan) continue;
		obj[plan.relation.name] = transformIncludedValue(value, plan, schema);
	}
	return obj;
}
function timestampToDate(value, columnName) {
	if (columnName && isProvenanceMagicTimestampColumn(columnName)) return new Date(Math.trunc(value / 1e3));
	return new Date(value);
}
function unwrapValue(v, columnType, columnName) {
	switch (v.type) {
		case "Text":
			if (columnType?.type === "Json") try {
				return JSON.parse(v.value);
			} catch (error) {
				throw new Error(`Invalid stored JSON value: ${error instanceof Error ? error.message : String(error)}`);
			}
			return v.value;
		case "Uuid": return v.value;
		case "Boolean": return v.value;
		case "Integer":
		case "BigInt":
		case "Double": return v.value;
		case "Timestamp": return timestampToDate(v.value, columnName);
		case "Bytea": return toByteArray(v.value);
		case "Null": return null;
		case "Array":
			if (columnType?.type === "Array") return v.value.map((entry) => unwrapValue(entry, columnType.element));
			return v.value.map((entry) => unwrapValue(entry));
		case "Row":
			if (columnType?.type === "Row") return v.value.values.map((entry, index) => unwrapValue(entry, columnType.columns[index]?.column_type));
			return v.value.values.map((entry) => unwrapValue(entry));
	}
}
/**
* Transform WasmRow[] to typed objects using schema column order.
*
* @param rows Array of WasmRow results from query
* @param schema WasmSchema containing table definitions
* @param tableName Name of the table being queried
* @param includes Include tree from QueryBuilder._build() (if any)
* @returns Array of typed objects with named properties
*/
function transformRows(rows, schema, tableName, includes = {}, projection) {
	if (!schema[tableName]) throw new Error(`Unknown table "${tableName}" in schema`);
	const includePlans = Object.keys(includes).length === 0 ? [] : buildIncludePlans(tableName, normalizeIncludeEntries(includes), analyzeRelations(schema));
	return rows.map((row) => {
		return transformRowValues(row.values, schema, tableName, includePlans, row.id, projection);
	});
}
function transformRow(row, schema, tableName, includes = {}, projection) {
	const transformed = transformRows([row], schema, tableName, includes, projection)[0];
	if (transformed === void 0) throw new Error(`Failed to transform row for table "${tableName}"`);
	return transformed;
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/subscription-manager.js
/**
* Manage subscription state and compute deltas.
*
* Tracks the current result set for a subscription and transforms
* WASM row deltas into typed object deltas with full state tracking.
*/
var RowChangeKind = {
	Added: 0,
	Removed: 1,
	Updated: 2
};
/**
* Manages subscription state for a single query.
*
* Tracks the current result set by ID and transforms incoming
* row-level deltas into typed object deltas.
*
* @typeParam T - The typed object type (must have `id: string`)
*/
var SubscriptionManager = class {
	currentResults = /* @__PURE__ */ new Map();
	orderedIds = [];
	removeId(id) {
		const index = this.orderedIds.indexOf(id);
		if (index !== -1) this.orderedIds.splice(index, 1);
	}
	insertIdAt(id, index) {
		const clamped = Math.max(0, Math.min(index, this.orderedIds.length));
		this.orderedIds.splice(clamped, 0, id);
	}
	/**
	* Process a row delta and return typed object delta.
	*
	* @param delta Raw row delta from WASM runtime
	* @param transform Function to convert WasmRow to typed object T
	* @returns Typed delta with full state and changes
	*/
	handleDelta(delta, transform) {
		delta.sort((a, b) => a.index - b.index);
		for (const change of delta) switch (change.kind) {
			case RowChangeKind.Added:
				this.currentResults.set(change.id, transform(change.row));
				this.removeId(change.id);
				this.insertIdAt(change.id, change.index);
				break;
			case RowChangeKind.Removed:
				this.currentResults.delete(change.id);
				this.removeId(change.id);
				break;
			case RowChangeKind.Updated:
				this.removeId(change.id);
				this.insertIdAt(change.id, change.index);
				if (change.row) this.currentResults.set(change.id, transform(change.row));
				break;
		}
		return {
			all: this.orderedIds.map((id) => this.currentResults.get(id)).filter((item) => item !== void 0),
			delta
		};
	}
	/**
	* Clear all tracked state.
	*
	* Called when unsubscribing to free memory.
	*/
	clear() {
		this.currentResults.clear();
		this.orderedIds = [];
	}
	/**
	* Get the current number of tracked items.
	*/
	get size() {
		return this.currentResults.size;
	}
};
var MAX_FILE_PART_BYTES = 1048576;
var DEFAULT_MIME_TYPE = "application/octet-stream";
var FileNotFoundError = class extends Error {
	fileId;
	constructor(fileId) {
		super(`File "${fileId}" was not found.`);
		this.name = "FileNotFoundError";
		this.fileId = fileId;
	}
};
var IncompleteFileDataError = class extends Error {
	fileId;
	reason;
	partId;
	partIndex;
	constructor(fileId, reason, message, options = {}) {
		super(message);
		this.name = "IncompleteFileDataError";
		this.fileId = fileId;
		this.reason = reason;
		this.partId = options.partId;
		this.partIndex = options.partIndex;
	}
};
var DEFAULT_COLUMNS = {
	name: "name",
	mimeType: "mimeType",
	partIds: "partIds",
	partSizes: "partSizes",
	data: "data"
};
function createFileStorage(db, options) {
	const columns = {
		...DEFAULT_COLUMNS,
		...options.columns
	};
	const defaultChunkSizeBytes = options.defaultChunkSizeBytes ?? 262144;
	validateChunkSize(defaultChunkSizeBytes);
	const insertRow = async (table, data, writeOptions) => {
		const result = db.insert(table, data);
		if (writeOptions?.tier) return result.wait({ tier: writeOptions.tier });
		return result.value;
	};
	const loadFileRecord = async (fileOrId, readOptions) => {
		const queryOptions = toQueryOptions(readOptions);
		if (typeof fileOrId === "string") {
			const file = await db.one(options.files.where({ id: fileOrId }), queryOptions);
			if (!file) throw new FileNotFoundError(fileOrId);
			return normalizeFileRecord(file, columns);
		}
		return normalizeFileRecord(fileOrId, columns);
	};
	const loadPartBytes = async (file, partIndex, readOptions) => {
		const partId = file.partIds[partIndex];
		const expectedSize = file.partSizes[partIndex];
		const queryOptions = toQueryOptions(readOptions);
		const part = await db.one(options.fileParts.where({ id: partId }), queryOptions);
		if (!part) throw new IncompleteFileDataError(file.id, "missing-part", `File "${file.id}" is incomplete: missing part ${partIndex} (${partId}) at the requested query tier.`, {
			partId,
			partIndex
		});
		const raw = part[columns.data];
		const bytes = asUint8Array(raw, `File part "${partId}" has invalid "${columns.data}" data.`);
		if (bytes.length !== expectedSize) throw new IncompleteFileDataError(file.id, "part-size-mismatch", `File "${file.id}" is incomplete: part ${partIndex} (${partId}) expected ${expectedSize} bytes, got ${bytes.length}.`, {
			partId,
			partIndex
		});
		return bytes;
	};
	const createReadStream = (file, readOptions) => {
		let nextIndex = 0;
		let canceled = false;
		return new ReadableStream({
			async pull(controller) {
				if (canceled) {
					controller.close();
					return;
				}
				if (nextIndex >= file.partIds.length) {
					controller.close();
					return;
				}
				const currentIndex = nextIndex;
				nextIndex += 1;
				try {
					const bytes = await loadPartBytes(file, currentIndex, readOptions);
					if (canceled) {
						controller.close();
						return;
					}
					controller.enqueue(bytes);
					if (nextIndex >= file.partIds.length) controller.close();
				} catch (error) {
					controller.error(error);
				}
			},
			cancel() {
				canceled = true;
			}
		});
	};
	return {
		async fromBlob(blob, writeOptions = {}) {
			const name = writeOptions.name ?? getFileName(blob);
			const mimeType = writeOptions.mimeType ?? (blob.type || DEFAULT_MIME_TYPE);
			return this.fromStream(blob.stream(), {
				...writeOptions,
				mimeType,
				...name !== void 0 ? { name } : {}
			});
		},
		async fromStream(stream, writeOptions = {}) {
			const chunkSizeBytes = writeOptions.chunkSizeBytes ?? defaultChunkSizeBytes;
			validateChunkSize(chunkSizeBytes);
			const filepartIds = [];
			const partSizes = [];
			for await (const chunk of chunkReadableStream(stream, chunkSizeBytes)) {
				if (chunk.length > 1048576) throw new Error(`File chunk exceeded the ${MAX_FILE_PART_BYTES}-byte BYTEA limit: ${chunk.length} bytes.`);
				const part = await insertRow(options.fileParts, { [columns.data]: chunk }, writeOptions);
				if (typeof part.id !== "string") throw new Error(`Inserted file part row is missing a string "id".`);
				filepartIds.push(part.id);
				partSizes.push(chunk.length);
			}
			return insertRow(options.files, {
				[columns.mimeType]: writeOptions.mimeType ?? DEFAULT_MIME_TYPE,
				[columns.partIds]: filepartIds,
				[columns.partSizes]: partSizes,
				...writeOptions.name !== void 0 ? { [columns.name]: writeOptions.name } : {}
			}, writeOptions);
		},
		async toStream(fileOrId, readOptions = {}) {
			return createReadStream(await loadFileRecord(fileOrId, readOptions), readOptions);
		},
		async toBlob(fileOrId, readOptions = {}) {
			const file = await loadFileRecord(fileOrId, readOptions);
			const reader = createReadStream(file, readOptions).getReader();
			const chunks = [];
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
			return new Blob(chunks.map((chunk) => toBlobPart(chunk)), { type: file.mimeType });
		}
	};
	async function* chunkReadableStream(stream, chunkSizeBytes) {
		const reader = stream.getReader();
		const pending = [];
		let pendingBytes = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				const bytes = asUint8Array(value, "ReadableStream chunk must be binary data.");
				if (bytes.length === 0) continue;
				pending.push(bytes);
				pendingBytes += bytes.length;
				while (pendingBytes >= chunkSizeBytes) {
					yield takePendingBytes(pending, chunkSizeBytes);
					pendingBytes -= chunkSizeBytes;
				}
			}
			if (pendingBytes > 0) yield takePendingBytes(pending, pendingBytes);
		} finally {
			try {
				reader.releaseLock();
			} catch {}
		}
	}
	function takePendingBytes(pending, targetLength) {
		const out = new Uint8Array(targetLength);
		let offset = 0;
		while (offset < targetLength) {
			const current = pending[0];
			if (!current) throw new Error("Chunking logic ran out of pending bytes.");
			const remaining = targetLength - offset;
			const consume = Math.min(remaining, current.length);
			out.set(current.subarray(0, consume), offset);
			offset += consume;
			if (consume === current.length) pending.shift();
			else pending[0] = current.subarray(consume);
		}
		return out;
	}
	function normalizeFileRecord(file, names) {
		const id = file.id;
		if (typeof id !== "string") throw new Error(`File row is missing a string "id".`);
		const partIds = readStringArray(file[names.partIds], new IncompleteFileDataError(id, "invalid-file-record", `File "${id}" is incomplete: invalid "${names.partIds}" metadata.`));
		const partSizes = readIntegerArray(file[names.partSizes], new IncompleteFileDataError(id, "invalid-file-record", `File "${id}" is incomplete: invalid "${names.partSizes}" metadata.`));
		if (partIds.length !== partSizes.length) throw new IncompleteFileDataError(id, "invalid-file-record", `File "${id}" is incomplete: "${names.partIds}" and "${names.partSizes}" lengths do not match.`);
		return {
			id,
			name: typeof file[names.name] === "string" ? file[names.name] : void 0,
			mimeType: typeof file[names.mimeType] === "string" && file[names.mimeType].length > 0 ? file[names.mimeType] : DEFAULT_MIME_TYPE,
			partIds,
			partSizes
		};
	}
	function readStringArray(value, error) {
		if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw error;
		return [...value];
	}
	function readIntegerArray(value, error) {
		if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry) || entry < 0)) throw error;
		return value.map((entry) => Number(entry));
	}
	function asUint8Array(value, message) {
		if (value instanceof Uint8Array) return value;
		if (value instanceof ArrayBuffer) return new Uint8Array(value);
		if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		if (Array.isArray(value)) {
			const numbers = value.map((entry) => {
				const n = Number(entry);
				if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(message);
				return n;
			});
			return Uint8Array.from(numbers);
		}
		throw new Error(message);
	}
	function toBlobPart(bytes) {
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		return copy.buffer;
	}
	function getFileName(blob) {
		if (typeof File !== "undefined" && blob instanceof File) return blob.name;
	}
}
function createConventionalFileStorage(db, app) {
	return createFileStorage(db, {
		files: app.files,
		fileParts: app.file_parts
	});
}
function validateChunkSize(chunkSizeBytes) {
	if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes <= 0) throw new Error("chunkSizeBytes must be a positive integer.");
	if (chunkSizeBytes > 1048576) throw new Error(`chunkSizeBytes must be <= ${MAX_FILE_PART_BYTES} bytes to fit inside a BYTEA file part.`);
}
function toQueryOptions(readOptions) {
	if (!readOptions) return;
	const { propagation, tier, visibility } = readOptions;
	if (propagation === void 0 && tier === void 0 && visibility === void 0) return;
	return {
		propagation,
		tier,
		visibility
	};
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/leader-lock.js
function resolveNavigatorLocks() {
	const nav = globalThis.navigator;
	if (!nav || !nav.locks) return null;
	const locks = nav.locks;
	if (typeof locks.request !== "function") return null;
	return locks;
}
function createNavigatorLocksLeaderLockStrategy(lockManager = resolveNavigatorLocks()) {
	if (!lockManager) return null;
	return { async tryAcquire(lockName) {
		let resolveAcquired = null;
		const acquiredPromise = new Promise((resolve) => {
			resolveAcquired = resolve;
		});
		let releaseLock = null;
		const heldUntilReleased = new Promise((resolve) => {
			releaseLock = () => resolve();
		});
		lockManager.request(lockName, {
			mode: "exclusive",
			ifAvailable: true
		}, async (lock) => {
			if (!lock) {
				resolveAcquired?.(null);
				resolveAcquired = null;
				return;
			}
			resolveAcquired?.({ release: () => {
				if (!releaseLock) return;
				releaseLock();
				releaseLock = null;
			} });
			resolveAcquired = null;
			await heldUntilReleased;
		}).catch(() => {
			resolveAcquired?.(null);
			resolveAcquired = null;
		});
		return await acquiredPromise;
	} };
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/tab-leader-election.js
function randomTabId() {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
	return `tab-${Math.random().toString(36).slice(2, 12)}`;
}
function compareTabIds(a, b) {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}
function isMessage(value) {
	if (typeof value !== "object" || value === null) return false;
	const msg = value;
	if (msg.type === "leader-heartbeat") return typeof msg.leaderTabId === "string" && typeof msg.term === "number" && typeof msg.sentAtMs === "number";
	if (msg.type === "who-is-leader") return typeof msg.requesterTabId === "string";
	if (msg.type === "leader-claim") return typeof msg.candidateTabId === "string" && typeof msg.term === "number" && typeof msg.sentAtMs === "number";
	return false;
}
function resolveBroadcastChannelCtor$1() {
	const ctor = globalThis.BroadcastChannel;
	if (typeof ctor !== "function") return null;
	return ctor;
}
var TabLeaderElection = class {
	tabId;
	heartbeatMs;
	leaseMs;
	now;
	channelName;
	lockName;
	lockStrategy;
	started = false;
	channel = null;
	role = "follower";
	term = 0;
	leaderTabId = null;
	lastLeaderSeenAtMs = 0;
	heartbeatTimer = null;
	leaseDeadlineTimer = null;
	probeInFlight = false;
	leadershipLockLease = null;
	listeners = /* @__PURE__ */ new Set();
	readyResolve = null;
	readyReject = null;
	readyPromise;
	readySettled = false;
	onMessage = (event) => {
		this.handleIncomingMessage(event.data);
	};
	constructor(options) {
		this.tabId = options.tabId ?? randomTabId();
		this.heartbeatMs = Math.max(100, options.heartbeatMs ?? 1e3);
		this.leaseMs = Math.max(this.heartbeatMs * 2, options.leaseMs ?? 5e3);
		this.now = options.now ?? (() => Date.now());
		this.channelName = `jazz-leader:${options.appId}:${options.dbName}`;
		this.lockName = `jazz-leader-lock:${options.appId}:${options.dbName}`;
		this.lockStrategy = options.lockStrategy ?? createNavigatorLocksLeaderLockStrategy();
		this.readyPromise = new Promise((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
		});
	}
	start() {
		if (this.started) return;
		this.started = true;
		const ChannelCtor = resolveBroadcastChannelCtor$1();
		if (ChannelCtor) {
			this.channel = new ChannelCtor(this.channelName);
			this.channel.addEventListener("message", this.onMessage);
			this.requestCurrentLeader();
		}
		this.tryTakeLeadership({ requestLeaderOnFailure: false });
		this.scheduleLeaseDeadlineCheck();
	}
	stop() {
		if (!this.started) return;
		this.started = false;
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		this.clearLeaseDeadlineTimer();
		this.releaseLeadershipLock();
		if (this.channel) {
			this.channel.removeEventListener("message", this.onMessage);
			this.channel.close();
			this.channel = null;
		}
		if (!this.readySettled && this.readyReject) {
			this.readyReject(/* @__PURE__ */ new Error("Leader election stopped before initial leader was chosen"));
			this.readyReject = null;
			this.readyResolve = null;
			this.readySettled = true;
		}
	}
	onChange(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	snapshot() {
		return {
			role: this.role,
			tabId: this.tabId,
			leaderTabId: this.leaderTabId,
			term: this.term
		};
	}
	isLeader() {
		return this.role === "leader";
	}
	async waitForInitialLeader(timeoutMs = 2e3) {
		if (this.readySettled) return this.snapshot();
		return await Promise.race([this.readyPromise, new Promise((_resolve, reject) => {
			setTimeout(() => reject(/* @__PURE__ */ new Error("Leader election timeout")), timeoutMs);
		})]);
	}
	handleIncomingMessage(raw) {
		if (!isMessage(raw)) return;
		switch (raw.type) {
			case "who-is-leader":
				if (this.role === "leader") this.sendHeartbeat();
				return;
			case "leader-heartbeat":
				this.handleLeaderHeartbeat(raw);
				return;
			case "leader-claim":
				this.handleLeaderClaim(raw);
				return;
		}
	}
	handleLeaderHeartbeat(message) {
		if (!(message.term > this.term || message.term === this.term && (this.leaderTabId === null || message.leaderTabId === this.leaderTabId || compareTabIds(message.leaderTabId, this.leaderTabId) > 0))) return;
		this.setLeader(message.leaderTabId, message.term);
		this.lastLeaderSeenAtMs = this.now();
		this.scheduleLeaseDeadlineCheck();
	}
	handleLeaderClaim(message) {
		if (!(message.term > this.term || message.term === this.term && (this.leaderTabId === null || compareTabIds(message.candidateTabId, this.leaderTabId) > 0))) return;
		this.setLeader(message.candidateTabId, message.term);
		this.lastLeaderSeenAtMs = this.now();
		this.scheduleLeaseDeadlineCheck();
	}
	promoteToLeader(nextTerm) {
		const electedTerm = Math.max(this.term + 1, nextTerm);
		this.setLeader(this.tabId, electedTerm);
		this.lastLeaderSeenAtMs = this.now();
		this.postMessage({
			type: "leader-claim",
			candidateTabId: this.tabId,
			term: electedTerm,
			sentAtMs: this.now()
		});
		this.sendHeartbeat();
	}
	setLeader(leaderTabId, term) {
		const prevLeader = this.leaderTabId;
		const prevRole = this.role;
		const prevTerm = this.term;
		const nextRole = leaderTabId === this.tabId ? "leader" : "follower";
		this.term = term;
		this.leaderTabId = leaderTabId;
		this.role = nextRole;
		if (this.role === "leader") {
			this.ensureHeartbeatTimer();
			this.clearLeaseDeadlineTimer();
		} else {
			if (prevRole === "leader") this.releaseLeadershipLock();
			this.clearHeartbeatTimer();
			this.scheduleLeaseDeadlineCheck();
		}
		this.resolveReadyIfNeeded();
		if (prevLeader !== leaderTabId || prevRole !== nextRole || prevTerm !== this.term) this.emitChange();
	}
	ensureHeartbeatTimer() {
		if (this.heartbeatTimer) return;
		this.heartbeatTimer = setInterval(() => {
			this.sendHeartbeat();
		}, this.heartbeatMs);
	}
	clearHeartbeatTimer() {
		if (!this.heartbeatTimer) return;
		clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = null;
	}
	scheduleLeaseDeadlineCheck() {
		if (!this.started || this.role === "leader") {
			this.clearLeaseDeadlineTimer();
			return;
		}
		const delayMs = this.leaderTabId ? Math.max(0, this.lastLeaderSeenAtMs + this.leaseMs - this.now()) : this.heartbeatMs;
		this.clearLeaseDeadlineTimer();
		this.leaseDeadlineTimer = setTimeout(() => {
			this.leaseDeadlineTimer = null;
			this.onLeaseDeadline();
		}, delayMs);
	}
	clearLeaseDeadlineTimer() {
		if (!this.leaseDeadlineTimer) return;
		clearTimeout(this.leaseDeadlineTimer);
		this.leaseDeadlineTimer = null;
	}
	onLeaseDeadline() {
		if (!this.started || this.role === "leader") return;
		if (!this.leaderTabId) {
			this.tryTakeLeadership({ requestLeaderOnFailure: true });
			return;
		}
		if (this.now() - this.lastLeaderSeenAtMs >= this.leaseMs) {
			this.tryTakeLeadership({ requestLeaderOnFailure: true });
			return;
		}
		this.scheduleLeaseDeadlineCheck();
	}
	sendHeartbeat() {
		if (!this.started || this.role !== "leader") return;
		this.postMessage({
			type: "leader-heartbeat",
			leaderTabId: this.tabId,
			term: this.term,
			sentAtMs: this.now()
		});
	}
	postMessage(message) {
		this.channel?.postMessage(message);
	}
	requestCurrentLeader() {
		this.postMessage({
			type: "who-is-leader",
			requesterTabId: this.tabId
		});
	}
	async tryTakeLeadership(options) {
		if (!this.started || this.isLeader()) return;
		if (this.probeInFlight) return;
		this.probeInFlight = true;
		try {
			const acquired = await this.tryAcquireLeadershipLock();
			if (!this.started || this.isLeader()) return;
			if (acquired) {
				this.promoteToLeader(this.term + 1);
				return;
			}
			if (options.requestLeaderOnFailure) this.requestCurrentLeader();
			this.scheduleLeaseDeadlineCheck();
		} finally {
			this.probeInFlight = false;
		}
	}
	async tryAcquireLeadershipLock() {
		if (this.leadershipLockLease) return true;
		if (!this.lockStrategy) return false;
		const lease = await this.lockStrategy.tryAcquire(this.lockName);
		if (!lease) return false;
		this.leadershipLockLease = lease;
		return true;
	}
	releaseLeadershipLock() {
		const lease = this.leadershipLockLease;
		this.leadershipLockLease = null;
		lease?.release();
	}
	emitChange() {
		const snapshot = this.snapshot();
		for (const listener of this.listeners) listener(snapshot);
	}
	resolveReadyIfNeeded() {
		if (this.readySettled || !this.leaderTabId || !this.readyResolve) return;
		this.readySettled = true;
		this.readyResolve(this.snapshot());
		this.readyResolve = null;
		this.readyReject = null;
	}
};
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/db.js
/**
* High-level database class for typed queries and mutations.
*
* Connects QueryBuilder to JazzClient for actual query execution.
* Handles query translation, execution, and result transformation.
*
* Key design:
* - createDb() is async (pre-loads WASM module)
* - insert/update/delete are sync (local-first immediate writes, no durability wait)
* - all/one are async (need storage I/O for queries)
*/
var DEFAULT_WASM_LOG_LEVEL = "warn";
var STORAGE_RESET_REQUEST_RETRY_MS = 200;
var STORAGE_RESET_REQUEST_TIMEOUT_MS = 5e3;
var STORAGE_RESET_DISCOVERY_WINDOW_MS = 600;
var STORAGE_RESET_ACK_QUIET_MS = 150;
function setGlobalWasmLogLevel(level) {
	globalThis.__JAZZ_WASM_LOG_LEVEL = level ?? DEFAULT_WASM_LOG_LEVEL;
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function createOperationId(prefix) {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj && typeof cryptoObj.randomUUID === "function") return `${prefix}-${cryptoObj.randomUUID()}`;
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function toError(error, fallbackMessage) {
	return error instanceof Error ? error : new Error(error ? String(error) : fallbackMessage);
}
function resolveStorageDriver(driver) {
	return driver ?? { type: "persistent" };
}
function shouldBypassLocalPolicies(config) {
	return !!config.adminSecret;
}
function stripSchemaPolicies(schema) {
	return Object.fromEntries(Object.entries(schema).map(([tableName, tableSchema]) => [tableName, {
		...tableSchema,
		policies: void 0
	}]));
}
var policyStrippedSchemaCache = /* @__PURE__ */ new WeakMap();
function getPolicyStrippedSchema(schema) {
	const cached = policyStrippedSchemaCache.get(schema);
	if (cached) return cached;
	const strippedSchema = stripSchemaPolicies(schema);
	policyStrippedSchemaCache.set(schema, strippedSchema);
	return strippedSchema;
}
function trimOptionalString(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
/** @internal Derive the default browser persistence namespace for this Db config. */
function resolveDefaultPersistentDbName(config) {
	const driver = resolveStorageDriver(config.driver);
	const explicitDbName = trimOptionalString((driver.type === "persistent" ? driver.dbName : void 0) ?? config.dbName);
	if (explicitDbName) return explicitDbName;
	const session = resolveClientSessionSync({
		appId: config.appId,
		jwtToken: config.jwtToken
	});
	if (!session?.user_id || session.authMode === "anonymous") return config.appId;
	return `${config.appId}::${encodeURIComponent(session.user_id)}`;
}
function ordinaryDbQueryOptions(options) {
	return {
		localUpdates: "deferred",
		...options
	};
}
function createDeferred() {
	let resolve;
	let reject;
	return {
		promise: new Promise((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		}),
		resolve,
		reject
	};
}
function trimSubscriptionTraceStack(stack) {
	if (!stack) return stack;
	const lines = stack.split("\n");
	if (lines.length <= 1) return stack;
	const isInternalFrame = (line) => {
		return line.includes("Db.registerActiveQuerySubscriptionTrace") || line.includes("Db.subscribeAll") || line.includes("SubscriptionsOrchestrator.ensureEntryForKey") || line.includes("SubscriptionsOrchestrator.getCacheEntry") || line.includes("/node_modules/") || line.includes("react-dom") || line.includes("react_stack_bottom_frame");
	};
	const firstOriginIndex = lines.findIndex((line, index) => index > 0 && !isInternalFrame(line));
	if (firstOriginIndex <= 0) return stack;
	return [lines[0], ...lines.slice(firstOriginIndex)].join("\n");
}
function cloneActiveQuerySubscriptionTrace(trace) {
	return {
		...trace,
		branches: [...trace.branches]
	};
}
function resolveHopOutputTable(schema, startTable, hops) {
	if (hops.length === 0) return startTable;
	const relations = analyzeRelations(schema);
	let currentTable = startTable;
	for (const hopName of hops) {
		const relation = (relations.get(currentTable) ?? []).find((candidate) => candidate.name === hopName);
		if (!relation) throw new Error(`Unknown relation "${hopName}" on table "${currentTable}"`);
		currentTable = relation.toTable;
	}
	return currentTable;
}
function resolveBuiltRelationOutputTable(schema, relation) {
	if (relation.union) {
		const first = relation.union.inputs[0];
		if (!first) throw new Error("union(...) requires at least one relation.");
		const firstTable = resolveBuiltRelationOutputTable(schema, first);
		for (const input of relation.union.inputs.slice(1)) if (resolveBuiltRelationOutputTable(schema, input) !== firstTable) throw new Error("union(...) requires all relations to output the same table.");
		return firstTable;
	}
	const seedTable = relation.gather?.seed ? resolveBuiltRelationOutputTable(schema, relation.gather.seed) : relation.table;
	if (!seedTable) throw new Error("gather(...) seed relation is missing table metadata.");
	const hops = relation.hops ?? [];
	return hops.length > 0 ? resolveHopOutputTable(schema, seedTable, hops) : seedTable;
}
function resolveBuiltQueryOutputTable(schema, builtQuery) {
	if (builtQuery.gather?.seed) {
		const gatherTable = resolveBuiltRelationOutputTable(schema, builtQuery.gather.seed);
		return builtQuery.hops.length > 0 ? resolveHopOutputTable(schema, gatherTable, builtQuery.hops) : gatherTable;
	}
	return builtQuery.hops.length > 0 ? resolveHopOutputTable(schema, builtQuery.table, builtQuery.hops) : builtQuery.table;
}
function resolveSchemaWithTable(preferredSchema, fallbackSchema, tableName) {
	if (preferredSchema[tableName]) return preferredSchema;
	return typeof fallbackSchema === "function" ? fallbackSchema() : fallbackSchema;
}
function createRuntimeSchemaResolver(getRuntimeSchema) {
	let cachedRuntimeSchema;
	return {
		get: () => {
			if (!cachedRuntimeSchema) cachedRuntimeSchema = getRuntimeSchema();
			return cachedRuntimeSchema;
		},
		peek: () => cachedRuntimeSchema
	};
}
function assertTableBelongsToClient(table, expectedClient, resolveClient, operation) {
	if (resolveClient(table._schema) === expectedClient) return;
	throw new Error(`${operation} is bound to the client chosen by the first table used and cannot be used with table "${table._table}" from a different schema/client.`);
}
var dbTransactionBindings = /* @__PURE__ */ new WeakMap();
var dbDirectBatchBindings = /* @__PURE__ */ new WeakMap();
function getDbTransactionBinding(transaction, operation) {
	const binding = dbTransactionBindings.get(transaction);
	if (!binding) throw new Error(`DbTransaction.${operation}() requires at least one table operation first`);
	return binding;
}
function getDbDirectBatchBinding(batch, operation) {
	const binding = dbDirectBatchBindings.get(batch);
	if (!binding) throw new Error(`DbDirectBatch.${operation}() requires at least one table operation first`);
	return binding;
}
function transformOutputRow(source, row) {
	return transformOutputColumns(source, row);
}
function transformOutputColumns(source, row) {
	if (!source._columnTransforms || typeof row !== "object" || row === null) return row;
	const transformed = { ...row };
	for (const [column, transform] of Object.entries(source._columnTransforms)) if (column in transformed) transformed[column] = transform.from(transformed[column]);
	return transformed;
}
function transformInsertInput(table, data) {
	return transformInputColumns(table, data);
}
function transformUpdateInput(table, data) {
	return transformInputColumns(table, data);
}
function transformInputColumns(table, data) {
	if (!table._columnTransforms) return data;
	const transformed = { ...data };
	for (const [column, transform] of Object.entries(table._columnTransforms)) if (column in transformed) transformed[column] = transform.to(transformed[column]);
	return transformed;
}
/**
* Transactions group a set of writes that should settle together after an authority validates them.
*
* Data read and written through this transaction is scoped to it, and will only be
* globally visible once it's committed using {@link DbTransaction.commit} and
* accepted by the authority.
*/
var DbTransaction = class {
	resolveClient;
	beginRuntimeTransaction;
	committed = false;
	constructor(resolveClient, beginRuntimeTransaction) {
		this.resolveClient = resolveClient;
		this.beginRuntimeTransaction = beginRuntimeTransaction;
	}
	ensureActive() {
		if (this.committed) {
			const batchId = dbTransactionBindings.get(this)?.runtimeTransaction.batchId() ?? "unbound";
			throw new Error(`Transaction ${batchId} is already committed`);
		}
	}
	bindTable(table, operation) {
		const existingBinding = dbTransactionBindings.get(this);
		if (existingBinding) {
			assertTableBelongsToClient(table, existingBinding.client, this.resolveClient, operation);
			return existingBinding;
		}
		const client = this.resolveClient(table._schema);
		const binding = {
			client,
			runtimeTransaction: this.beginRuntimeTransaction(client)
		};
		dbTransactionBindings.set(this, binding);
		return binding;
	}
	bindQuery(query) {
		return this.bindTable(query, "DbTransaction");
	}
	requireRuntimeTransaction(operation) {
		return getDbTransactionBinding(this, operation).runtimeTransaction;
	}
	batchId() {
		return this.requireRuntimeTransaction("batchId").batchId();
	}
	/**
	* Commit the transaction. Data will be globally visible once it's accepted by the authority.
	*/
	commit() {
		const runtimeTransaction = this.requireRuntimeTransaction("commit");
		this.committed = true;
		return runtimeTransaction.commit();
	}
	/**
	* Insert a new row into a table.
	*
	* The insert is scoped to this transaction, and will only be globally visible
	* once it's committed with {@link DbTransaction.commit}.
	*/
	insert(table, data, options) {
		this.ensureActive();
		this.bindTable(table, "DbTransaction");
		const values = toInsertRecord(transformInsertInput(table, data), table._schema, table._table);
		const runtimeTransaction = this.requireRuntimeTransaction("insert");
		return transformOutputRow(table, transformRow(options ? runtimeTransaction.create(table._table, values, options) : runtimeTransaction.create(table._table, values), table._schema, table._table));
	}
	/**
	* Create or update a row with a caller-supplied id.
	*
	* The upsert is scoped to this transaction, and will only be globally visible
	* once it's committed with {@link DbTransaction.commit}.
	*/
	upsert(table, data, options) {
		this.ensureActive();
		this.bindTable(table, "DbTransaction");
		const values = toUpdateRecord(transformUpdateInput(table, data), table._schema, table._table);
		this.requireRuntimeTransaction("upsert").upsert(table._table, values, options);
	}
	/**
	* Update an existing row in a table.
	*
	* The update is scoped to this transaction, and will only be globally visible
	* once it's committed with {@link DbTransaction.commit}.
	*/
	update(table, id, data) {
		this.ensureActive();
		this.bindTable(table, "DbTransaction");
		const updates = toUpdateRecord(transformUpdateInput(table, data), table._schema, table._table);
		this.requireRuntimeTransaction("update").update(id, updates);
	}
	/**
	* Delete an existing row from a table.
	*
	* The delete is scoped to this transaction, and will only be globally visible
	* once it's committed with {@link DbTransaction.commit}.
	*/
	delete(table, id) {
		this.ensureActive();
		const { runtimeTransaction } = this.bindTable(table, "DbTransaction");
		runtimeTransaction.delete(id);
	}
	/**
	* Execute a query and return all matching rows.
	*
	* Read data is scoped to this transaction.
	*/
	async all(query, options) {
		this.ensureActive();
		const { client, runtimeTransaction } = this.bindQuery(query);
		const runtimeSchema = normalizeRuntimeSchema(client.getSchema());
		const builderJson = query._build();
		const builtQuery = normalizeBuiltQuery(JSON.parse(builderJson), query._table);
		const planningSchema = resolveSchemaWithTable(query._schema, runtimeSchema, builtQuery.table);
		const outputTable = resolveBuiltQueryOutputTable(planningSchema, builtQuery);
		const outputSchema = resolveSchemaWithTable(query._schema, runtimeSchema, outputTable);
		return transformRows(await runtimeTransaction.query(translateQuery(builderJson, planningSchema), options), outputSchema, outputTable, outputTable !== builtQuery.table ? {} : builtQuery.includes, builtQuery.select).map((row) => transformOutputRow(outputTable === builtQuery.table ? query : {}, row));
	}
	/**
	* Execute a query and return the first matching row, or null.
	*
	* Read data is scoped to this transaction.
	*/
	async one(query, options) {
		return (await this.all(query, options))[0] ?? null;
	}
	localBatchRecord(batchId = this.batchId()) {
		return this.requireRuntimeTransaction("localBatchRecord").localBatchRecord(batchId);
	}
	localBatchRecords() {
		return this.requireRuntimeTransaction("localBatchRecords").localBatchRecords();
	}
	acknowledgeRejectedBatch(batchId = this.batchId()) {
		return this.requireRuntimeTransaction("acknowledgeRejectedBatch").acknowledgeRejectedBatch(batchId);
	}
};
/**
* Direct batches group a set of writes that should settle immediately, without an authority,
* while still being part of the same batch.
*
* Data written through this direct batch is globally visible immediately.
*/
var DbDirectBatch = class {
	resolveClient;
	beginRuntimeBatch;
	committedHandle = null;
	constructor(resolveClient, beginRuntimeBatch) {
		this.resolveClient = resolveClient;
		this.beginRuntimeBatch = beginRuntimeBatch;
	}
	bindTable(table, operation) {
		const existingBinding = dbDirectBatchBindings.get(this);
		if (existingBinding) {
			assertTableBelongsToClient(table, existingBinding.client, this.resolveClient, operation);
			return existingBinding;
		}
		const client = this.resolveClient(table._schema);
		const binding = {
			client,
			runtimeBatch: this.beginRuntimeBatch(client)
		};
		dbDirectBatchBindings.set(this, binding);
		return binding;
	}
	requireRuntimeBatch(operation) {
		return getDbDirectBatchBinding(this, operation).runtimeBatch;
	}
	batchId() {
		return this.requireRuntimeBatch("batchId").batchId();
	}
	ensureActive() {
		if (this.committedHandle) {
			const batchId = dbDirectBatchBindings.get(this)?.runtimeBatch.batchId() ?? "unbound";
			throw new Error(`Direct batch ${batchId} is already committed`);
		}
	}
	/**
	* Commit the direct batch. Data is visible optimistically immediately and can
	* be waited on through the returned handle.
	*/
	commit() {
		if (this.committedHandle) return this.committedHandle;
		const handle = this.requireRuntimeBatch("commit").commit();
		this.committedHandle = handle;
		return handle;
	}
	insert(table, data, options) {
		this.ensureActive();
		this.bindTable(table, "DbDirectBatch");
		const values = toInsertRecord(transformInsertInput(table, data), table._schema, table._table);
		const runtimeBatch = this.requireRuntimeBatch("insert");
		return transformOutputRow(table, transformRow(options ? runtimeBatch.create(table._table, values, options) : runtimeBatch.create(table._table, values), table._schema, table._table));
	}
	upsert(table, data, options) {
		this.ensureActive();
		this.bindTable(table, "DbDirectBatch");
		const values = toUpdateRecord(transformUpdateInput(table, data), table._schema, table._table);
		this.requireRuntimeBatch("upsert").upsert(table._table, values, options);
	}
	update(table, id, data) {
		this.ensureActive();
		this.bindTable(table, "DbDirectBatch");
		const updates = toUpdateRecord(transformUpdateInput(table, data), table._schema, table._table);
		this.requireRuntimeBatch("update").update(id, updates);
	}
	delete(table, id) {
		this.ensureActive();
		const { runtimeBatch } = this.bindTable(table, "DbDirectBatch");
		runtimeBatch.delete(id);
	}
	localBatchRecord(batchId = this.batchId()) {
		return this.requireRuntimeBatch("localBatchRecord").localBatchRecord(batchId);
	}
	localBatchRecords() {
		return this.requireRuntimeBatch("localBatchRecords").localBatchRecords();
	}
	acknowledgeRejectedBatch(batchId = this.batchId()) {
		return this.requireRuntimeBatch("acknowledgeRejectedBatch").acknowledgeRejectedBatch(batchId);
	}
};
function resolveBroadcastChannelCtor() {
	const ctor = globalThis.BroadcastChannel;
	if (typeof ctor !== "function") return null;
	return ctor;
}
function isBinaryPayloadArray(value) {
	return Array.isArray(value) && value.every((entry) => entry instanceof Uint8Array);
}
function isTabSyncMessage(value) {
	if (typeof value !== "object" || value === null) return false;
	const message = value;
	if (message.type === "follower-sync") return typeof message.fromTabId === "string" && typeof message.toLeaderTabId === "string" && typeof message.term === "number" && isBinaryPayloadArray(message.payload);
	if (message.type === "leader-sync") return typeof message.fromLeaderTabId === "string" && typeof message.toTabId === "string" && typeof message.term === "number" && isBinaryPayloadArray(message.payload);
	if (message.type === "follower-close") return typeof message.fromTabId === "string" && typeof message.toLeaderTabId === "string" && typeof message.term === "number";
	if (message.type === "storage-reset-request") return typeof message.requestId === "string" && typeof message.fromTabId === "string" && (typeof message.toLeaderTabId === "string" || message.toLeaderTabId === null) && typeof message.term === "number";
	if (message.type === "storage-reset-begin") return typeof message.requestId === "string" && typeof message.coordinatorTabId === "string" && typeof message.term === "number";
	if (message.type === "storage-reset-ack") return typeof message.requestId === "string" && typeof message.fromTabId === "string" && typeof message.namespace === "string";
	if (message.type === "storage-reset-finished") return typeof message.requestId === "string" && typeof message.success === "boolean" && (typeof message.errorMessage === "string" || message.errorMessage === void 0);
	return false;
}
function isLeaderDebugEnabled() {
	if (globalThis.__JAZZ_LEADER_DEBUG__ === true) return true;
	try {
		if (typeof localStorage !== "undefined") return localStorage.getItem("jazz:leader-debug") === "1";
	} catch {}
	return false;
}
/**
* High-level database interface for typed queries and mutations.
*
* Usage:
* ```typescript
* const db = await createDb({ appId: "my-app", driver });
*
* // Mutations
* const { value: inserted } = db.insert(app.todos, { title: "Buy milk", done: false });
* db.update(app.todos, inserted.id, { done: true });
* db.delete(app.todos, inserted.id);
*
* // Async queries (need storage I/O)
* const todos = await db.all(app.todos.where({ done: false }));
* const todo = await db.one(app.todos.where({ id: inserted.id }));
*
* // Subscriptions
* const unsubscribe = db.subscribeAll(app.todos, (delta) => {
*   console.log("All todos:", delta.all);
*   console.log("Changes:", delta.delta);
* });
* ```
*/
var Db = class Db {
	clients = /* @__PURE__ */ new Map();
	config;
	wasmModule;
	authStateStore;
	workerBridge = null;
	worker = null;
	bridgeReady = null;
	primaryDbName = null;
	workerDbName = null;
	leaderElection = null;
	leaderElectionUnsubscribe = null;
	tabRole = "follower";
	tabId = null;
	currentLeaderTabId = null;
	currentLeaderTerm = 0;
	syncChannel = null;
	leaderPeerIds = /* @__PURE__ */ new Set();
	activeRemoteLeaderTabId = null;
	workerReconfigure = Promise.resolve();
	activeStorageReset = null;
	storageResetCoordinator = null;
	_localFirstSecret = null;
	localFirstRefreshTimer = null;
	isShuttingDown = false;
	shutdownPromise = null;
	lifecycleHooksAttached = false;
	activeQuerySubscriptionTraces = /* @__PURE__ */ new Map();
	activeQuerySubscriptionTraceListeners = /* @__PURE__ */ new Set();
	/**
	* Listeners attached with {@link Db.onMutationError} that are notified when a write operation
	* (insert, update, delete) is rejected. Errors from all {@link Db.clients} (including those
	* added after the listeners are attached) are forwarded to all Db listeners.
	*/
	mutationErrorListeners = /* @__PURE__ */ new Set();
	/**
	* Unsubscribers for {@link Db.clients}'s {@link JazzClient.onMutationError} listeners
	*/
	clientMutationErrorUnsubscribers = /* @__PURE__ */ new Map();
	nextActiveQuerySubscriptionTraceId = 1;
	onSyncChannelMessage = (event) => {
		this.handleSyncChannelMessage(event.data);
	};
	onVisibilityChange = () => {
		if (typeof document === "undefined") return;
		const hidden = document.visibilityState === "hidden";
		this.sendLifecycleHint(hidden ? "visibility-hidden" : "visibility-visible");
	};
	onPageHide = () => {
		this.sendLifecycleHint("pagehide");
	};
	onPageFreeze = () => {
		this.sendLifecycleHint("freeze");
	};
	onPageResume = () => {
		this.sendLifecycleHint("resume");
	};
	/**
	* Protected constructor - use createDb() in regular app code.
	*/
	constructor(config, wasmModule, authStateOptions) {
		this.config = config;
		this.wasmModule = wasmModule;
		this.authStateStore = createAuthStateStore(config, authStateOptions);
	}
	/** @internal Store the seed used for local-first auth and schedule token refresh. */
	initLocalFirstAuth(seed, ttlSeconds) {
		this._localFirstSecret = seed;
		this.scheduleLocalFirstRefresh(ttlSeconds);
	}
	scheduleLocalFirstRefresh(ttlSeconds) {
		if (this.localFirstRefreshTimer) clearTimeout(this.localFirstRefreshTimer);
		const refreshMs = ttlSeconds * 800;
		this.localFirstRefreshTimer = setTimeout(() => {
			this.refreshLocalFirstToken();
		}, refreshMs);
	}
	refreshLocalFirstToken() {
		if (!this._localFirstSecret || this.isShuttingDown) return;
		try {
			const wasmModule = this.wasmModule;
			if (!wasmModule) return;
			const ttlSeconds = 3600;
			const nowSeconds = BigInt(Math.floor(Date.now() / 1e3));
			const newToken = wasmModule.WasmRuntime.mintJazzSelfSignedToken(this._localFirstSecret, "urn:jazz:local-first", this.config.appId, BigInt(ttlSeconds), nowSeconds);
			this.updateAuthToken(newToken);
			this.scheduleLocalFirstRefresh(ttlSeconds);
		} catch (e) {
			console.error("Failed to refresh local-first token:", e);
		}
	}
	markUnauthenticated(reason) {
		this.authStateStore.markUnauthenticated(reason);
	}
	applyAuthUpdate(token) {
		const jwtToken = token ?? void 0;
		const previousToken = this.config.jwtToken;
		const previousState = this.authStateStore.getState();
		const nextState = this.authStateStore.applyJwtToken(jwtToken);
		if (!(previousToken !== jwtToken) && nextState === previousState) return false;
		this.config.jwtToken = jwtToken;
		for (const client of this.clients.values()) client.updateAuthToken(jwtToken);
		this.workerBridge?.updateAuth({ jwtToken });
		return true;
	}
	applyCookieSessionUpdate(session) {
		const cookieSession = session ?? void 0;
		const previousSession = this.config.cookieSession;
		const previousState = this.authStateStore.getState();
		const nextState = this.authStateStore.applyCookieSession(cookieSession);
		if (!(JSON.stringify(previousSession) !== JSON.stringify(cookieSession)) && nextState === previousState) return false;
		this.config.cookieSession = cookieSession;
		for (const client of this.clients.values()) client.updateCookieSession(cookieSession);
		this.workerBridge?.updateAuth({ jwtToken: this.config.jwtToken });
		return true;
	}
	/**
	* Create a Db instance with pre-loaded WASM module.
	* @internal Use createDb() instead.
	*/
	static async create(config) {
		return new Db(config, await loadWasmModule(config.runtimeSources));
	}
	/**
	* Create a Db instance backed by a dedicated worker with OPFS persistence.
	*
	* The main thread runs an in-memory WASM runtime.
	* The worker runs a persistent WASM runtime (OPFS).
	* WorkerBridge wires them together via postMessage.
	*
	* @internal Use createDb() instead — it auto-detects browser.
	*/
	static async createWithWorker(config) {
		const db = new Db(config, await loadWasmModule(config.runtimeSources));
		if (resolveStorageDriver(config.driver).type !== "persistent") throw new Error("Worker-backed Db requires driver.type='persistent'");
		db.primaryDbName = resolveDefaultPersistentDbName(config);
		db.workerDbName = db.primaryDbName;
		try {
			const election = new TabLeaderElection({
				appId: config.appId,
				dbName: db.primaryDbName
			});
			db.leaderElection = election;
			election.start();
			let initialLeader = null;
			try {
				initialLeader = await election.waitForInitialLeader(1600);
			} catch {
				initialLeader = election.snapshot();
			}
			db.adoptLeaderSnapshot(initialLeader);
			db.workerDbName = Db.resolveWorkerDbNameForSnapshot(db.primaryDbName, initialLeader);
			db.logLeaderDebug("initial-election");
			db.openSyncChannel();
			db.attachLifecycleHooks();
			db.leaderElectionUnsubscribe = election.onChange((snapshot) => {
				db.onLeaderElectionChange(snapshot);
			});
			db.worker = await Db.spawnWorker(config.runtimeSources);
			return db;
		} catch (error) {
			db.closeSyncChannel();
			db.detachLifecycleHooks();
			if (db.leaderElectionUnsubscribe) {
				db.leaderElectionUnsubscribe();
				db.leaderElectionUnsubscribe = null;
			}
			if (db.leaderElection) {
				db.leaderElection.stop();
				db.leaderElection = null;
			}
			throw error;
		}
	}
	/**
	* Get or create a JazzClient for the given schema.
	* Synchronous because WASM module is pre-loaded.
	*
	* In worker mode, the first call per schema also initializes the
	* WorkerBridge (async). Subsequent calls are sync.
	*/
	getClient(schema) {
		if (!this.wasmModule) throw new Error("Db runtime module is not initialized for this Db implementation");
		const runtimeSchema = shouldBypassLocalPolicies(this.config) ? getPolicyStrippedSchema(schema) : schema;
		const key = getRuntimeSchemaCacheKey(runtimeSchema);
		if (!this.clients.has(key)) {
			setGlobalWasmLogLevel(this.config.logLevel);
			const client = JazzClient.connectSync(this.wasmModule, {
				appId: this.config.appId,
				schema: runtimeSchema,
				driver: this.config.driver,
				serverUrl: this.worker ? void 0 : this.config.serverUrl,
				env: this.config.env,
				userBranch: this.config.userBranch,
				jwtToken: this.config.jwtToken,
				cookieSession: this.config.cookieSession,
				adminSecret: this.config.adminSecret,
				tier: this.worker ? void 0 : "local",
				defaultDurabilityTier: this.worker ? void 0 : this.config.serverUrl ? "edge" : void 0
			}, {
				useBinaryEncoding: this.worker !== null,
				onAuthFailure: (reason) => {
					this.markUnauthenticated(reason);
				}
			});
			if (this.worker && !this.workerBridge) this.attachWorkerBridge(key, client);
			this.attachMutationErrorHandler(client);
			if (!this.worker && this.config.serverUrl) client.connectTransport(this.config.serverUrl, {
				jwt_token: this.config.jwtToken,
				admin_secret: this.config.adminSecret
			});
			this.attachMutationErrorHandler(client);
			this.clients.set(key, client);
		}
		return this.clients.get(key);
	}
	/**
	* Attaches a mutation error handler to the given client, ensuring all listeners in
	* {@link Db.mutationErrorListeners} are notified.
	*/
	attachMutationErrorHandler(client) {
		if (this.mutationErrorListeners.size === 0) return;
		if (this.clientMutationErrorUnsubscribers.has(client)) return;
		this.clientMutationErrorUnsubscribers.set(client, client.onMutationError((event) => {
			for (const listener of this.mutationErrorListeners) listener(event);
		}));
	}
	/**
	* Wait for the worker bridge to be initialized (if in worker mode).
	* No-op if not using a worker.
	*/
	async ensureBridgeReady() {
		await this.workerReconfigure;
		if (this.bridgeReady) await this.bridgeReady;
	}
	async ensureQueryReady(options) {
		await this.ensureBridgeReady();
		if (!this.workerBridge || !this.config.serverUrl) return;
		if (!options?.tier || options.tier === "local") return;
		await this.workerBridge.waitForUpstreamServerConnection();
	}
	attachWorkerBridge(schemaJson, client) {
		if (!this.worker) throw new Error("Cannot attach worker bridge without an active worker");
		const bridge = new WorkerBridge(this.worker, client.getRuntime());
		this.leaderPeerIds.clear();
		bridge.onPeerSync((batch) => {
			this.handleWorkerPeerSync(batch);
		});
		this.applyBridgeRoutingForCurrentLeader(bridge, false);
		bridge.onAuthFailure((reason) => {
			this.markUnauthenticated(reason);
		});
		this.workerBridge = bridge;
		const bridgeReady = bridge.init(this.buildWorkerBridgeOptions(schemaJson)).then(() => void 0);
		bridgeReady.catch(() => void 0);
		this.bridgeReady = bridgeReady;
	}
	buildWorkerBridgeOptions(schemaJson) {
		const driver = resolveStorageDriver(this.config.driver);
		if (driver.type !== "persistent") throw new Error("Worker bridge is only available for driver.type='persistent'");
		const locationHref = typeof location !== "undefined" ? location.href : void 0;
		const configRuntimeSources = this.config.runtimeSources;
		const envWasmUrl = typeof process !== "undefined" && process.env ? process.env.NEXT_PUBLIC_JAZZ_WASM_URL : void 0;
		const runtimeSources = !!configRuntimeSources?.wasmUrl || !!configRuntimeSources?.baseUrl || !!configRuntimeSources?.workerUrl || !!resolveRuntimeConfigSyncInitInput(configRuntimeSources) || !envWasmUrl || typeof location === "undefined" ? configRuntimeSources : {
			...configRuntimeSources,
			wasmUrl: new URL(envWasmUrl, location.href).href
		};
		let fallbackWasmUrl;
		if (!runtimeSources?.workerUrl && !runtimeSources?.baseUrl && !runtimeSources?.wasmUrl) {
			if (!resolveRuntimeConfigSyncInitInput(runtimeSources)) fallbackWasmUrl = resolveWorkerBootstrapWasmUrl(import.meta.url, locationHref, runtimeSources) ?? void 0;
		}
		return {
			schemaJson,
			appId: this.config.appId,
			env: this.config.env ?? "dev",
			userBranch: this.config.userBranch ?? "main",
			dbName: this.workerDbName ?? driver.dbName ?? this.config.appId,
			serverUrl: this.config.serverUrl,
			jwtToken: this.config.jwtToken,
			adminSecret: this.config.adminSecret,
			runtimeSources,
			fallbackWasmUrl,
			logLevel: this.config.logLevel
		};
	}
	adoptLeaderSnapshot(snapshot) {
		this.tabRole = snapshot.role;
		this.tabId = snapshot.tabId;
		this.currentLeaderTabId = snapshot.leaderTabId;
		this.currentLeaderTerm = snapshot.term;
	}
	openSyncChannel() {
		if (this.syncChannel || !this.primaryDbName) return;
		const ChannelCtor = resolveBroadcastChannelCtor();
		if (!ChannelCtor) {
			this.logLeaderDebug("sync-channel-unavailable");
			return;
		}
		const channelName = `jazz-tab-sync:${this.config.appId}:${this.primaryDbName}`;
		this.syncChannel = new ChannelCtor(channelName);
		this.syncChannel.addEventListener("message", this.onSyncChannelMessage);
		this.logLeaderDebug("sync-channel-open", { channelName });
	}
	closeSyncChannel() {
		if (!this.syncChannel) return;
		this.syncChannel.removeEventListener("message", this.onSyncChannelMessage);
		this.syncChannel.close();
		this.syncChannel = null;
		this.logLeaderDebug("sync-channel-close");
	}
	postSyncChannelMessage(message) {
		this.syncChannel?.postMessage(message);
	}
	getOrCreateStorageResetContext(requestId, initiatedBySelf) {
		if (this.activeStorageReset?.requestId === requestId) {
			if (initiatedBySelf) this.activeStorageReset.initiatedBySelf = true;
			return this.activeStorageReset;
		}
		const completion = createDeferred();
		completion.promise.catch(() => void 0);
		const context = {
			requestId,
			initiatedBySelf,
			coordinatorTabId: null,
			begun: false,
			completed: false,
			preparePromise: null,
			completion
		};
		this.activeStorageReset = context;
		return context;
	}
	clearStorageResetContext(requestId) {
		if (this.activeStorageReset?.requestId === requestId) this.activeStorageReset = null;
		if (this.storageResetCoordinator?.requestId === requestId) this.storageResetCoordinator = null;
	}
	resolveStorageResetContext(context) {
		if (context.completed) return;
		context.completed = true;
		context.completion.resolve();
		this.clearStorageResetContext(context.requestId);
	}
	rejectStorageResetContext(context, error) {
		if (context.completed) return;
		context.completed = true;
		context.completion.reject(toError(error, "Browser storage reset failed"));
		this.clearStorageResetContext(context.requestId);
	}
	async prepareForStorageReset(context, coordinatorTabId) {
		if (context.preparePromise) return await context.preparePromise;
		context.begun = true;
		context.coordinatorTabId = coordinatorTabId;
		context.preparePromise = (async () => {
			if (this.bridgeReady) await this.bridgeReady;
			const namespace = this.currentWorkerNamespace();
			await this.shutdownWorkerAndClientsForStorageReset();
			if (this.tabId && coordinatorTabId !== this.tabId) this.postSyncChannelMessage({
				type: "storage-reset-ack",
				requestId: context.requestId,
				fromTabId: this.tabId,
				namespace
			});
			return namespace;
		})();
		return await context.preparePromise;
	}
	async waitForStorageResetQuiescence(coordinator) {
		while (true) {
			const now = Date.now();
			const elapsed = now - coordinator.startedAtMs;
			const idleMs = now - coordinator.lastAckAtMs;
			if (elapsed >= STORAGE_RESET_DISCOVERY_WINDOW_MS && idleMs >= STORAGE_RESET_ACK_QUIET_MS) return;
			await sleep(25);
		}
	}
	async collectStorageResetNamespaces(extraNamespaces) {
		const namespaces = /* @__PURE__ */ new Set();
		const primaryDbName = this.primaryDbName;
		if (primaryDbName) namespaces.add(primaryDbName);
		for (const namespace of extraNamespaces) namespaces.add(namespace);
		if (!primaryDbName) return [...namespaces];
		const rootWithEntries = await navigator.storage.getDirectory();
		if (typeof rootWithEntries.entries !== "function") return [...namespaces];
		const suffix = ".opfsbtree";
		const fallbackPrefix = `${primaryDbName}__fallback__`;
		for await (const [name] of rootWithEntries.entries()) {
			if (!name.endsWith(suffix)) continue;
			const namespace = name.slice(0, -10);
			if (namespace === primaryDbName || namespace.startsWith(fallbackPrefix)) namespaces.add(namespace);
		}
		return [...namespaces];
	}
	async resumeAfterStorageReset() {
		if (this.worker || this.isShuttingDown) return;
		this.worker = await Db.spawnWorker(this.config.runtimeSources);
	}
	async runSingleTabStorageReset(context) {
		const coordinatorTabId = this.tabId ?? "single-tab-reset";
		let resultError = null;
		try {
			const namespace = await this.prepareForStorageReset(context, coordinatorTabId);
			const namespaces = await this.collectStorageResetNamespaces([namespace]);
			for (const candidate of namespaces) await this.removeOpfsNamespaceFile(candidate);
		} catch (error) {
			resultError = toError(error, "Browser storage reset failed");
		}
		try {
			await this.resumeAfterStorageReset();
		} catch (error) {
			if (!resultError) resultError = toError(error, "Failed to restart browser worker after storage reset");
		}
		if (resultError) throw resultError;
	}
	async startStorageResetAsCoordinator(context) {
		if (this.storageResetCoordinator?.requestId === context.requestId) return await (this.storageResetCoordinator.runPromise ?? context.completion.promise);
		if (!this.tabId || this.tabRole !== "leader") throw new Error("Storage reset coordination requires the current tab to be the leader.");
		const coordinator = {
			requestId: context.requestId,
			startedAtMs: Date.now(),
			lastAckAtMs: Date.now(),
			ackedNamespacesByTabId: /* @__PURE__ */ new Map(),
			runPromise: null
		};
		this.storageResetCoordinator = coordinator;
		coordinator.runPromise = (async () => {
			let resultError = null;
			try {
				this.postSyncChannelMessage({
					type: "storage-reset-begin",
					requestId: context.requestId,
					coordinatorTabId: this.tabId,
					term: this.currentLeaderTerm
				});
				const localNamespace = await this.prepareForStorageReset(context, this.tabId);
				coordinator.ackedNamespacesByTabId.set(this.tabId, localNamespace);
				coordinator.lastAckAtMs = Date.now();
				await this.waitForStorageResetQuiescence(coordinator);
				const namespaces = await this.collectStorageResetNamespaces(coordinator.ackedNamespacesByTabId.values());
				for (const namespace of namespaces) await this.removeOpfsNamespaceFile(namespace);
			} catch (error) {
				resultError = toError(error, "Browser storage reset failed");
			}
			try {
				await this.resumeAfterStorageReset();
			} catch (error) {
				if (!resultError) resultError = toError(error, "Failed to restart browser worker after storage reset");
			}
			this.postSyncChannelMessage({
				type: "storage-reset-finished",
				requestId: context.requestId,
				success: resultError === null,
				...resultError ? { errorMessage: resultError.message } : {}
			});
			if (resultError) throw resultError;
		})().then(() => {
			this.resolveStorageResetContext(context);
		}).catch((error) => {
			this.rejectStorageResetContext(context, error);
		}).finally(() => {
			if (this.storageResetCoordinator?.requestId === context.requestId) this.storageResetCoordinator = null;
		});
		await coordinator.runPromise;
	}
	async requestCoordinatedStorageReset() {
		if (!this.syncChannel || !this.tabId) {
			const requestId = createOperationId("storage-reset");
			const context = this.getOrCreateStorageResetContext(requestId, true);
			try {
				await this.runSingleTabStorageReset(context);
				this.resolveStorageResetContext(context);
			} catch (error) {
				this.rejectStorageResetContext(context, error);
			}
			await context.completion.promise;
			return;
		}
		if (this.activeStorageReset) {
			await this.activeStorageReset.completion.promise;
			return;
		}
		const requestId = createOperationId("storage-reset");
		const context = this.getOrCreateStorageResetContext(requestId, true);
		if (this.tabRole === "leader") {
			await this.startStorageResetAsCoordinator(context);
			return;
		}
		const deadline = Date.now() + STORAGE_RESET_REQUEST_TIMEOUT_MS;
		while (!context.begun) {
			if (this.tabRole === "leader") {
				await this.startStorageResetAsCoordinator(context);
				return;
			}
			this.postSyncChannelMessage({
				type: "storage-reset-request",
				requestId,
				fromTabId: this.tabId,
				toLeaderTabId: this.currentLeaderTabId,
				term: this.currentLeaderTerm
			});
			if (await Promise.race([context.completion.promise.then(() => true, () => true), sleep(STORAGE_RESET_REQUEST_RETRY_MS).then(() => false)])) {
				await context.completion.promise;
				return;
			}
			if (Date.now() >= deadline) {
				const error = /* @__PURE__ */ new Error("Timed out waiting for the leader tab to begin browser storage reset.");
				this.rejectStorageResetContext(context, error);
				throw error;
			}
		}
		await context.completion.promise;
	}
	attachLifecycleHooks() {
		if (this.lifecycleHooksAttached) return;
		if (typeof window === "undefined" || typeof document === "undefined") return;
		document.addEventListener("visibilitychange", this.onVisibilityChange);
		window.addEventListener("pagehide", this.onPageHide);
		document.addEventListener("freeze", this.onPageFreeze);
		document.addEventListener("resume", this.onPageResume);
		this.lifecycleHooksAttached = true;
	}
	detachLifecycleHooks() {
		if (!this.lifecycleHooksAttached) return;
		if (typeof window === "undefined" || typeof document === "undefined") return;
		document.removeEventListener("visibilitychange", this.onVisibilityChange);
		window.removeEventListener("pagehide", this.onPageHide);
		document.removeEventListener("freeze", this.onPageFreeze);
		document.removeEventListener("resume", this.onPageResume);
		this.lifecycleHooksAttached = false;
	}
	sendLifecycleHint(event) {
		if (this.isShuttingDown || !this.worker) return;
		this.logLeaderDebug("lifecycle-hint", { event });
		if (this.workerBridge) {
			this.workerBridge.sendLifecycleHint(event);
			return;
		}
		this.worker.postMessage({
			type: "lifecycle-hint",
			event,
			sentAtMs: Date.now()
		});
	}
	logLeaderDebug(event, extra) {
		if (!isLeaderDebugEnabled()) return;
		console.info("[db:leader]", event, {
			tabId: this.tabId,
			role: this.tabRole,
			term: this.currentLeaderTerm,
			leaderTabId: this.currentLeaderTabId,
			workerDbName: this.workerDbName,
			...extra
		});
	}
	handleSyncChannelMessage(raw) {
		if (this.isShuttingDown || !this.tabId) return;
		if (!isTabSyncMessage(raw)) return;
		switch (raw.type) {
			case "storage-reset-request":
				this.handleStorageResetRequest(raw);
				return;
			case "storage-reset-begin":
				this.handleStorageResetBegin(raw);
				return;
			case "storage-reset-ack":
				this.handleStorageResetAck(raw);
				return;
			case "storage-reset-finished":
				this.handleStorageResetFinished(raw);
				return;
			case "follower-sync":
				this.handleFollowerSync(raw);
				return;
			case "leader-sync":
				this.handleLeaderSync(raw);
				return;
			case "follower-close":
				this.handleFollowerClose(raw);
				return;
		}
	}
	handleStorageResetRequest(message) {
		if (this.tabRole !== "leader") return;
		if (!this.tabId) return;
		if (message.fromTabId === this.tabId) return;
		if (message.toLeaderTabId && message.toLeaderTabId !== this.tabId) return;
		if (message.term !== this.currentLeaderTerm) return;
		if (this.activeStorageReset && this.activeStorageReset.requestId !== message.requestId) return;
		const context = this.getOrCreateStorageResetContext(message.requestId, false);
		this.startStorageResetAsCoordinator(context).catch(() => void 0);
	}
	handleStorageResetBegin(message) {
		if (!this.currentLeaderTabId) return;
		if (message.coordinatorTabId !== this.currentLeaderTabId) return;
		if (message.term !== this.currentLeaderTerm) return;
		if (message.coordinatorTabId === this.tabId) return;
		if (this.activeStorageReset && this.activeStorageReset.requestId !== message.requestId) return;
		const context = this.getOrCreateStorageResetContext(message.requestId, false);
		context.begun = true;
		context.coordinatorTabId = message.coordinatorTabId;
		this.prepareForStorageReset(context, message.coordinatorTabId).catch((error) => {
			this.rejectStorageResetContext(context, error);
		});
	}
	handleStorageResetAck(message) {
		const coordinator = this.storageResetCoordinator;
		if (!coordinator || coordinator.requestId !== message.requestId) return;
		coordinator.ackedNamespacesByTabId.set(message.fromTabId, message.namespace);
		coordinator.lastAckAtMs = Date.now();
	}
	handleStorageResetFinished(message) {
		const context = this.activeStorageReset;
		if (!context || context.requestId !== message.requestId || context.completed) return;
		(async () => {
			let resultError = message.success ? null : new Error(message.errorMessage ?? "Browser storage reset failed");
			try {
				await this.resumeAfterStorageReset();
			} catch (error) {
				if (!resultError) resultError = toError(error, "Failed to restart browser worker after storage reset");
			}
			if (resultError) this.rejectStorageResetContext(context, resultError);
			else this.resolveStorageResetContext(context);
		})();
	}
	handleFollowerSync(message) {
		if (this.tabRole !== "leader") return;
		if (!this.workerBridge) return;
		if (!this.tabId || message.toLeaderTabId !== this.tabId) return;
		if (message.term !== this.currentLeaderTerm) return;
		if (!this.leaderPeerIds.has(message.fromTabId)) {
			this.leaderPeerIds.add(message.fromTabId);
			this.workerBridge.openPeer(message.fromTabId);
			this.logLeaderDebug("peer-open", { peerId: message.fromTabId });
		}
		this.workerBridge.sendPeerSync(message.fromTabId, message.term, message.payload);
	}
	handleLeaderSync(message) {
		if (this.tabRole !== "follower") return;
		if (!this.workerBridge) return;
		if (!this.tabId || message.toTabId !== this.tabId) return;
		if (!this.currentLeaderTabId || message.fromLeaderTabId !== this.currentLeaderTabId) return;
		if (message.term !== this.currentLeaderTerm) return;
		for (const payload of message.payload) this.workerBridge.applyIncomingServerPayload(payload);
	}
	handleFollowerClose(message) {
		if (this.tabRole !== "leader") return;
		if (!this.workerBridge) return;
		if (!this.tabId || message.toLeaderTabId !== this.tabId) return;
		if (message.term !== this.currentLeaderTerm) return;
		if (!this.leaderPeerIds.has(message.fromTabId)) return;
		this.leaderPeerIds.delete(message.fromTabId);
		this.workerBridge.closePeer(message.fromTabId);
		this.logLeaderDebug("peer-close", { peerId: message.fromTabId });
	}
	handleWorkerPeerSync(batch) {
		if (this.isShuttingDown) return;
		if (this.tabRole !== "leader") return;
		if (!this.tabId) return;
		if (batch.term !== this.currentLeaderTerm) return;
		this.postSyncChannelMessage({
			type: "leader-sync",
			fromLeaderTabId: this.tabId,
			toTabId: batch.peerId,
			term: batch.term,
			payload: batch.payload
		});
	}
	sendFollowerClose(leaderTabId, term) {
		if (!leaderTabId || !this.tabId) return;
		if (leaderTabId === this.tabId) return;
		this.logLeaderDebug("follower-close", {
			toLeaderTabId: leaderTabId,
			closeTerm: term
		});
		this.postSyncChannelMessage({
			type: "follower-close",
			fromTabId: this.tabId,
			toLeaderTabId: leaderTabId,
			term
		});
	}
	applyBridgeRoutingForCurrentLeader(bridge, replayConnection) {
		if (this.tabRole === "leader") {
			bridge.setServerPayloadForwarder(null);
			this.activeRemoteLeaderTabId = null;
			this.logLeaderDebug("upstream-mode", { mode: "leader-direct" });
		} else {
			bridge.setServerPayloadForwarder((payload) => {
				if (!this.tabId || !this.currentLeaderTabId) return;
				if (this.currentLeaderTabId === this.tabId) return;
				this.postSyncChannelMessage({
					type: "follower-sync",
					fromTabId: this.tabId,
					toLeaderTabId: this.currentLeaderTabId,
					term: this.currentLeaderTerm,
					payload: [payload]
				});
			});
			this.activeRemoteLeaderTabId = this.currentLeaderTabId;
			this.logLeaderDebug("upstream-mode", {
				mode: "follower-via-leader",
				upstreamLeaderTabId: this.currentLeaderTabId
			});
		}
		if (replayConnection) {
			bridge.replayServerConnection();
			this.logLeaderDebug("upstream-replay");
		}
	}
	onLeaderElectionChange(snapshot) {
		if (this.isShuttingDown || !this.primaryDbName) return;
		const previousRole = this.tabRole;
		const previousLeaderTabId = this.currentLeaderTabId;
		const previousTerm = this.currentLeaderTerm;
		this.adoptLeaderSnapshot(snapshot);
		this.logLeaderDebug("leader-change", {
			previousRole,
			previousLeaderTabId,
			previousTerm
		});
		if (previousRole === "follower" && previousLeaderTabId !== this.currentLeaderTabId) this.sendFollowerClose(previousLeaderTabId, previousTerm);
		const nextDbName = Db.resolveWorkerDbNameForSnapshot(this.primaryDbName, snapshot);
		const dbNameChanged = nextDbName !== this.workerDbName;
		this.workerDbName = nextDbName;
		if (!this.workerBridge) return;
		this.enqueueWorkerReconfigure(async () => {
			if (this.isShuttingDown) return;
			if (dbNameChanged) {
				this.logLeaderDebug("worker-restart", { reason: "db-name-change" });
				await this.restartWorkerWithCurrentDbName();
				return;
			}
			if (this.workerBridge) this.applyBridgeRoutingForCurrentLeader(this.workerBridge, true);
		});
	}
	enqueueWorkerReconfigure(task) {
		this.workerReconfigure = this.workerReconfigure.then(task).catch((error) => {
			console.error("[db] Worker reconfigure failed:", error);
		});
	}
	async restartWorkerWithCurrentDbName() {
		const currentWorker = this.worker;
		if (!currentWorker) return;
		if (this.bridgeReady) await this.bridgeReady;
		if (this.workerBridge) {
			try {
				await this.workerBridge.shutdown(currentWorker);
			} catch {}
			this.workerBridge = null;
		}
		this.bridgeReady = null;
		currentWorker.terminate();
		this.worker = await Db.spawnWorker(this.config.runtimeSources);
		const first = this.clients.entries().next();
		if (!first.done) {
			const [schemaJson, client] = first.value;
			this.attachWorkerBridge(schemaJson, client);
			if (this.bridgeReady) await this.bridgeReady;
		}
	}
	currentWorkerNamespace() {
		const driver = resolveStorageDriver(this.config.driver);
		if (driver.type !== "persistent") throw new Error("Worker namespace is only available for driver.type='persistent'");
		return this.workerDbName ?? driver.dbName ?? this.config.appId;
	}
	async shutdownWorkerAndClientsForStorageReset() {
		const currentWorker = this.worker;
		if (this.workerBridge && currentWorker) try {
			await this.workerBridge.shutdown(currentWorker);
		} catch {}
		this.workerBridge = null;
		this.bridgeReady = null;
		for (const client of this.clients.values()) await client.shutdown();
		this.clients.clear();
		this.leaderPeerIds.clear();
		this.activeRemoteLeaderTabId = null;
		if (currentWorker) currentWorker.terminate();
		this.worker = null;
	}
	async removeOpfsNamespaceFile(namespace) {
		const rootDirectory = await navigator.storage.getDirectory();
		const fileName = `${namespace}.opfsbtree`;
		try {
			await rootDirectory.removeEntry(fileName, { recursive: false });
		} catch (error) {
			const name = error?.name;
			if (name === "NotFoundError") return;
			if (name === "NoModificationAllowedError" || name === "InvalidStateError") throw new Error(`Failed to delete browser storage for "${namespace}" because OPFS is locked by another tab. Close other tabs and retry.`);
			throw new Error(`Failed to delete browser storage for "${namespace}": ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	static resolveWorkerDbNameForSnapshot(primaryDbName, snapshot) {
		if (snapshot.role === "leader") return primaryDbName;
		return `${primaryDbName}__fallback__${snapshot.tabId}`;
	}
	static async spawnWorker(runtimeSources) {
		let worker;
		if (runtimeSources?.workerUrl || runtimeSources?.baseUrl) {
			const locationHref = typeof location !== "undefined" ? location.href : void 0;
			const wasmUrl = resolveRuntimeConfigSyncInitInput(runtimeSources) ? null : resolveWorkerBootstrapWasmUrl(import.meta.url, locationHref, runtimeSources);
			const workerUrl = appendWorkerRuntimeWasmUrl(resolveRuntimeConfigWorkerUrl(import.meta.url, locationHref, runtimeSources), wasmUrl);
			worker = new Worker(workerUrl, { type: "module" });
		} else worker = new Worker(new URL("../worker/jazz-worker.js", import.meta.url), { type: "module" });
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(/* @__PURE__ */ new Error("Worker bootstrap timeout")), 15e3);
			const handler = (event) => {
				if (event.data.type === "ready") {
					clearTimeout(timeout);
					worker.removeEventListener("message", handler);
					resolve();
				} else if (event.data.type === "error") {
					clearTimeout(timeout);
					worker.removeEventListener("message", handler);
					reject(new Error(event.data.message));
				}
			};
			worker.addEventListener("message", handler);
			worker.addEventListener("error", (e) => {
				clearTimeout(timeout);
				reject(/* @__PURE__ */ new Error(`Worker load error: ${e.message}`));
			});
		});
		return worker;
	}
	updateAuthToken(jwtToken) {
		this.applyAuthUpdate(jwtToken);
	}
	updateCookieSession(cookieSession) {
		this.applyCookieSessionUpdate(cookieSession);
	}
	getAuthState() {
		return this.authStateStore.getState();
	}
	/**
	* Mint a short-lived local-first JWT proving possession of the current identity.
	* Returns `null` if the current session is not local-first.
	*/
	async getLocalFirstIdentityProof(options) {
		if (!this._localFirstSecret) return null;
		const wasmModule = this.wasmModule;
		if (!wasmModule) return null;
		const ttl = options?.ttlSeconds ?? 60;
		const audience = options?.audience ?? this.config.appId;
		const nowSeconds = BigInt(Math.floor(Date.now() / 1e3));
		return wasmModule.WasmRuntime.mintJazzSelfSignedToken(this._localFirstSecret, "urn:jazz:local-first", audience, BigInt(ttl), nowSeconds);
	}
	onAuthChanged(listener) {
		return this.authStateStore.onChange((state) => {
			listener(state);
		});
	}
	/**
	* Attach a fallback listener to be notified when a write operation
	* (insert, update, delete) is rejected.
	* This callback is only called if the write error is not surfaced by
	* {@link WriteHandle.wait}.
	* This callback is called even after app restarts (which does not
	* happen with {@link WriteHandle.wait}).
	*/
	onMutationError(listener) {
		this.mutationErrorListeners.add(listener);
		for (const client of this.clients.values()) this.attachMutationErrorHandler(client);
		return () => {
			this.mutationErrorListeners.delete(listener);
			if (this.mutationErrorListeners.size > 0) return;
			for (const unsubscribe of this.clientMutationErrorUnsubscribers.values()) unsubscribe();
			this.clientMutationErrorUnsubscribers.clear();
		};
	}
	getConfig() {
		return structuredClone(this.config);
	}
	setDevMode(enabled) {
		this.config.devMode = enabled;
	}
	/**
	* @internal
	*/
	getActiveQuerySubscriptions() {
		return Array.from(this.activeQuerySubscriptionTraces.values()).filter((trace) => trace.visibility === "public").map(({ visibility: _visibility, ...trace }) => cloneActiveQuerySubscriptionTrace(trace));
	}
	/**
	* @internal
	*/
	onActiveQuerySubscriptionsChange(listener) {
		this.activeQuerySubscriptionTraceListeners.add(listener);
		listener(this.getActiveQuerySubscriptions());
		return () => {
			this.activeQuerySubscriptionTraceListeners.delete(listener);
		};
	}
	/**
	* Insert a new row into a table without waiting for durability.
	*
	* Use {@link WriteResult.wait} to wait for durable confirmation.
	*
	* @param table Table proxy from generated app module
	* @param data Init object with column values
	* @returns Write result containing the inserted row
	*/
	insert(table, data, options) {
		const client = this.getClient(table._schema);
		const values = toInsertRecord(transformInsertInput(table, data), table._schema, table._table);
		return client.create(table._table, values, options).mapValue((row) => transformOutputRow(table, transformRow(row, table._schema, table._table)));
	}
	/**
	* Create or update a row with a caller-supplied id without waiting for durability.
	*
	* Use {@link WriteHandle.wait} to wait for durable confirmation.
	*/
	upsert(table, data, options) {
		const client = this.getClient(table._schema);
		const values = toUpdateRecord(transformUpdateInput(table, data), table._schema, table._table);
		return client.upsert(table._table, values, options);
	}
	/**
	* Update an existing row without waiting for durability.
	*
	* Use {@link WriteHandle.wait} to wait for durable confirmation.
	*/
	update(table, id, data, options) {
		const client = this.getClient(table._schema);
		const updates = toUpdateRecord(transformUpdateInput(table, data), table._schema, table._table);
		return client.update(id, updates, options);
	}
	/**
	* Delete a row without waiting for durability.
	*
	* Use {@link WriteHandle.wait} to wait for durable confirmation.
	*/
	delete(table, id) {
		return this.getClient(table._schema).delete(id);
	}
	/**
	* Begin a new transaction.
	*
	* Use transactions when several writes should settle together after an authority validates them.
	*
	* Use {@link DbTransaction.commit} to commit the transaction.
	*
	* Prefer using {@link Db.transaction} when an explicit commit is not required.
	*/
	beginTransaction() {
		return new DbTransaction((schema) => this.getClient(schema), (client) => client.beginTransactionInternal());
	}
	transaction(callback) {
		const transaction = this.beginTransaction();
		return runInBatch(transaction, callback, () => getDbTransactionBinding(transaction, "result").client);
	}
	/**
	* Begin a new batch.
	*
	* Use a batch when several visible writes should settle together.
	* Call {@link DbDirectBatch.commit} to freeze the batch, then wait on the
	* returned handle if you need durable confirmation.
	*
	* Prefer using {@link Db.batch} when an explicit commit is not required.
	*/
	beginBatch() {
		return new DbDirectBatch((schema) => this.getClient(schema), (client) => client.beginBatchInternal());
	}
	batch(callback) {
		const batch = this.beginBatch();
		return runInBatch(batch, callback, () => getDbDirectBatchBinding(batch, "result").client);
	}
	/**
	* Delete browser OPFS storage for this Db's active namespace and reopen a clean worker.
	*
	* This clears the primary namespace plus any active follower fallback namespaces for the same
	* browser app/database. It does not touch localStorage-based local-first auth state.
	*
	* Behavior:
	* - Browser worker-backed Db only (throws in non-browser/non-worker runtimes)
	* - Can be initiated from either leader or follower tabs
	* - Coordinates worker shutdown over the tab sync channel before deleting OPFS files
	* - Serializes with worker reconfigure operations
	* - Tears down worker + clients, deletes OPFS files, respawns workers
	* - If deletion fails, all participating tabs still respawn their workers before surfacing the error
	*/
	async deleteClientStorage() {
		if (resolveStorageDriver(this.config.driver).type !== "persistent") throw new Error("deleteClientStorage() is only available when driver.type='persistent'.");
		if (!isBrowser()) {
			console.error("deleteClientStorage() is only available on browser worker-backed Db instances.");
			return;
		}
		const operation = this.workerReconfigure.then(async () => {
			await this.requestCoordinatedStorageReset();
		});
		this.workerReconfigure = operation.then(() => void 0, () => void 0);
		await operation;
	}
	/**
	* Release the current Db instance for logout flows.
	*
	* When `wipeData` is enabled in browser persistent mode, Jazz first coordinates a cross-tab OPFS
	* wipe and then shuts this Db down. Callers should still sign out of their external auth provider
	* separately and recreate `JazzProvider` / `Db` after logout.
	*/
	async logout(options = {}) {
		if (options.wipeData) await this.deleteClientStorage();
		await this.shutdown();
	}
	/**
	* Execute a query and return all matching rows as typed objects.
	*
	* @param query QueryBuilder instance (e.g., app.todos.where({done: false}))
	* @returns Array of typed objects matching the query
	*/
	async all(query, options) {
		const client = this.getClient(query._schema);
		const runtimeSchema = createRuntimeSchemaResolver(() => normalizeRuntimeSchema(client.getSchema()));
		const builderJson = query._build();
		const builtQuery = normalizeBuiltQuery(JSON.parse(builderJson), query._table);
		const planningSchema = resolveSchemaWithTable(query._schema, runtimeSchema.get, builtQuery.table);
		const outputTable = resolveBuiltQueryOutputTable(planningSchema, builtQuery);
		const outputSchema = resolveSchemaWithTable(query._schema, runtimeSchema.get, outputTable);
		const queryOptions = ordinaryDbQueryOptions(options);
		await this.ensureQueryReady(queryOptions);
		const wasmQuery = translateQuery(builderJson, planningSchema);
		return transformRows(await client.query(wasmQuery, queryOptions), outputSchema, outputTable, outputTable !== builtQuery.table ? {} : builtQuery.includes, builtQuery.select).map((row) => transformOutputRow(outputTable === builtQuery.table ? query : {}, row));
	}
	/**
	* Execute a query and return the first matching row, or null.
	*
	* @param query QueryBuilder instance
	* @param options Optional read durability options
	* @returns First matching typed object, or null if none found
	*/
	async one(query, options) {
		return (await this.all(query, options))[0] ?? null;
	}
	/**
	* Create a conventional `files` row by chunking a browser Blob into `file_parts`.
	*
	* Expects `app.files` and `app.file_parts` to follow the built-in file-storage conventions.
	*/
	async createFileFromBlob(app, blob, options) {
		return createConventionalFileStorage(this, app).fromBlob(blob, options);
	}
	/**
	* Create a conventional `files` row by chunking a browser ReadableStream into `file_parts`.
	*
	* Expects `app.files` and `app.file_parts` to follow the built-in file-storage conventions.
	*/
	async createFileFromStream(app, stream, options) {
		return createConventionalFileStorage(this, app).fromStream(stream, options);
	}
	/**
	* Load a conventional file as a browser ReadableStream by querying the file row first
	* and then reading each referenced `file_parts` row sequentially.
	*/
	async loadFileAsStream(app, fileOrId, options) {
		return createConventionalFileStorage(this, app).toStream(fileOrId, options);
	}
	/**
	* Load a conventional file as a Blob using the same sequential part-query path as `loadFileAsStream`.
	*/
	async loadFileAsBlob(app, fileOrId, options) {
		return createConventionalFileStorage(this, app).toBlob(fileOrId, options);
	}
	/**
	* Subscribe to a query and receive updates when results change.
	*
	* The callback receives a SubscriptionDelta with:
	* - `all`: Complete current result set
	* - `delta`: Ordered list of row-level changes
	*
	* @param query QueryBuilder instance
	* @param callback Called with delta whenever results change
	* @returns Unsubscribe function
	*
	* @example
	* ```typescript
	* const unsubscribe = db.subscribeAll(app.todos, (delta) => {
	*   setTodos(delta.all);
	*   for (const change of delta.delta) {
	*     if (change.kind === 0) {
	*       console.log("New row:", change.row);
	*     }
	*   }
	* });
	*
	* // Later: stop receiving updates
	* unsubscribe();
	* ```
	*/
	subscribeAll(query, callback, options, session) {
		const manager = new SubscriptionManager();
		const client = this.getClient(query._schema);
		const runtimeSchema = createRuntimeSchemaResolver(() => normalizeRuntimeSchema(client.getSchema()));
		const builderJson = query._build();
		const builtQuery = normalizeBuiltQuery(JSON.parse(builderJson), query._table);
		const planningSchema = resolveSchemaWithTable(query._schema, runtimeSchema.get, builtQuery.table);
		const outputTable = resolveBuiltQueryOutputTable(planningSchema, builtQuery);
		const outputSchema = resolveSchemaWithTable(query._schema, runtimeSchema.get, outputTable);
		const outputIncludes = outputTable !== builtQuery.table ? {} : builtQuery.includes;
		const wasmQuery = translateQuery(builderJson, planningSchema);
		const transform = (row) => transformOutputRow(outputTable === builtQuery.table ? query : {}, transformRow(row, outputSchema, outputTable, outputIncludes, builtQuery.select));
		const handleDelta = (delta) => {
			callback(manager.handleDelta(delta, transform));
		};
		const queryOptions = ordinaryDbQueryOptions(options);
		const subId = session !== void 0 ? client.subscribeInternal(wasmQuery, handleDelta, session, queryOptions, runtimeSchema.peek()) : client.subscribe(wasmQuery, handleDelta, queryOptions);
		const traceId = this.registerActiveQuerySubscriptionTrace(wasmQuery, builtQuery.table, queryOptions);
		return () => {
			this.unregisterActiveQuerySubscriptionTrace(traceId);
			client.unsubscribe(subId);
			manager.clear();
		};
	}
	/**
	* Shutdown the Db and release all resources.
	* Closes all memoized JazzClient connections and the worker.
	*
	* Idempotent: concurrent or repeated calls share the same in-flight promise.
	*/
	async shutdown() {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.shutdownPromise = this.runShutdown();
		return this.shutdownPromise;
	}
	async runShutdown() {
		this.isShuttingDown = true;
		if (this.localFirstRefreshTimer) {
			clearTimeout(this.localFirstRefreshTimer);
			this.localFirstRefreshTimer = null;
		}
		this.clearActiveQuerySubscriptionTraces();
		this.logLeaderDebug("shutdown");
		this.sendFollowerClose(this.activeRemoteLeaderTabId, this.currentLeaderTerm);
		this.activeRemoteLeaderTabId = null;
		this.leaderPeerIds.clear();
		this.closeSyncChannel();
		this.detachLifecycleHooks();
		if (this.leaderElectionUnsubscribe) {
			this.leaderElectionUnsubscribe();
			this.leaderElectionUnsubscribe = null;
		}
		if (this.leaderElection) {
			this.leaderElection.stop();
			this.leaderElection = null;
		}
		await this.workerReconfigure;
		await this.ensureBridgeReady();
		if (this.workerBridge && this.worker) {
			await this.workerBridge.shutdown(this.worker);
			this.workerBridge = null;
		}
		for (const unsubscribe of this.clientMutationErrorUnsubscribers.values()) unsubscribe();
		this.clientMutationErrorUnsubscribers.clear();
		this.mutationErrorListeners.clear();
		for (const client of this.clients.values()) await client.shutdown();
		this.clients.clear();
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}
	notifyActiveQuerySubscriptionTraceListeners() {
		if (this.activeQuerySubscriptionTraceListeners.size === 0) return;
		const snapshot = this.getActiveQuerySubscriptions();
		for (const listener of this.activeQuerySubscriptionTraceListeners) listener(snapshot);
	}
	registerActiveQuerySubscriptionTrace(queryJson, fallbackTable, options) {
		if (!this.config.devMode) return null;
		const resolvedOptions = resolveEffectiveQueryExecutionOptions(this.config, options);
		const payload = this.parseRuntimeQueryTracePayload(queryJson, fallbackTable);
		const traceId = `sub-${this.nextActiveQuerySubscriptionTraceId++}`;
		this.activeQuerySubscriptionTraces.set(traceId, {
			id: traceId,
			query: queryJson,
			table: payload.table,
			branches: payload.branches,
			tier: resolvedOptions.tier,
			propagation: resolvedOptions.propagation,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			stack: trimSubscriptionTraceStack((/* @__PURE__ */ new Error()).stack),
			visibility: resolvedOptions.visibility ?? "public"
		});
		this.notifyActiveQuerySubscriptionTraceListeners();
		return traceId;
	}
	unregisterActiveQuerySubscriptionTrace(traceId) {
		if (!traceId) return;
		if (!this.activeQuerySubscriptionTraces.delete(traceId)) return;
		this.notifyActiveQuerySubscriptionTraceListeners();
	}
	clearActiveQuerySubscriptionTraces() {
		if (this.activeQuerySubscriptionTraces.size === 0) return;
		this.activeQuerySubscriptionTraces.clear();
		this.notifyActiveQuerySubscriptionTraceListeners();
	}
	parseRuntimeQueryTracePayload(queryJson, fallbackTable) {
		try {
			const parsed = JSON.parse(queryJson);
			const table = typeof parsed.table === "string" ? parsed.table : fallbackTable;
			const branches = Array.isArray(parsed.branches) ? parsed.branches.filter((branch) => typeof branch === "string") : [];
			return {
				table,
				branches: branches.length > 0 ? branches : [this.config.userBranch ?? "main"]
			};
		} catch {
			return {
				table: fallbackTable,
				branches: [this.config.userBranch ?? "main"]
			};
		}
	}
};
/**
* Check if running in a browser environment with Worker support.
*/
function isBrowser() {
	return typeof Worker !== "undefined" && typeof window !== "undefined";
}
/**
* Generate a 32-byte ephemeral seed for anonymous auth.
*
* Uses `globalThis.crypto.getRandomValues`, which is available in all
* supported environments (browser, Node ≥15, React Native, edge workers).
*/
function generateEphemeralSeedBase64Url() {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
* Create a new Db instance with the given configuration.
*
* This is an **async** factory function that pre-loads the WASM module.
* After creation, local-first mutations (`insert`/`update`/`delete`) are synchronous.
* Use the `wait` method when you need a Promise that resolves at a durability tier.
*
* In browser environments, automatically uses a dedicated worker for
* OPFS persistence. In Node.js, uses in-memory storage.
*
* @param config Database configuration
* @returns Promise resolving to Db instance ready for queries and mutations
*
* @example
* ```typescript
* const db = await createDb({
*   appId: "my-app",
*   schema: mySchema,
* });
* ```
*/
async function createDb(config) {
	if (config.secret && (config.jwtToken || config.cookieSession)) throw new Error("DbConfig error: secret, jwtToken, and cookieSession are mutually exclusive");
	if (config.jwtToken && config.cookieSession) throw new Error("DbConfig error: jwtToken and cookieSession are mutually exclusive");
	let resolvedConfig = { ...config };
	let localFirstSecret = null;
	if (config.secret) {
		const secret = config.secret;
		localFirstSecret = secret;
		const wasmModule = await loadWasmModule(config.runtimeSources);
		const nowSeconds = BigInt(Math.floor(Date.now() / 1e3));
		const jwtToken = wasmModule.WasmRuntime.mintJazzSelfSignedToken(secret, "urn:jazz:local-first", config.appId, BigInt(3600), nowSeconds);
		resolvedConfig = {
			...resolvedConfig,
			jwtToken
		};
	} else if (!config.jwtToken && !config.cookieSession && !config.adminSecret) {
		const wasmModule = await loadWasmModule(config.runtimeSources);
		const ephemeralSeed = generateEphemeralSeedBase64Url();
		const nowSeconds = BigInt(Math.floor(Date.now() / 1e3));
		const jwtToken = wasmModule.WasmRuntime.mintJazzSelfSignedToken(ephemeralSeed, ANONYMOUS_JWT_ISSUER, config.appId, BigInt(3600), nowSeconds);
		resolvedConfig = {
			...resolvedConfig,
			jwtToken
		};
	}
	const driver = resolveStorageDriver(resolvedConfig.driver);
	if (driver.type === "memory" && !resolvedConfig.serverUrl) throw new Error("driver.type='memory' requires serverUrl.");
	logAuthModeInDev(resolvedConfig);
	let db;
	if (isBrowser() && driver.type === "persistent") db = await Db.createWithWorker(resolvedConfig);
	else db = await Db.create(resolvedConfig);
	if (localFirstSecret) db.initLocalFirstAuth(localFirstSecret, 3600);
	return db;
}
function logAuthModeInDev(config) {
	if (config.env === "prod") return;
	const authMode = resolveClientSessionSync({
		appId: config.appId,
		jwtToken: config.jwtToken,
		cookieSession: config.cookieSession
	})?.authMode ?? "anonymous";
	console.info(`[jazz] auth mode: ${authMode} (${authMode === "anonymous" ? "anonymous — ephemeral identity, no write permissions on synced data" : authMode === "local-first" ? "local-first — identity persisted locally via secret" : "external — identity issued by an auth provider"})`);
}
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/runtime/auth-secret-store.js
var DEFAULT_KEY = "jazz-auth-secret";
/**
* Generate a new 32-byte auth secret as a base64url string.
* Uses the platform's native CSPRNG.
*/
function generateAuthSecret() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return uint8ArrayToBase64url(bytes);
}
function uint8ArrayToBase64url(bytes) {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function normalizeScopeSegment(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	return encodeURIComponent(trimmed);
}
function resolveBrowserAuthSecretKey(options = {}) {
	if (options.key) return options.key;
	const scopeSegments = [
		normalizeScopeSegment(options.appId),
		normalizeScopeSegment(options.userId),
		normalizeScopeSegment(options.sessionId)
	].filter((segment) => segment !== null);
	if (scopeSegments.length === 0) return DEFAULT_KEY;
	return `${DEFAULT_KEY}:${scopeSegments.join(":")}`;
}
(class BrowserAuthSecretStore {
	static globalInstances = /* @__PURE__ */ new Map();
	static storageScopedInstances = /* @__PURE__ */ new WeakMap();
	key;
	storage;
	cachedPromise = null;
	constructor(options = {}) {
		this.key = resolveBrowserAuthSecretKey(options);
		this.storage = options.storage ?? globalThis.localStorage;
	}
	static getDefault(options = {}) {
		const storage = options.storage;
		const key = resolveBrowserAuthSecretKey(options);
		if (storage) {
			let instances = BrowserAuthSecretStore.storageScopedInstances.get(storage);
			if (!instances) {
				instances = /* @__PURE__ */ new Map();
				BrowserAuthSecretStore.storageScopedInstances.set(storage, instances);
			}
			let instance = instances.get(key);
			if (!instance) {
				instance = new BrowserAuthSecretStore(options);
				instances.set(key, instance);
			}
			return instance;
		}
		let instance = BrowserAuthSecretStore.globalInstances.get(key);
		if (!instance) {
			instance = new BrowserAuthSecretStore(options);
			BrowserAuthSecretStore.globalInstances.set(key, instance);
		}
		return instance;
	}
	async loadSecret() {
		return this.storage.getItem(this.key);
	}
	async saveSecret(secret) {
		this.storage.setItem(this.key, secret);
		this.cachedPromise = Promise.resolve(secret);
	}
	async clearSecret() {
		this.storage.removeItem(this.key);
		this.cachedPromise = null;
	}
	getOrCreateSecret() {
		if (!this.cachedPromise) {
			const existing = this.storage.getItem(this.key);
			if (existing) this.cachedPromise = Promise.resolve(existing);
			else {
				const secret = generateAuthSecret();
				this.storage.setItem(this.key, secret);
				this.cachedPromise = Promise.resolve(secret);
			}
		}
		return this.cachedPromise;
	}
	static loadSecret(options = {}) {
		return BrowserAuthSecretStore.getDefault(options).loadSecret();
	}
	static saveSecret(secret, options = {}) {
		return BrowserAuthSecretStore.getDefault(options).saveSecret(secret);
	}
	static clearSecret(options = {}) {
		return BrowserAuthSecretStore.getDefault(options).clearSecret();
	}
	static getOrCreateSecret(options = {}) {
		return BrowserAuthSecretStore.getDefault(options).getOrCreateSecret();
	}
}).getDefault();
//#endregion
//#region ../../node_modules/.bun/jazz-tools@2.0.0-alpha.46+045985ea35624382/node_modules/jazz-tools/dist/index.js
var schema = Object.assign({}, col, {
	table: defineTable,
	defineSchema,
	defineApp,
	defineSliceableApp,
	defineMigration,
	renameTableFrom,
	definePermissions,
	permissionIntrospectionColumns
});
//#endregion
//#region src/lib/schema.ts
/**
* Structural changes (tables/columns) change the WASM schema hash. Sync targets branches named
* `{env}-{schemaHash12}-{userBranch}` (see `composeTargetBranchName` in jazz-tools). Existing OPFS
* data may still reflect an older hash until cleared — use dev “Clear local Jazz DB” on `/me` or
* `Db.deleteClientStorage()`. Keeping old rows without wiping requires `defineMigration` + push.
*/
var app = schema.defineApp({
	profiles: schema.table({ name: schema.string() }),
	intents: schema.table({
		title: schema.string(),
		done: schema.boolean()
	}),
	/** Spawned worker instances — no seed; rows created from intent flow (testing). */
	workers: schema.table({
		ownerUserId: schema.string(),
		categoryKey: schema.string(),
		label: schema.string(),
		taskLine: schema.string(),
		status: schema.string(),
		score: schema.string()
	}),
	memoryArtifacts: schema.table({
		sha256: schema.string(),
		originalName: schema.string(),
		mimeType: schema.string(),
		sizeBytes: schema.int(),
		storageUri: schema.string(),
		createdAt: schema.string()
	}),
	memoryNotes: schema.table({
		kind: schema.string(),
		slug: schema.string(),
		title: schema.string(),
		bodyMarkdown: schema.string(),
		sourceArtifactId: schema.ref("memoryArtifacts").optional(),
		createdAt: schema.string(),
		updatedAt: schema.string(),
		archived: schema.boolean()
	}),
	memoryLinks: schema.table({
		sourceNoteId: schema.ref("memoryNotes"),
		targetNoteId: schema.ref("memoryNotes"),
		label: schema.string(),
		createdAt: schema.string()
	}),
	memoryChunks: schema.table({
		noteId: schema.ref("memoryNotes"),
		sourceArtifactId: schema.ref("memoryArtifacts").optional(),
		chunkIndex: schema.int(),
		text: schema.string(),
		contentHash: schema.string(),
		createdAt: schema.string()
	}),
	extractionRuns: schema.table({
		artifactId: schema.ref("memoryArtifacts"),
		skillId: schema.string(),
		status: schema.string(),
		extractor: schema.string(),
		summary: schema.string().optional(),
		error: schema.string().optional(),
		startedAt: schema.string(),
		completedAt: schema.string().optional()
	})
});
//#endregion
//#region src/lib/memory/memory-provenance.ts
var MEMORY_SOURCE_HEADING = "### Memory source";
/**
* Appends an audit line linking this file version to the Talk turn (`mN`) or a manual save.
* Idempotent per call: always adds one new bullet (causal chain over time).
*/
function appendMemoryProvenance(fullMarkdown, source) {
	const iso = (/* @__PURE__ */ new Date()).toISOString();
	const line = source.type === "talk" ? `- \`${iso}\` — Source (Talk): [[Talk/m${source.messageTurn}|Talk m${source.messageTurn}]]` : `- \`${iso}\` — Source: Memory UI (manual save)`;
	const trimmed = fullMarkdown.replace(/\s+$/u, "");
	if (trimmed.includes("### Memory source")) return `${trimmed}\n${line}\n`;
	return `${trimmed}\n\n---\n\n${MEMORY_SOURCE_HEADING}\n\n${line}\n`;
}
//#endregion
//#region src/lib/memory/jazz-memory-store.ts
var dbPromise = null;
var storeConfigOverride = null;
var SECRET_PATTERN = /(-----BEGIN [A-Z ]+PRIVATE KEY-----|seed phrase|mnemonic phrase|api[_-]?key|access[_-]?token|secret[_-]?key)/i;
function bufferToBase64Url(buf) {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function tryDecodeBase64UrlToBuffer(s) {
	const normalized = s.trim();
	if (!normalized) return null;
	const b64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
	const pad = (4 - b64.length % 4) % 4;
	try {
		return Buffer.from(b64 + "=".repeat(pad), "base64");
	} catch {
		return null;
	}
}
/**
* Jazz `createDb({ secret })` requires a **base64url** string that decodes to **32 bytes**
* (same as `generateAuthSecret()`). Raw `.env` values are often human-readable; normalize
* so vault APIs do not throw `seed must be exactly 32 bytes`.
*/
function normalizeJazzBackendSecretFromEnv(raw) {
	const trimmed = typeof raw === "string" ? raw.trim() : "";
	if (!trimmed) return void 0;
	const fromB64 = tryDecodeBase64UrlToBuffer(trimmed);
	if (fromB64 && fromB64.length === 32) return trimmed;
	if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return bufferToBase64Url(Buffer.from(trimmed, "hex"));
	const utf8 = Buffer.from(trimmed, "utf8");
	if (utf8.length === 32) return bufferToBase64Url(utf8);
	return bufferToBase64Url(createHash("sha256").update(trimmed, "utf8").digest());
}
function defaultStoreConfig() {
	const appId = String(process.env.PUBLIC_JAZZ_APP_ID ?? "").trim();
	if (!appId) throw new Error("Missing PUBLIC_JAZZ_APP_ID for Jazz memory store.");
	return {
		appId,
		serverUrl: String(process.env.PUBLIC_JAZZ_SERVER_URL ?? "").trim() || void 0,
		adminSecret: String(process.env.JAZZ_ADMIN_SECRET ?? "").trim() || void 0,
		secret: normalizeJazzBackendSecretFromEnv(process.env.BACKEND_SECRET),
		env: process.env.NODE_ENV === "production" ? "prod" : "dev",
		userBranch: "main",
		driver: {
			type: "persistent",
			dbName: "aven-ceo-memory"
		},
		dbName: "aven-ceo-memory"
	};
}
function effectiveStoreConfig() {
	return storeConfigOverride ?? defaultStoreConfig();
}
async function getDb() {
	if (!dbPromise) {
		const config = effectiveStoreConfig();
		dbPromise = createDb({
			appId: config.appId,
			serverUrl: config.serverUrl,
			adminSecret: config.adminSecret,
			secret: config.secret,
			env: config.env,
			userBranch: config.userBranch,
			driver: config.driver,
			dbName: config.dbName
		});
	}
	try {
		return await dbPromise;
	} catch (err) {
		dbPromise = null;
		throw err;
	}
}
function ensureNoSecrets(text) {
	if (SECRET_PATTERN.test(text)) throw new Error("Refusing to store likely secrets in memory.");
}
function notePathFromSlug(slug) {
	return `${slug.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "")}.md`;
}
function slugFromNotePath(notePath) {
	return notePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
}
function titleFromMarkdown(markdown, fallback) {
	const body = bodyAfterFrontmatter(markdown);
	return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || fallback;
}
function hashText(text) {
	return createHash("sha256").update(text).digest("hex");
}
function projectionRoot() {
	ensureSeedRuntimeSynced();
	return path.join(process.cwd(), ".data", "knowledge");
}
function ensureProjectionRoot() {
	const root = projectionRoot();
	if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
	return root;
}
async function waitForLocal(result) {
	return result.wait({ tier: "local" });
}
async function allNotes() {
	return await (await getDb()).all(app.memoryNotes.where({ archived: false }).orderBy("slug", "asc"));
}
async function findArtifactBySha256(sha256) {
	return (await getDb()).one(app.memoryArtifacts.where({ sha256 }).limit(1));
}
async function findNoteBySourceArtifactId(sourceArtifactId) {
	return (await getDb()).one(app.memoryNotes.where({ sourceArtifactId }).limit(1));
}
async function findNoteBySlug(slug) {
	return (await getDb()).one(app.memoryNotes.where({ slug }).limit(1));
}
async function writeProjectionForNote(note) {
	const root = ensureProjectionRoot();
	const rel = notePathFromSlug(note.slug);
	const full = path.join(root, ...rel.split("/"));
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, note.bodyMarkdown, "utf8");
}
async function createOrGetArtifact(input) {
	ensureNoSecrets(input.originalName);
	ensureNoSecrets(input.storageUri);
	const db = await getDb();
	const existing = await findArtifactBySha256(input.sha256);
	if (existing) {
		await waitForLocal(db.update(app.memoryArtifacts, existing.id, {
			originalName: input.originalName,
			mimeType: input.mimeType,
			sizeBytes: input.sizeBytes,
			storageUri: input.storageUri
		}));
		return await findArtifactBySha256(input.sha256) ?? existing;
	}
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	return await waitForLocal(db.insert(app.memoryArtifacts, {
		sha256: input.sha256,
		originalName: input.originalName,
		mimeType: input.mimeType,
		sizeBytes: input.sizeBytes,
		storageUri: input.storageUri,
		createdAt
	}));
}
async function createOrUpdateDocumentNote(input) {
	ensureNoSecrets(input.bodyMarkdown);
	ensureNoSecrets(input.title);
	ensureNoSecrets(input.slug);
	const db = await getDb();
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const slug = slugFromNotePath(input.slug);
	const existing = input.sourceArtifactId ? await findNoteBySourceArtifactId(input.sourceArtifactId) ?? await findNoteBySlug(slug) : await findNoteBySlug(slug);
	if (existing) {
		await waitForLocal(db.update(app.memoryNotes, existing.id, {
			kind: input.kind,
			slug,
			title: input.title,
			bodyMarkdown: input.bodyMarkdown,
			sourceArtifactId: input.sourceArtifactId ?? null,
			updatedAt: now,
			archived: input.archived ?? false
		}));
		const updated = await findNoteBySlug(slug);
		if (!updated) throw new Error("Failed to reload updated note.");
		await writeProjectionForNote(updated);
		return updated;
	}
	const note = await waitForLocal(db.insert(app.memoryNotes, {
		kind: input.kind,
		slug,
		title: input.title,
		bodyMarkdown: input.bodyMarkdown,
		sourceArtifactId: input.sourceArtifactId ?? null,
		createdAt: now,
		updatedAt: now,
		archived: input.archived ?? false
	}));
	await writeProjectionForNote(note);
	return note;
}
async function upsertChunks(noteId, chunks) {
	const db = await getDb();
	const note = await readMemoryNote(noteId);
	const existing = await db.all(app.memoryChunks.where({ noteId }).orderBy("chunkIndex", "asc"));
	for (const row of existing) await waitForLocal(db.delete(app.memoryChunks, row.id));
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	for (const [chunkIndex, text] of chunks.entries()) await waitForLocal(db.insert(app.memoryChunks, {
		noteId,
		sourceArtifactId: note.sourceArtifactId ?? null,
		chunkIndex,
		text,
		contentHash: hashText(text),
		createdAt
	}));
}
async function rebuildLinksForNote(noteId) {
	const db = await getDb();
	const note = await readMemoryNote(noteId);
	const existing = await db.all(app.memoryLinks.where({ sourceNoteId: noteId }));
	for (const row of existing) await waitForLocal(db.delete(app.memoryLinks, row.id));
	const notes = await allNotes();
	const allPaths = notes.map((item) => notePathFromSlug(item.slug));
	const byPath = new Map(notes.map((item) => [notePathFromSlug(item.slug), item]));
	const seen = /* @__PURE__ */ new Set();
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	const pendingWrites = [];
	forEachWikilinkPath(bodyAfterFrontmatter(note.bodyMarkdown), (raw) => {
		if (isTalkTurnWikilinkPath(raw)) return;
		const resolved = resolveWikilinkToVaultPath(raw, allPaths);
		if (resolved.status !== "resolved") return;
		const target = byPath.get(resolved.vaultPath);
		if (!target || target.id === noteId) return;
		const key = `${noteId}:${target.id}:${normalizeWikilinkPath(raw)}`;
		if (seen.has(key)) return;
		seen.add(key);
		pendingWrites.push(waitForLocal(db.insert(app.memoryLinks, {
			sourceNoteId: noteId,
			targetNoteId: target.id,
			label: raw.trim(),
			createdAt
		})));
	});
	await Promise.all(pendingWrites);
}
async function searchMemory(query, limit = 20) {
	const q = query.trim().toLowerCase();
	if (!q) return { hits: [] };
	const db = await getDb();
	const [notes, chunks] = await Promise.all([allNotes(), db.all(app.memoryChunks.where({}).orderBy("chunkIndex", "asc"))]);
	const notesById = new Map(notes.map((note) => [note.id, note]));
	const hits = [];
	for (const note of notes) {
		const path = notePathFromSlug(note.slug);
		if (path.toLowerCase().includes(q)) hits.push({
			kind: "note",
			noteId: note.id,
			path,
			line: 0,
			snippet: `(filename) ${path}`,
			title: note.title
		});
		const lines = note.bodyMarkdown.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(q)) hits.push({
				kind: "note",
				noteId: note.id,
				path,
				line: i + 1,
				snippet: lines[i].trim().slice(0, 200),
				title: note.title
			});
			if (hits.length >= limit) return { hits: hits.slice(0, limit) };
		}
	}
	for (const chunk of chunks) {
		const note = notesById.get(chunk.noteId);
		if (!note || !chunk.text.toLowerCase().includes(q)) continue;
		hits.push({
			kind: "chunk",
			noteId: note.id,
			path: notePathFromSlug(note.slug),
			line: chunk.chunkIndex + 1,
			snippet: chunk.text.slice(0, 200),
			title: note.title
		});
		if (hits.length >= limit) break;
	}
	return { hits: hits.slice(0, limit) };
}
async function readMemoryNote(noteId) {
	const note = await (await getDb()).one(app.memoryNotes.where({ id: noteId }).limit(1));
	if (!note) throw new Error("Note not found.");
	return note;
}
async function listMemoryNotes() {
	return (await allNotes()).map((note) => ({
		id: note.id,
		path: notePathFromSlug(note.slug),
		title: note.title
	}));
}
async function readMemoryNoteByPath(notePath) {
	const note = await findNoteBySlug(slugFromNotePath(notePath));
	if (!note || note.archived) throw new Error("Note not found.");
	return note;
}
async function writeMemoryNoteByPath(notePath, content, source) {
	const slug = slugFromNotePath(notePath);
	const parsed = parseMarkdownFrontmatter(content);
	const existing = await findNoteBySlug(slug);
	const merged = appendMemoryProvenance(content, source);
	const note = await createOrUpdateDocumentNote({
		kind: parsed.meta.kind?.trim() || existing?.kind || "topic",
		slug,
		title: titleFromMarkdown(merged, existing?.title ?? path.posix.basename(slug)),
		bodyMarkdown: merged,
		sourceArtifactId: existing?.sourceArtifactId ?? null,
		archived: false
	});
	await upsertChunks(note.id, deriveChunksFromMarkdown(note.bodyMarkdown));
	await rebuildLinksForNote(note.id);
	await writeProjectionForNote(note);
	return note;
}
function deriveChunksFromMarkdown(markdown, maxChunkChars = 600) {
	const lines = bodyAfterFrontmatter(markdown).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (!lines.length) return [];
	const chunks = [];
	let current = "";
	for (const line of lines) {
		const next = current ? `${current}\n${line}` : line;
		if (next.length > maxChunkChars && current) {
			chunks.push(current);
			current = line;
		} else current = next;
	}
	if (current) chunks.push(current);
	return chunks;
}
function slugFromArtifactName(originalName) {
	return originalName.replace(/\.[^.]+$/, "").trim().replace(/\\/g, "/").replace(/\s+/g, " ");
}
async function createExtractionRun(input) {
	const db = await getDb();
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return await waitForLocal(db.insert(app.extractionRuns, {
		artifactId: input.artifactId,
		skillId: input.skillId,
		status: input.status,
		extractor: input.extractor,
		summary: input.summary ?? null,
		error: input.error ?? null,
		startedAt: now,
		completedAt: input.status === "pending" ? null : now
	}));
}
async function memoryIngestDocument(input) {
	const artifact = await createOrGetArtifact(input.artifact);
	await createExtractionRun({
		artifactId: artifact.id,
		skillId: "file-analyzer",
		status: "pending",
		extractor: input.extraction.extractor,
		summary: input.extraction.summary
	});
	const note = await createOrUpdateDocumentNote({
		kind: "document",
		slug: slugFromArtifactName(input.artifact.originalName),
		title: titleFromMarkdown(input.extraction.bodyMarkdown, slugFromArtifactName(input.artifact.originalName)),
		bodyMarkdown: input.extraction.bodyMarkdown,
		sourceArtifactId: artifact.id,
		archived: false
	});
	const chunks = input.extraction.chunks.length ? input.extraction.chunks : deriveChunksFromMarkdown(input.extraction.bodyMarkdown);
	await upsertChunks(note.id, chunks);
	await rebuildLinksForNote(note.id);
	await createExtractionRun({
		artifactId: artifact.id,
		skillId: "file-analyzer",
		status: "completed",
		extractor: input.extraction.extractor,
		summary: input.extraction.summary
	});
	return {
		ok: true,
		artifactId: artifact.id,
		noteId: note.id,
		chunkCount: chunks.length
	};
}
async function recordExtractionFailure(input) {
	return createExtractionRun({
		artifactId: (await createOrGetArtifact(input.artifact)).id,
		skillId: input.skillId ?? "file-analyzer",
		status: "failed",
		extractor: input.extractor,
		error: input.error
	});
}
//#endregion
//#region src/lib/memory/vault.ts
function repoRootFromModule() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "..");
}
/** Prefer `process.cwd()` when available (dev server from repo root). */
function resolveRepoRoot() {
	try {
		if (typeof process !== "undefined" && process.cwd) return process.cwd();
	} catch {}
	return repoRootFromModule();
}
function vaultAbsolutePath() {
	return path.join(resolveRepoRoot(), ".data", "knowledge");
}
/**
* Validates `rel` as a path under the vault (no "..", no absolute).
* Returns normalized path using the current platform separator for joining.
*/
function assertVaultRelativePath(rel) {
	if (!rel || typeof rel !== "string") throw new Error("Path is required.");
	const posix = rel.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!posix || posix.includes("..") || path.posix.isAbsolute(posix)) throw new Error("Invalid path.");
	const resolvedVault = path.resolve(vaultAbsolutePath());
	const abs = path.resolve(vaultAbsolutePath(), posix);
	if (abs !== resolvedVault && !abs.startsWith(`${resolvedVault}${path.sep}`)) throw new Error("Path escapes vault.");
	return posix;
}
function ensureVaultDir() {
	ensureSeedRuntimeSynced();
	return vaultAbsolutePath();
}
async function listVaultNotes() {
	ensureVaultDir();
	return (await listMemoryNotes()).map(({ path, title }) => ({
		path,
		title
	})).sort((a, b) => a.path.localeCompare(b.path));
}
async function readVaultNote(relPosix) {
	return (await readMemoryNoteByPath(assertVaultRelativePath(relPosix))).bodyMarkdown;
}
async function writeVaultNote(relPosix, content, source = { type: "memory_ui" }) {
	await writeMemoryNoteByPath(assertVaultRelativePath(relPosix), content, source);
}
/** Replace one unique substring in a file (fail if zero or multiple matches). */
async function editVaultNote(relPosix, oldString, newString, source = { type: "memory_ui" }) {
	const posix = assertVaultRelativePath(relPosix);
	if (!oldString) throw new Error("oldString must not be empty.");
	let full = await readVaultNote(posix);
	const idx = full.indexOf(oldString);
	if (idx === -1) throw new Error("oldString was not found in file.");
	if (full.indexOf(oldString, idx + oldString.length) !== -1) throw new Error("oldString matched multiple times; include more surrounding lines for a unique slice.");
	full = full.slice(0, idx) + newString + full.slice(idx + oldString.length);
	await writeVaultNote(posix, full, source);
}
async function searchVault(query, limit = 20) {
	return (await searchMemory(query, limit)).hits.map(({ path, line, snippet }) => ({
		path,
		line,
		snippet
	}));
}
//#endregion
export { readVaultNote as a, vaultAbsolutePath as c, recordExtractionFailure as d, ensureSeedRuntimeSynced as f, listVaultNotes as i, writeVaultNote as l, editVaultNote as n, resolveRepoRoot as o, maiaMemoryToolsJsonPath as p, ensureVaultDir as r, searchVault as s, assertVaultRelativePath as t, memoryIngestDocument as u };
