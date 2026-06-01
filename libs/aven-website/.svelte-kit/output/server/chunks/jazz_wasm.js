//#region ../../node_modules/.bun/jazz-wasm@2.0.0-alpha.46/node_modules/jazz-wasm/pkg/jazz_wasm.js
/**
* WASM-exposed QueryBuilder with camelCase methods.
*/
var WasmQueryBuilder = class WasmQueryBuilder {
	static __wrap(ptr) {
		ptr = ptr >>> 0;
		const obj = Object.create(WasmQueryBuilder.prototype);
		obj.__wbg_ptr = ptr;
		WasmQueryBuilderFinalization.register(obj, obj.__wbg_ptr, obj);
		return obj;
	}
	__destroy_into_raw() {
		const ptr = this.__wbg_ptr;
		this.__wbg_ptr = 0;
		WasmQueryBuilderFinalization.unregister(this);
		return ptr;
	}
	free() {
		const ptr = this.__destroy_into_raw();
		wasm.__wbg_wasmquerybuilder_free(ptr, 0);
	}
	/**
	* Set a table alias.
	* @param {string} alias
	* @returns {WasmQueryBuilder}
	*/
	alias(alias) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(alias, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_alias(ptr, ptr0, len0);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Set the branch to query.
	* @param {string} branch
	* @returns {WasmQueryBuilder}
	*/
	branch(branch) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(branch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_branch(ptr, ptr0, len0);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Set multiple branches to query.
	* @param {string[]} branches
	* @returns {WasmQueryBuilder}
	*/
	branches(branches) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passArrayJsValueToWasm0(branches, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_branches(ptr, ptr0, len0);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Build the query and return as JSON string.
	* @returns {string}
	*/
	build() {
		let deferred2_0;
		let deferred2_1;
		try {
			const ptr = this.__destroy_into_raw();
			const ret = wasm.wasmquerybuilder_build(ptr);
			var ptr1 = ret[0];
			var len1 = ret[1];
			if (ret[3]) {
				ptr1 = 0;
				len1 = 0;
				throw takeFromExternrefTable0(ret[2]);
			}
			deferred2_0 = ptr1;
			deferred2_1 = len1;
			return getStringFromWasm0(ptr1, len1);
		} finally {
			wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
		}
	}
	/**
	* Build and return as JsValue.
	* @returns {any}
	*/
	buildJs() {
		const ptr = this.__destroy_into_raw();
		const ret = wasm.wasmquerybuilder_buildJs(ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Add an equals filter.
	* @param {string} column
	* @param {any} value
	* @returns {WasmQueryBuilder}
	*/
	filterEq(column, value) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_filterEq(ptr, ptr0, len0, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return WasmQueryBuilder.__wrap(ret[0]);
	}
	/**
	* Add a greater-than-or-equal filter.
	* @param {string} column
	* @param {any} value
	* @returns {WasmQueryBuilder}
	*/
	filterGe(column, value) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_filterGe(ptr, ptr0, len0, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return WasmQueryBuilder.__wrap(ret[0]);
	}
	/**
	* Add a greater-than filter.
	* @param {string} column
	* @param {any} value
	* @returns {WasmQueryBuilder}
	*/
	filterGt(column, value) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_filterGt(ptr, ptr0, len0, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return WasmQueryBuilder.__wrap(ret[0]);
	}
	/**
	* Add a less-than-or-equal filter.
	* @param {string} column
	* @param {any} value
	* @returns {WasmQueryBuilder}
	*/
	filterLe(column, value) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_filterLe(ptr, ptr0, len0, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return WasmQueryBuilder.__wrap(ret[0]);
	}
	/**
	* Add a less-than filter.
	* @param {string} column
	* @param {any} value
	* @returns {WasmQueryBuilder}
	*/
	filterLt(column, value) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_filterLt(ptr, ptr0, len0, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return WasmQueryBuilder.__wrap(ret[0]);
	}
	/**
	* Add a not-equals filter.
	* @param {string} column
	* @param {any} value
	* @returns {WasmQueryBuilder}
	*/
	filterNe(column, value) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_filterNe(ptr, ptr0, len0, value);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return WasmQueryBuilder.__wrap(ret[0]);
	}
	/**
	* Include soft-deleted rows.
	* @returns {WasmQueryBuilder}
	*/
	includeDeleted() {
		const ptr = this.__destroy_into_raw();
		const ret = wasm.wasmquerybuilder_includeDeleted(ptr);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Join another table.
	* @param {string} table
	* @returns {WasmQueryBuilder}
	*/
	join(table) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_join(ptr, ptr0, len0);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Set a limit.
	* @param {number} n
	* @returns {WasmQueryBuilder}
	*/
	limit(n) {
		const ptr = this.__destroy_into_raw();
		const ret = wasm.wasmquerybuilder_limit(ptr, n);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Create a new QueryBuilder for a table.
	* @param {string} table
	*/
	constructor(table) {
		const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_new(ptr0, len0);
		this.__wbg_ptr = ret >>> 0;
		WasmQueryBuilderFinalization.register(this, this.__wbg_ptr, this);
		return this;
	}
	/**
	* Set an offset.
	* @param {number} n
	* @returns {WasmQueryBuilder}
	*/
	offset(n) {
		const ptr = this.__destroy_into_raw();
		const ret = wasm.wasmquerybuilder_offset(ptr, n);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Specify join condition.
	* @param {string} left_col
	* @param {string} right_col
	* @returns {WasmQueryBuilder}
	*/
	on(left_col, right_col) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(left_col, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(right_col, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_on(ptr, ptr0, len0, ptr1, len1);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Start a new OR branch.
	* @returns {WasmQueryBuilder}
	*/
	or() {
		const ptr = this.__destroy_into_raw();
		const ret = wasm.wasmquerybuilder_or(ptr);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Add ascending order by.
	* @param {string} column
	* @returns {WasmQueryBuilder}
	*/
	orderBy(column) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_orderBy(ptr, ptr0, len0);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Add descending order by.
	* @param {string} column
	* @returns {WasmQueryBuilder}
	*/
	orderByDesc(column) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passStringToWasm0(column, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_orderByDesc(ptr, ptr0, len0);
		return WasmQueryBuilder.__wrap(ret);
	}
	/**
	* Select specific columns.
	* @param {string[]} columns
	* @returns {WasmQueryBuilder}
	*/
	select(columns) {
		const ptr = this.__destroy_into_raw();
		const ptr0 = passArrayJsValueToWasm0(columns, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmquerybuilder_select(ptr, ptr0, len0);
		return WasmQueryBuilder.__wrap(ret);
	}
};
if (Symbol.dispose) WasmQueryBuilder.prototype[Symbol.dispose] = WasmQueryBuilder.prototype.free;
/**
* Main runtime for JavaScript applications.
*
* Wraps `Rc<RefCell<WasmCoreType>>`.
* All methods borrow the core, call RuntimeCore, and return.
* Async scheduling happens via WasmScheduler.schedule_batched_tick().
*/
var WasmRuntime = class WasmRuntime {
	static __wrap(ptr) {
		ptr = ptr >>> 0;
		const obj = Object.create(WasmRuntime.prototype);
		obj.__wbg_ptr = ptr;
		WasmRuntimeFinalization.register(obj, obj.__wbg_ptr, obj);
		return obj;
	}
	__destroy_into_raw() {
		const ptr = this.__wbg_ptr;
		this.__wbg_ptr = 0;
		WasmRuntimeFinalization.unregister(this);
		return ptr;
	}
	free() {
		const ptr = this.__destroy_into_raw();
		wasm.__wbg_wasmruntime_free(ptr, 0);
	}
	/**
	* Debug helper: expose schema/lens state currently loaded in SchemaManager.
	* @returns {any}
	*/
	__debugSchemaState() {
		const ret = wasm.wasmruntime___debugSchemaState(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Debug helper: seed a historical schema and persist schema/lens catalogue objects.
	* @param {string} schema_json
	*/
	__debugSeedLiveSchema(schema_json) {
		const ptr0 = passStringToWasm0(schema_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime___debugSeedLiveSchema(this.__wbg_ptr, ptr0, len0);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} batch_id
	* @returns {boolean}
	*/
	acknowledgeRejectedBatch(batch_id) {
		const ptr0 = passStringToWasm0(batch_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_acknowledgeRejectedBatch(this.__wbg_ptr, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0] !== 0;
	}
	/**
	* Add a client connection (for server-side use in tests).
	* @returns {string}
	*/
	addClient() {
		let deferred1_0;
		let deferred1_1;
		try {
			const ret = wasm.wasmruntime_addClient(this.__wbg_ptr);
			deferred1_0 = ret[0];
			deferred1_1 = ret[1];
			return getStringFromWasm0(ret[0], ret[1]);
		} finally {
			wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
		}
	}
	/**
	* Add a server connection.
	*
	* After adding the server, immediately flushes the outbox so that
	* catalogue sync messages (from queue_full_sync_to_server) are sent
	* before the call returns, rather than being deferred to a microtask.
	* @param {string | null} [server_catalogue_state_hash]
	* @param {number | null} [next_sync_seq]
	*/
	addServer(server_catalogue_state_hash, next_sync_seq) {
		var ptr0 = isLikeNone(server_catalogue_state_hash) ? 0 : passStringToWasm0(server_catalogue_state_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_addServer(this.__wbg_ptr, ptr0, len0, !isLikeNone(next_sync_seq), isLikeNone(next_sync_seq) ? 0 : next_sync_seq);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Connect to a Jazz server over WebSocket.
	*
	* Parses `auth_json` into `AuthConfig`, wires a `TransportManager` into
	* `RuntimeCore`, and spawns the manager loop via `spawn_local`.
	* @param {string} url
	* @param {string} auth_json
	*/
	connect(url, auth_json) {
		const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(auth_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_connect(this.__wbg_ptr, ptr0, len0, ptr1, len1);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Phase 1 of 2-phase subscribe: allocate a handle and store query params.
	* No compilation, no sync, no tick — just bookkeeping.
	* @param {string} query_json
	* @param {string | null} [session_json]
	* @param {string | null} [settled_tier]
	* @param {string | null} [options_json]
	* @returns {number}
	*/
	createSubscription(query_json, session_json, settled_tier, options_json) {
		const ptr0 = passStringToWasm0(query_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(session_json) ? 0 : passStringToWasm0(session_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		var ptr2 = isLikeNone(settled_tier) ? 0 : passStringToWasm0(settled_tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len2 = WASM_VECTOR_LEN;
		var ptr3 = isLikeNone(options_json) ? 0 : passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len3 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_createSubscription(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0];
	}
	/**
	* Delete a row by ObjectId.
	* @param {string} object_id
	* @returns {any}
	*/
	delete(object_id) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_delete(this.__wbg_ptr, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Delete a row immediately, returning the logical batch id that tracks
	* replayable persisted fate for this write.
	* @param {string} object_id
	* @param {string} tier
	* @returns {any}
	*/
	deletePersisted(object_id, tier) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_deletePersisted(this.__wbg_ptr, ptr0, len0, ptr1, len1);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Delete a row immediately, returning the logical batch id that tracks
	* replayable persisted fate for this write, scoped to an explicit session
	* principal or transactional write context.
	* @param {string} object_id
	* @param {string | null | undefined} write_context_json
	* @param {string} tier
	* @returns {any}
	*/
	deletePersistedWithSession(object_id, write_context_json, tier) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(write_context_json) ? 0 : passStringToWasm0(write_context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_deletePersistedWithSession(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Delete a row by ObjectId as an explicit session principal.
	* @param {string} object_id
	* @param {string | null} [write_context_json]
	* @returns {any}
	*/
	deleteWithSession(object_id, write_context_json) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(write_context_json) ? 0 : passStringToWasm0(write_context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_deleteWithSession(this.__wbg_ptr, ptr0, len0, ptr1, len1);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} seed_b64
	* @returns {string}
	*/
	static deriveUserId(seed_b64) {
		let deferred3_0;
		let deferred3_1;
		try {
			const ptr0 = passStringToWasm0(seed_b64, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmruntime_deriveUserId(ptr0, len0);
			var ptr2 = ret[0];
			var len2 = ret[1];
			if (ret[3]) {
				ptr2 = 0;
				len2 = 0;
				throw takeFromExternrefTable0(ret[2]);
			}
			deferred3_0 = ptr2;
			deferred3_1 = len2;
			return getStringFromWasm0(ptr2, len2);
		} finally {
			wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
		}
	}
	/**
	* Disconnect from the Jazz server and drop the transport handle.
	*/
	disconnect() {
		wasm.wasmruntime_disconnect(this.__wbg_ptr);
	}
	/**
	* @returns {any}
	*/
	drainRejectedBatchIds() {
		const ret = wasm.wasmruntime_drainRejectedBatchIds(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Phase 2 of 2-phase subscribe: compile graph, register subscription,
	* sync to servers, attach callback, and deliver the first delta.
	*
	* No-ops silently if the handle was already unsubscribed.
	* @param {number} handle
	* @param {Function} on_update
	*/
	executeSubscription(handle, on_update) {
		const ret = wasm.wasmruntime_executeSubscription(this.__wbg_ptr, handle, on_update);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Flush all data to persistent storage (snapshot).
	*/
	flush() {
		wasm.wasmruntime_flush(this.__wbg_ptr);
	}
	/**
	* Flush only the WAL buffer to OPFS (not the snapshot).
	*/
	flushWal() {
		wasm.wasmruntime_flushWal(this.__wbg_ptr);
	}
	/**
	* @param {string} seed_b64
	* @returns {string}
	*/
	static getPublicKeyBase64url(seed_b64) {
		let deferred3_0;
		let deferred3_1;
		try {
			const ptr0 = passStringToWasm0(seed_b64, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmruntime_getPublicKeyBase64url(ptr0, len0);
			var ptr2 = ret[0];
			var len2 = ret[1];
			if (ret[3]) {
				ptr2 = 0;
				len2 = 0;
				throw takeFromExternrefTable0(ret[2]);
			}
			deferred3_0 = ptr2;
			deferred3_1 = len2;
			return getStringFromWasm0(ptr2, len2);
		} finally {
			wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
		}
	}
	/**
	* Get the current schema as JSON.
	* @returns {any}
	*/
	getSchema() {
		const ret = wasm.wasmruntime_getSchema(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Get the canonical schema hash (64-char hex).
	* @returns {string}
	*/
	getSchemaHash() {
		let deferred1_0;
		let deferred1_1;
		try {
			const ret = wasm.wasmruntime_getSchemaHash(this.__wbg_ptr);
			deferred1_0 = ret[0];
			deferred1_1 = ret[1];
			return getStringFromWasm0(ret[0], ret[1]);
		} finally {
			wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
		}
	}
	/**
	* Insert a row into a table.
	*
	* # Returns
	* The inserted row as `{ id, values, batchId }`.
	* @param {string} table
	* @param {any} values
	* @param {string | null} [object_id]
	* @returns {any}
	*/
	insert(table, values, object_id) {
		const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(object_id) ? 0 : passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_insert(this.__wbg_ptr, ptr0, len0, values, ptr1, len1);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Insert a row immediately, returning the logical batch id that tracks
	* replayable persisted fate for this write.
	* @param {string} table
	* @param {any} values
	* @param {string} tier
	* @returns {any}
	*/
	insertPersisted(table, values, tier) {
		const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_insertPersisted(this.__wbg_ptr, ptr0, len0, values, ptr1, len1);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Insert a row immediately, returning the logical batch id that tracks
	* replayable persisted fate for this write, scoped to an explicit session
	* principal or transactional write context.
	* @param {string} table
	* @param {any} values
	* @param {string | null | undefined} write_context_json
	* @param {string} tier
	* @returns {any}
	*/
	insertPersistedWithSession(table, values, write_context_json, tier) {
		const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(write_context_json) ? 0 : passStringToWasm0(write_context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_insertPersistedWithSession(this.__wbg_ptr, ptr0, len0, values, ptr1, len1, ptr2, len2);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Insert a row into a table as an explicit session principal.
	* @param {string} table
	* @param {any} values
	* @param {string | null} [write_context_json]
	* @param {string | null} [object_id]
	* @returns {any}
	*/
	insertWithSession(table, values, write_context_json, object_id) {
		const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(write_context_json) ? 0 : passStringToWasm0(write_context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		var ptr2 = isLikeNone(object_id) ? 0 : passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len2 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_insertWithSession(this.__wbg_ptr, ptr0, len0, values, ptr1, len1, ptr2, len2);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} batch_id
	* @returns {any}
	*/
	loadLocalBatchRecord(batch_id) {
		const ptr0 = passStringToWasm0(batch_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_loadLocalBatchRecord(this.__wbg_ptr, ptr0, len0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @returns {any}
	*/
	loadLocalBatchRecords() {
		const ret = wasm.wasmruntime_loadLocalBatchRecords(this.__wbg_ptr);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* @param {string} seed_b64
	* @param {string} issuer
	* @param {string} audience
	* @param {bigint} ttl_seconds
	* @param {bigint} now_seconds
	* @returns {string}
	*/
	static mintJazzSelfSignedToken(seed_b64, issuer, audience, ttl_seconds, now_seconds) {
		let deferred5_0;
		let deferred5_1;
		try {
			const ptr0 = passStringToWasm0(seed_b64, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ptr1 = passStringToWasm0(issuer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len1 = WASM_VECTOR_LEN;
			const ptr2 = passStringToWasm0(audience, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len2 = WASM_VECTOR_LEN;
			const ret = wasm.wasmruntime_mintJazzSelfSignedToken(ptr0, len0, ptr1, len1, ptr2, len2, ttl_seconds, now_seconds);
			var ptr4 = ret[0];
			var len4 = ret[1];
			if (ret[3]) {
				ptr4 = 0;
				len4 = 0;
				throw takeFromExternrefTable0(ret[2]);
			}
			deferred5_0 = ptr4;
			deferred5_1 = len4;
			return getStringFromWasm0(ptr4, len4);
		} finally {
			wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
		}
	}
	/**
	* Create a new WasmRuntime.
	*
	* Storage is synchronous (in-memory via MemoryStorage).
	*
	* # Arguments
	* * `schema_json` - JSON-encoded schema definition
	* * `app_id` - Application identifier
	* * `env` - Environment (e.g., "dev", "prod")
	* * `user_branch` - User's branch name (e.g., "main")
	* * `tier` - Optional node durability tier ("local", "edge", "global").
	*            Set for server nodes to enable ack emission.
	* * `use_binary_encoding` - Optional outgoing sync payload encoding mode.
	*   `Some(true)` emits postcard bytes (`Uint8Array`), otherwise JSON strings.
	* @param {string} schema_json
	* @param {string} app_id
	* @param {string} env
	* @param {string} user_branch
	* @param {string | null} [tier]
	* @param {boolean | null} [use_binary_encoding]
	*/
	constructor(schema_json, app_id, env, user_branch, tier, use_binary_encoding) {
		const ptr0 = passStringToWasm0(schema_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(app_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(env, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		const ptr3 = passStringToWasm0(user_branch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len3 = WASM_VECTOR_LEN;
		var ptr4 = isLikeNone(tier) ? 0 : passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len4 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, isLikeNone(use_binary_encoding) ? 16777215 : use_binary_encoding ? 1 : 0);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		this.__wbg_ptr = ret[0] >>> 0;
		WasmRuntimeFinalization.register(this, this.__wbg_ptr, this);
		return this;
	}
	/**
	* Register a JS callback that fires when the Rust transport receives an
	* auth failure (Unauthorized) from the server during the WS handshake.
	*
	* The callback receives a single string argument: a human-readable reason.
	* @param {Function} callback
	*/
	onAuthFailure(callback) {
		wasm.wasmruntime_onAuthFailure(this.__wbg_ptr, callback);
	}
	/**
	* Called by JS when a sync message arrives from the server.
	*
	* # Arguments
	* * `payload` - Either postcard-encoded SyncPayload bytes (`Uint8Array`)
	*   or JSON-encoded SyncPayload (`string`)
	* @param {any} payload
	* @param {number | null} [sequence]
	*/
	onSyncMessageReceived(payload, sequence) {
		const ret = wasm.wasmruntime_onSyncMessageReceived(this.__wbg_ptr, payload, !isLikeNone(sequence), isLikeNone(sequence) ? 0 : sequence);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Called by JS when a sync message arrives from a client (not a server).
	*
	* # Arguments
	* * `client_id` - UUID string of the sending client
	* * `payload` - Postcard-encoded SyncPayload bytes
	* @param {string} client_id
	* @param {any} payload
	*/
	onSyncMessageReceivedFromClient(client_id, payload) {
		const ptr0 = passStringToWasm0(client_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_onSyncMessageReceivedFromClient(this.__wbg_ptr, ptr0, len0, payload);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Register a callback for outgoing sync messages.
	* @param {Function} callback
	*/
	onSyncMessageToSend(callback) {
		wasm.wasmruntime_onSyncMessageToSend(this.__wbg_ptr, callback);
	}
	/**
	* Create an ephemeral WasmRuntime backed by in-memory storage.
	*
	* Data is not persisted across page loads. Used as a fallback when OPFS
	* is unavailable (e.g. Firefox private browsing mode).
	* @param {string} schema_json
	* @param {string} app_id
	* @param {string} env
	* @param {string} user_branch
	* @param {string} db_name
	* @param {string | null | undefined} tier
	* @param {boolean} use_binary_encoding
	* @returns {WasmRuntime}
	*/
	static openEphemeral(schema_json, app_id, env, user_branch, db_name, tier, use_binary_encoding) {
		const ptr0 = passStringToWasm0(schema_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(app_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(env, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		const ptr3 = passStringToWasm0(user_branch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len3 = WASM_VECTOR_LEN;
		const ptr4 = passStringToWasm0(db_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len4 = WASM_VECTOR_LEN;
		var ptr5 = isLikeNone(tier) ? 0 : passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len5 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_openEphemeral(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, use_binary_encoding);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return WasmRuntime.__wrap(ret[0]);
	}
	/**
	* Create a persistent WasmRuntime backed by OPFS.
	*
	* Opens a single OPFS file namespace and restores state from the latest
	* durable checkpoint.
	* @param {string} schema_json
	* @param {string} app_id
	* @param {string} env
	* @param {string} user_branch
	* @param {string} db_name
	* @param {string | null | undefined} tier
	* @param {boolean} use_binary_encoding
	* @returns {Promise<WasmRuntime>}
	*/
	static openPersistent(schema_json, app_id, env, user_branch, db_name, tier, use_binary_encoding) {
		const ptr0 = passStringToWasm0(schema_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(app_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(env, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		const ptr3 = passStringToWasm0(user_branch, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len3 = WASM_VECTOR_LEN;
		const ptr4 = passStringToWasm0(db_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len4 = WASM_VECTOR_LEN;
		var ptr5 = isLikeNone(tier) ? 0 : passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len5 = WASM_VECTOR_LEN;
		return wasm.wasmruntime_openPersistent(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, use_binary_encoding);
	}
	/**
	* Execute a query and return results as a Promise.
	*
	* Optional durability tier controls remote settlement behavior.
	* @param {string} query_json
	* @param {string | null} [session_json]
	* @param {string | null} [settled_tier]
	* @param {string | null} [options_json]
	* @returns {Promise<any>}
	*/
	query(query_json, session_json, settled_tier, options_json) {
		const ptr0 = passStringToWasm0(query_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(session_json) ? 0 : passStringToWasm0(session_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		var ptr2 = isLikeNone(settled_tier) ? 0 : passStringToWasm0(settled_tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len2 = WASM_VECTOR_LEN;
		var ptr3 = isLikeNone(options_json) ? 0 : passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len3 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_query(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Remove the current upstream server connection.
	*/
	removeServer() {
		wasm.wasmruntime_removeServer(this.__wbg_ptr);
	}
	/**
	* @param {string} batch_id
	*/
	sealBatch(batch_id) {
		const ptr0 = passStringToWasm0(batch_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_sealBatch(this.__wbg_ptr, ptr0, len0);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Set a client's role.
	*
	* # Arguments
	* * `client_id` - UUID string of the client
	* * `role` - One of "user", "admin", "peer"
	* @param {string} client_id
	* @param {string} role
	*/
	setClientRole(client_id, role) {
		const ptr0 = passStringToWasm0(client_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_setClientRole(this.__wbg_ptr, ptr0, len0, ptr1, len1);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Subscribe to a query with a callback.
	*
	* Default behavior matches RuntimeCore:
	* - with upstream server: first callback waits for protocol QuerySettled convergence
	* - without upstream server: first callback is local-immediate
	*
	* Pass durability options to override this default.
	*
	* # Returns
	* Subscription handle (f64) for later unsubscription.
	* @param {string} query_json
	* @param {Function} on_update
	* @param {string | null} [session_json]
	* @param {string | null} [settled_tier]
	* @param {string | null} [options_json]
	* @returns {number}
	*/
	subscribe(query_json, on_update, session_json, settled_tier, options_json) {
		const ptr0 = passStringToWasm0(query_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(session_json) ? 0 : passStringToWasm0(session_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		var ptr2 = isLikeNone(settled_tier) ? 0 : passStringToWasm0(settled_tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len2 = WASM_VECTOR_LEN;
		var ptr3 = isLikeNone(options_json) ? 0 : passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len3 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_subscribe(this.__wbg_ptr, ptr0, len0, on_update, ptr1, len1, ptr2, len2, ptr3, len3);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return ret[0];
	}
	/**
	* Unsubscribe from a query.
	* @param {number} handle
	*/
	unsubscribe(handle) {
		wasm.wasmruntime_unsubscribe(this.__wbg_ptr, handle);
	}
	/**
	* Update a row by ObjectId.
	* @param {string} object_id
	* @param {any} values
	* @returns {any}
	*/
	update(object_id, values) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_update(this.__wbg_ptr, ptr0, len0, values);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Push updated auth credentials into the live transport.
	* @param {string} auth_json
	*/
	updateAuth(auth_json) {
		const ptr0 = passStringToWasm0(auth_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_updateAuth(this.__wbg_ptr, ptr0, len0);
		if (ret[1]) throw takeFromExternrefTable0(ret[0]);
	}
	/**
	* Update a row immediately, returning the logical batch id that tracks
	* replayable persisted fate for this write.
	* @param {string} object_id
	* @param {any} values
	* @param {string} tier
	* @returns {any}
	*/
	updatePersisted(object_id, values, tier) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_updatePersisted(this.__wbg_ptr, ptr0, len0, values, ptr1, len1);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Update a row immediately, returning the logical batch id that tracks
	* replayable persisted fate for this write, scoped to an explicit session
	* principal or transactional write context.
	* @param {string} object_id
	* @param {any} values
	* @param {string | null | undefined} write_context_json
	* @param {string} tier
	* @returns {any}
	*/
	updatePersistedWithSession(object_id, values, write_context_json, tier) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(write_context_json) ? 0 : passStringToWasm0(write_context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_updatePersistedWithSession(this.__wbg_ptr, ptr0, len0, values, ptr1, len1, ptr2, len2);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
	/**
	* Update a row by ObjectId as an explicit session principal.
	*
	* # Arguments
	* * `object_id` - UUID string of target object
	* * `values` - Partial update map (`{ columnName: Value }`)
	* * `session_json` - Optional JSON-encoded Session used for policy checks
	* @param {string} object_id
	* @param {any} values
	* @param {string | null} [write_context_json]
	* @returns {any}
	*/
	updateWithSession(object_id, values, write_context_json) {
		const ptr0 = passStringToWasm0(object_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		var ptr1 = isLikeNone(write_context_json) ? 0 : passStringToWasm0(write_context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		var len1 = WASM_VECTOR_LEN;
		const ret = wasm.wasmruntime_updateWithSession(this.__wbg_ptr, ptr0, len0, values, ptr1, len1);
		if (ret[2]) throw takeFromExternrefTable0(ret[1]);
		return takeFromExternrefTable0(ret[0]);
	}
};
if (Symbol.dispose) WasmRuntime.prototype[Symbol.dispose] = WasmRuntime.prototype.free;
/**
* @returns {number}
*/
function bench_get_cache_bytes() {
	return wasm.bench_get_cache_bytes() >>> 0;
}
/**
* @returns {number}
*/
function bench_get_overflow_threshold_bytes() {
	return wasm.bench_get_overflow_threshold_bytes() >>> 0;
}
/**
* @returns {boolean}
*/
function bench_get_pin_internal_pages() {
	return wasm.bench_get_pin_internal_pages() !== 0;
}
/**
* @returns {number}
*/
function bench_get_read_coalesce_pages() {
	return wasm.bench_get_read_coalesce_pages() >>> 0;
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_cold_random_read(count, value_size) {
	return wasm.bench_opfs_cold_random_read(count, value_size);
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_cold_sequential_read(count, value_size) {
	return wasm.bench_opfs_cold_sequential_read(count, value_size);
}
/**
* @param {number} count
* @returns {Promise<any>}
*/
function bench_opfs_matrix(count) {
	return wasm.bench_opfs_matrix(count);
}
/**
* @param {number} count
* @returns {Promise<any>}
*/
function bench_opfs_mixed_matrix(count) {
	return wasm.bench_opfs_mixed_matrix(count);
}
/**
* @param {string} scenario_name
* @param {number} count
* @param {number} value_size
* @param {bigint | null} [base_seed]
* @returns {Promise<any>}
*/
function bench_opfs_mixed_scenario(scenario_name, count, value_size, base_seed) {
	const ptr0 = passStringToWasm0(scenario_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	return wasm.bench_opfs_mixed_scenario(ptr0, len0, count, value_size, !isLikeNone(base_seed), isLikeNone(base_seed) ? BigInt(0) : base_seed);
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_random_read(count, value_size) {
	return wasm.bench_opfs_random_read(count, value_size);
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_random_write(count, value_size) {
	return wasm.bench_opfs_random_write(count, value_size);
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_range_random_window(count, value_size) {
	return wasm.bench_opfs_range_random_window(count, value_size);
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_range_seq_window(count, value_size) {
	return wasm.bench_opfs_range_seq_window(count, value_size);
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_sequential_read(count, value_size) {
	return wasm.bench_opfs_sequential_read(count, value_size);
}
/**
* @param {number} count
* @param {number} value_size
* @returns {Promise<any>}
*/
function bench_opfs_sequential_write(count, value_size) {
	return wasm.bench_opfs_sequential_write(count, value_size);
}
function bench_reset_cache_bytes() {
	wasm.bench_reset_cache_bytes();
}
function bench_reset_overflow_threshold_bytes() {
	wasm.bench_reset_overflow_threshold_bytes();
}
function bench_reset_pin_internal_pages() {
	wasm.bench_reset_pin_internal_pages();
}
function bench_reset_read_coalesce_pages() {
	wasm.bench_reset_read_coalesce_pages();
}
/**
* @param {number} cache_bytes
*/
function bench_set_cache_bytes(cache_bytes) {
	const ret = wasm.bench_set_cache_bytes(cache_bytes);
	if (ret[1]) throw takeFromExternrefTable0(ret[0]);
}
/**
* @param {number} overflow_threshold_bytes
*/
function bench_set_overflow_threshold_bytes(overflow_threshold_bytes) {
	const ret = wasm.bench_set_overflow_threshold_bytes(overflow_threshold_bytes);
	if (ret[1]) throw takeFromExternrefTable0(ret[0]);
}
/**
* @param {boolean} pin_internal_pages
*/
function bench_set_pin_internal_pages(pin_internal_pages) {
	wasm.bench_set_pin_internal_pages(pin_internal_pages);
}
/**
* @param {number} read_coalesce_pages
*/
function bench_set_read_coalesce_pages(read_coalesce_pages) {
	const ret = wasm.bench_set_read_coalesce_pages(read_coalesce_pages);
	if (ret[1]) throw takeFromExternrefTable0(ret[0]);
}
/**
* Get the current timestamp in microseconds since Unix epoch.
* @returns {bigint}
*/
function currentTimestamp() {
	const ret = wasm.currentTimestamp();
	return BigInt.asUintN(64, ret);
}
/**
* Generate a new UUID v7 (time-ordered).
*
* Useful when a caller wants the default generated row-id shape.
* @returns {string}
*/
function generateId() {
	let deferred1_0;
	let deferred1_1;
	try {
		const ret = wasm.generateId();
		deferred1_0 = ret[0];
		deferred1_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
	}
}
/**
* Initialize the WASM module.
*
* Sets up panic hook for better error messages in the browser console.
*/
function init() {
	wasm.init();
}
/**
* Parse a schema from JSON string.
*
* Returns the schema as a JsValue for inspection.
* @param {string} json
* @returns {any}
*/
function parseSchema(json) {
	const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.parseSchema(ptr0, len0);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
function __wbg_get_imports() {
	return {
		__proto__: null,
		"./jazz_wasm_bg.js": {
			__proto__: null,
			__wbg_Error_2e59b1b37a9a34c3: function(arg0, arg1) {
				return Error(getStringFromWasm0(arg0, arg1));
			},
			__wbg_Number_e6ffdb596c888833: function(arg0) {
				return Number(arg0);
			},
			__wbg_String_8564e559799eccda: function(arg0, arg1) {
				const ptr1 = passStringToWasm0(String(arg1), wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_bigint_get_as_i64_2c5082002e4826e2: function(arg0, arg1) {
				const v = arg1;
				const ret = typeof v === "bigint" ? v : void 0;
				getDataViewMemory0().setBigInt64(arg0 + 8, isLikeNone(ret) ? BigInt(0) : ret, true);
				getDataViewMemory0().setInt32(arg0 + 0, !isLikeNone(ret), true);
			},
			__wbg___wbindgen_boolean_get_a86c216575a75c30: function(arg0) {
				const v = arg0;
				const ret = typeof v === "boolean" ? v : void 0;
				return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
			},
			__wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: function(arg0, arg1) {
				const ptr1 = passStringToWasm0(debugString(arg1), wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_in_4bd7a57e54337366: function(arg0, arg1) {
				return arg0 in arg1;
			},
			__wbg___wbindgen_is_bigint_6c98f7e945dacdde: function(arg0) {
				return typeof arg0 === "bigint";
			},
			__wbg___wbindgen_is_function_49868bde5eb1e745: function(arg0) {
				return typeof arg0 === "function";
			},
			__wbg___wbindgen_is_null_344c8750a8525473: function(arg0) {
				return arg0 === null;
			},
			__wbg___wbindgen_is_object_40c5a80572e8f9d3: function(arg0) {
				const val = arg0;
				return typeof val === "object" && val !== null;
			},
			__wbg___wbindgen_is_string_b29b5c5a8065ba1a: function(arg0) {
				return typeof arg0 === "string";
			},
			__wbg___wbindgen_is_undefined_c0cca72b82b86f4d: function(arg0) {
				return arg0 === void 0;
			},
			__wbg___wbindgen_jsval_eq_7d430e744a913d26: function(arg0, arg1) {
				return arg0 === arg1;
			},
			__wbg___wbindgen_jsval_loose_eq_3a72ae764d46d944: function(arg0, arg1) {
				return arg0 == arg1;
			},
			__wbg___wbindgen_number_get_7579aab02a8a620c: function(arg0, arg1) {
				const obj = arg1;
				const ret = typeof obj === "number" ? obj : void 0;
				getDataViewMemory0().setFloat64(arg0 + 8, isLikeNone(ret) ? 0 : ret, true);
				getDataViewMemory0().setInt32(arg0 + 0, !isLikeNone(ret), true);
			},
			__wbg___wbindgen_string_get_914df97fcfa788f2: function(arg0, arg1) {
				const obj = arg1;
				const ret = typeof obj === "string" ? obj : void 0;
				var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				var len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {
				throw new Error(getStringFromWasm0(arg0, arg1));
			},
			__wbg__wbg_cb_unref_3c3b4f651835fbcb: function(arg0) {
				arg0._wbg_cb_unref();
			},
			__wbg_call_368fa9c372d473ba: function() {
				return handleError(function(arg0, arg1, arg2, arg3) {
					return arg0.call(arg1, arg2, arg3);
				}, arguments);
			},
			__wbg_call_7f2987183bb62793: function() {
				return handleError(function(arg0, arg1) {
					return arg0.call(arg1);
				}, arguments);
			},
			__wbg_call_d578befcc3145dee: function() {
				return handleError(function(arg0, arg1, arg2) {
					return arg0.call(arg1, arg2);
				}, arguments);
			},
			__wbg_call_e0f65243b4670302: function() {
				return handleError(function(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
					return arg0.call(arg1, arg2, arg3, arg4, arg5, arg6);
				}, arguments);
			},
			__wbg_clearTimeout_113b1cde814ec762: function(arg0) {
				return clearTimeout(arg0);
			},
			__wbg_close_e526ab9e090e8cc1: function(arg0) {
				arg0.close();
			},
			__wbg_close_f181fdc02ee236e6: function() {
				return handleError(function(arg0) {
					arg0.close();
				}, arguments);
			},
			__wbg_code_8b9f98f9216b2f10: function(arg0) {
				return arg0.code;
			},
			__wbg_code_c96efa5c1a80b2d9: function(arg0) {
				return arg0.code;
			},
			__wbg_createSyncAccessHandle_3be98daf699667a7: function(arg0) {
				return arg0.createSyncAccessHandle();
			},
			__wbg_crypto_38df2bab126b63dc: function(arg0) {
				return arg0.crypto;
			},
			__wbg_data_60b50110c5bd9349: function(arg0) {
				return arg0.data;
			},
			__wbg_debug_32973ac940f2ca14: function(arg0, arg1) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.debug(getStringFromWasm0(arg0, arg1));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_debug_982454fce39f6582: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.debug(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_done_547d467e97529006: function(arg0) {
				return arg0.done;
			},
			__wbg_entries_616b1a459b85be0b: function(arg0) {
				return Object.entries(arg0);
			},
			__wbg_error_1fd0a521bc586cb5: function(arg0, arg1) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.error(getStringFromWasm0(arg0, arg1));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_error_87093280954deb60: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.error(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.error(getStringFromWasm0(arg0, arg1));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_flush_63f2ba6bf37bcfd5: function() {
				return handleError(function(arg0) {
					arg0.flush();
				}, arguments);
			},
			__wbg_getDirectory_3af764c18446017f: function(arg0) {
				return arg0.getDirectory();
			},
			__wbg_getFileHandle_326ca47811ae37a1: function(arg0, arg1, arg2, arg3) {
				return arg0.getFileHandle(getStringFromWasm0(arg1, arg2), arg3);
			},
			__wbg_getRandomValues_3f44b700395062e5: function() {
				return handleError(function(arg0, arg1) {
					globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
				}, arguments);
			},
			__wbg_getRandomValues_c44a50d8cfdaebeb: function() {
				return handleError(function(arg0, arg1) {
					arg0.getRandomValues(arg1);
				}, arguments);
			},
			__wbg_getRandomValues_d49329ff89a07af1: function() {
				return handleError(function(arg0, arg1) {
					globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
				}, arguments);
			},
			__wbg_getSize_6037025a1b5d08db: function() {
				return handleError(function(arg0) {
					return arg0.getSize();
				}, arguments);
			},
			__wbg_get_4848e350b40afc16: function(arg0, arg1) {
				return arg0[arg1 >>> 0];
			},
			__wbg_get_ed0642c4b9d31ddf: function() {
				return handleError(function(arg0, arg1) {
					return Reflect.get(arg0, arg1);
				}, arguments);
			},
			__wbg_get_f96702c6245e4ef9: function() {
				return handleError(function(arg0, arg1) {
					return Reflect.get(arg0, arg1);
				}, arguments);
			},
			__wbg_get_unchecked_7d7babe32e9e6a54: function(arg0, arg1) {
				return arg0[arg1 >>> 0];
			},
			__wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
				return arg0[arg1];
			},
			__wbg_instanceof_ArrayBuffer_ff7c1337a5e3b33a: function(arg0) {
				let result;
				try {
					result = arg0 instanceof ArrayBuffer;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_Blob_6b3922471f5ba34c: function(arg0) {
				let result;
				try {
					result = arg0 instanceof Blob;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_DomException_37f96d3fb69189bd: function(arg0) {
				let result;
				try {
					result = arg0 instanceof DOMException;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_FileSystemDirectoryHandle_66b8b1a90ca7b685: function(arg0) {
				let result;
				try {
					result = arg0 instanceof FileSystemDirectoryHandle;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_FileSystemFileHandle_2236115c7caa5120: function(arg0) {
				let result;
				try {
					result = arg0 instanceof FileSystemFileHandle;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_FileSystemSyncAccessHandle_0a420b0443c563b7: function(arg0) {
				let result;
				try {
					result = arg0 instanceof FileSystemSyncAccessHandle;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_Map_a10a2795ef4bfe97: function(arg0) {
				let result;
				try {
					result = arg0 instanceof Map;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_Promise_95d523058012a13d: function(arg0) {
				let result;
				try {
					result = arg0 instanceof Promise;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_Uint8Array_4b8da683deb25d72: function(arg0) {
				let result;
				try {
					result = arg0 instanceof Uint8Array;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_WorkerGlobalScope_2b48dbfbe7327543: function(arg0) {
				let result;
				try {
					result = arg0 instanceof WorkerGlobalScope;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_isArray_db61795ad004c139: function(arg0) {
				return Array.isArray(arg0);
			},
			__wbg_isSafeInteger_ea83862ba994770c: function(arg0) {
				return Number.isSafeInteger(arg0);
			},
			__wbg_iterator_de403ef31815a3e6: function() {
				return Symbol.iterator;
			},
			__wbg_length_0c32cb8543c8e4c8: function(arg0) {
				return arg0.length;
			},
			__wbg_length_6e821edde497a532: function(arg0) {
				return arg0.length;
			},
			__wbg_log_6a8b55ee2e172f54: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.log(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_log_a25c2a4d205f1618: function(arg0, arg1) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.log(getStringFromWasm0(arg0, arg1));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_mark_e4b209bb53de57a7: function(arg0, arg1) {
				performance.mark(getStringFromWasm0(arg0, arg1));
			},
			__wbg_measure_0cab89f3addcdc37: function() {
				return handleError(function(arg0, arg1, arg2, arg3) {
					let deferred0_0;
					let deferred0_1;
					let deferred1_0;
					let deferred1_1;
					try {
						deferred0_0 = arg0;
						deferred0_1 = arg1;
						deferred1_0 = arg2;
						deferred1_1 = arg3;
						performance.measure(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
					} finally {
						wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
						wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
					}
				}, arguments);
			},
			__wbg_message_52a9425f28c45ebc: function(arg0, arg1) {
				const ret = arg1.message;
				const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
				return arg0.msCrypto;
			},
			__wbg_name_d7bb38b41d6d953e: function(arg0, arg1) {
				const ret = arg1.name;
				const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg_navigator_af52153252bdf29d: function(arg0) {
				return arg0.navigator;
			},
			__wbg_new_227d7c05414eb861: function() {
				return /* @__PURE__ */ new Error();
			},
			__wbg_new_40792555590ec35c: function(arg0, arg1) {
				try {
					var state0 = {
						a: arg0,
						b: arg1
					};
					var cb0 = (arg0, arg1) => {
						const a = state0.a;
						state0.a = 0;
						try {
							return wasm_bindgen__convert__closures_____invoke__h250bbd6a67e0e1e6(a, state0.b, arg0, arg1);
						} finally {
							state0.a = a;
						}
					};
					return new Promise(cb0);
				} finally {
					state0.a = 0;
				}
			},
			__wbg_new_4f9fafbb3909af72: function() {
				return /* @__PURE__ */ new Object();
			},
			__wbg_new_99cabae501c0a8a0: function() {
				return /* @__PURE__ */ new Map();
			},
			__wbg_new_a2d8434834334bbf: function() {
				return handleError(function(arg0, arg1) {
					return new WebSocket(getStringFromWasm0(arg0, arg1));
				}, arguments);
			},
			__wbg_new_a560378ea1240b14: function(arg0) {
				return new Uint8Array(arg0);
			},
			__wbg_new_e3b04b4d53d1b593: function(arg0, arg1) {
				return new Error(getStringFromWasm0(arg0, arg1));
			},
			__wbg_new_f3c9df4f38f3f798: function() {
				return new Array();
			},
			__wbg_new_from_slice_2580ff33d0d10520: function(arg0, arg1) {
				return new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
			},
			__wbg_new_typed_14d7cc391ce53d2c: function(arg0, arg1) {
				try {
					var state0 = {
						a: arg0,
						b: arg1
					};
					var cb0 = (arg0, arg1) => {
						const a = state0.a;
						state0.a = 0;
						try {
							return wasm_bindgen__convert__closures_____invoke__h250bbd6a67e0e1e6(a, state0.b, arg0, arg1);
						} finally {
							state0.a = a;
						}
					};
					return new Promise(cb0);
				} finally {
					state0.a = 0;
				}
			},
			__wbg_new_with_length_9cedd08484b73942: function(arg0) {
				return new Uint8Array(arg0 >>> 0);
			},
			__wbg_new_with_str_sequence_e6b5bb982fdcf253: function() {
				return handleError(function(arg0, arg1, arg2) {
					return new WebSocket(getStringFromWasm0(arg0, arg1), arg2);
				}, arguments);
			},
			__wbg_next_01132ed6134b8ef5: function(arg0) {
				return arg0.next;
			},
			__wbg_next_b3713ec761a9dbfd: function() {
				return handleError(function(arg0) {
					return arg0.next();
				}, arguments);
			},
			__wbg_node_84ea875411254db1: function(arg0) {
				return arg0.node;
			},
			__wbg_now_6798946be0e6fe2b: function() {
				return handleError(function() {
					return Date.now();
				}, arguments);
			},
			__wbg_now_88621c9c9a4f3ffc: function() {
				return Date.now();
			},
			__wbg_now_e7c6795a7f81e10f: function(arg0) {
				return arg0.now();
			},
			__wbg_performance_3fcf6e32a7e1ed0a: function(arg0) {
				return arg0.performance;
			},
			__wbg_process_44c7a14e11e9f69e: function(arg0) {
				return arg0.process;
			},
			__wbg_prototypesetcall_3e05eb9545565046: function(arg0, arg1, arg2) {
				Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
			},
			__wbg_push_6bdbc990be5ac37b: function(arg0, arg1) {
				return arg0.push(arg1);
			},
			__wbg_queueMicrotask_abaf92f0bd4e80a4: function(arg0) {
				return arg0.queueMicrotask;
			},
			__wbg_queueMicrotask_df5a6dac26d818f3: function(arg0) {
				queueMicrotask(arg0);
			},
			__wbg_randomFillSync_6c25eac9869eb53c: function() {
				return handleError(function(arg0, arg1) {
					arg0.randomFillSync(arg1);
				}, arguments);
			},
			__wbg_random_a72d453e63c9558c: function() {
				return Math.random();
			},
			__wbg_read_8569bf7e69cc3089: function() {
				return handleError(function(arg0, arg1, arg2, arg3) {
					return arg0.read(getArrayU8FromWasm0(arg1, arg2), arg3);
				}, arguments);
			},
			__wbg_readyState_631d9f7c37e595d7: function(arg0) {
				return arg0.readyState;
			},
			__wbg_reason_85e58391371e868d: function(arg0, arg1) {
				const ret = arg1.reason;
				const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg_require_b4edbdcf3e2a1ef0: function() {
				return handleError(function() {
					return module.require;
				}, arguments);
			},
			__wbg_resolve_0a79de24e9d2267b: function(arg0) {
				return Promise.resolve(arg0);
			},
			__wbg_send_4f53c94146f0274d: function() {
				return handleError(function(arg0, arg1, arg2) {
					arg0.send(getStringFromWasm0(arg1, arg2));
				}, arguments);
			},
			__wbg_send_64dd480ad0d86a31: function() {
				return handleError(function(arg0, arg1, arg2) {
					arg0.send(getArrayU8FromWasm0(arg1, arg2));
				}, arguments);
			},
			__wbg_setTimeout_90ea1b70d376baa9: function(arg0, arg1) {
				setTimeout(arg0, arg1);
			},
			__wbg_setTimeout_ef24d2fc3ad97385: function() {
				return handleError(function(arg0, arg1) {
					return setTimeout(arg0, arg1);
				}, arguments);
			},
			__wbg_set_08463b1df38a7e29: function(arg0, arg1, arg2) {
				return arg0.set(arg1, arg2);
			},
			__wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
				arg0[arg1] = arg2;
			},
			__wbg_set_6c60b2e8ad0e9383: function(arg0, arg1, arg2) {
				arg0[arg1 >>> 0] = arg2;
			},
			__wbg_set_8ee2d34facb8466e: function() {
				return handleError(function(arg0, arg1, arg2) {
					return Reflect.set(arg0, arg1, arg2);
				}, arguments);
			},
			__wbg_set_at_da2d1d4dc8ed37da: function(arg0, arg1) {
				arg0.at = arg1;
			},
			__wbg_set_binaryType_95c0a0f7586a3903: function(arg0, arg1) {
				arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
			},
			__wbg_set_create_0654e513e8ccb2be: function(arg0, arg1) {
				arg0.create = arg1 !== 0;
			},
			__wbg_set_name_ab9c98596fd7310a: function(arg0, arg1, arg2) {
				arg0.name = getStringFromWasm0(arg1, arg2);
			},
			__wbg_set_onclose_47cce56c686db4fb: function(arg0, arg1) {
				arg0.onclose = arg1;
			},
			__wbg_set_onerror_3db8bc3e52b2b10b: function(arg0, arg1) {
				arg0.onerror = arg1;
			},
			__wbg_set_onmessage_45bd33b110c54f5b: function(arg0, arg1) {
				arg0.onmessage = arg1;
			},
			__wbg_set_onopen_7ffeb01f8a628209: function(arg0, arg1) {
				arg0.onopen = arg1;
			},
			__wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
				const ret = arg1.stack;
				const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: function() {
				const ret = typeof globalThis === "undefined" ? null : globalThis;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_static_accessor_GLOBAL_f2e0f995a21329ff: function() {
				const ret = typeof global === "undefined" ? null : global;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_static_accessor_SELF_24f78b6d23f286ea: function() {
				const ret = typeof self === "undefined" ? null : self;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_static_accessor_WINDOW_59fd959c540fe405: function() {
				const ret = typeof window === "undefined" ? null : window;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_storage_1d7efd3b54b4e6e9: function(arg0) {
				return arg0.storage;
			},
			__wbg_subarray_0f98d3fb634508ad: function(arg0, arg1, arg2) {
				return arg0.subarray(arg1 >>> 0, arg2 >>> 0);
			},
			__wbg_then_00eed3ac0b8e82cb: function(arg0, arg1, arg2) {
				return arg0.then(arg1, arg2);
			},
			__wbg_then_a0c8db0381c8994c: function(arg0, arg1) {
				return arg0.then(arg1);
			},
			__wbg_url_b9fa55c409492e65: function(arg0, arg1) {
				const ret = arg1.url;
				const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg_value_7f6052747ccf940f: function(arg0) {
				return arg0.value;
			},
			__wbg_versions_276b2795b1c6a219: function(arg0) {
				return arg0.versions;
			},
			__wbg_warn_173c62eb2a78dd0b: function(arg0, arg1) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.warn(getStringFromWasm0(arg0, arg1));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_warn_783eb0d84a16b85c: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.warn(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_wasClean_919e018e809fd9da: function(arg0) {
				return arg0.wasClean;
			},
			__wbg_wasmruntime_new: function(arg0) {
				return WasmRuntime.__wrap(arg0);
			},
			__wbg_write_726121caffd5fc3e: function() {
				return handleError(function(arg0, arg1, arg2, arg3) {
					return arg0.write(getArrayU8FromWasm0(arg1, arg2), arg3);
				}, arguments);
			},
			__wbindgen_cast_0000000000000001: function(arg0, arg1) {
				return makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h656199c36535c3e6);
			},
			__wbindgen_cast_0000000000000002: function(arg0, arg1) {
				return makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hf7ddf3622752ec36);
			},
			__wbindgen_cast_0000000000000003: function(arg0, arg1) {
				return makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hc18e08680cddc2e5);
			},
			__wbindgen_cast_0000000000000004: function(arg0, arg1) {
				return makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h03757a48b3eba690);
			},
			__wbindgen_cast_0000000000000005: function(arg0) {
				return arg0;
			},
			__wbindgen_cast_0000000000000006: function(arg0) {
				return arg0;
			},
			__wbindgen_cast_0000000000000007: function(arg0, arg1) {
				return getArrayU8FromWasm0(arg0, arg1);
			},
			__wbindgen_cast_0000000000000008: function(arg0, arg1) {
				return getStringFromWasm0(arg0, arg1);
			},
			__wbindgen_cast_0000000000000009: function(arg0) {
				return BigInt.asUintN(64, arg0);
			},
			__wbindgen_init_externref_table: function() {
				const table = wasm.__wbindgen_externrefs;
				const offset = table.grow(4);
				table.set(0, void 0);
				table.set(offset + 0, void 0);
				table.set(offset + 1, null);
				table.set(offset + 2, true);
				table.set(offset + 3, false);
			}
		}
	};
}
function wasm_bindgen__convert__closures_____invoke__h03757a48b3eba690(arg0, arg1) {
	wasm.wasm_bindgen__convert__closures_____invoke__h03757a48b3eba690(arg0, arg1);
}
function wasm_bindgen__convert__closures_____invoke__hf7ddf3622752ec36(arg0, arg1, arg2) {
	wasm.wasm_bindgen__convert__closures_____invoke__hf7ddf3622752ec36(arg0, arg1, arg2);
}
function wasm_bindgen__convert__closures_____invoke__hc18e08680cddc2e5(arg0, arg1, arg2) {
	wasm.wasm_bindgen__convert__closures_____invoke__hc18e08680cddc2e5(arg0, arg1, arg2);
}
function wasm_bindgen__convert__closures_____invoke__h656199c36535c3e6(arg0, arg1, arg2) {
	const ret = wasm.wasm_bindgen__convert__closures_____invoke__h656199c36535c3e6(arg0, arg1, arg2);
	if (ret[1]) throw takeFromExternrefTable0(ret[0]);
}
function wasm_bindgen__convert__closures_____invoke__h250bbd6a67e0e1e6(arg0, arg1, arg2, arg3) {
	wasm.wasm_bindgen__convert__closures_____invoke__h250bbd6a67e0e1e6(arg0, arg1, arg2, arg3);
}
var __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];
var WasmQueryBuilderFinalization = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((ptr) => wasm.__wbg_wasmquerybuilder_free(ptr >>> 0, 1));
var WasmRuntimeFinalization = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((ptr) => wasm.__wbg_wasmruntime_free(ptr >>> 0, 1));
function addToExternrefTable0(obj) {
	const idx = wasm.__externref_table_alloc();
	wasm.__wbindgen_externrefs.set(idx, obj);
	return idx;
}
var CLOSURE_DTORS = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((state) => wasm.__wbindgen_destroy_closure(state.a, state.b));
function debugString(val) {
	const type = typeof val;
	if (type == "number" || type == "boolean" || val == null) return `${val}`;
	if (type == "string") return `"${val}"`;
	if (type == "symbol") {
		const description = val.description;
		if (description == null) return "Symbol";
		else return `Symbol(${description})`;
	}
	if (type == "function") {
		const name = val.name;
		if (typeof name == "string" && name.length > 0) return `Function(${name})`;
		else return "Function";
	}
	if (Array.isArray(val)) {
		const length = val.length;
		let debug = "[";
		if (length > 0) debug += debugString(val[0]);
		for (let i = 1; i < length; i++) debug += ", " + debugString(val[i]);
		debug += "]";
		return debug;
	}
	const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
	let className;
	if (builtInMatches && builtInMatches.length > 1) className = builtInMatches[1];
	else return toString.call(val);
	if (className == "Object") try {
		return "Object(" + JSON.stringify(val) + ")";
	} catch (_) {
		return "Object";
	}
	if (val instanceof Error) return `${val.name}: ${val.message}\n${val.stack}`;
	return className;
}
function getArrayU8FromWasm0(ptr, len) {
	ptr = ptr >>> 0;
	return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
	if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
	return cachedDataViewMemory0;
}
function getStringFromWasm0(ptr, len) {
	ptr = ptr >>> 0;
	return decodeText(ptr, len);
}
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
	if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
	return cachedUint8ArrayMemory0;
}
function handleError(f, args) {
	try {
		return f.apply(this, args);
	} catch (e) {
		const idx = addToExternrefTable0(e);
		wasm.__wbindgen_exn_store(idx);
	}
}
function isLikeNone(x) {
	return x === void 0 || x === null;
}
function makeMutClosure(arg0, arg1, f) {
	const state = {
		a: arg0,
		b: arg1,
		cnt: 1
	};
	const real = (...args) => {
		state.cnt++;
		const a = state.a;
		state.a = 0;
		try {
			return f(a, state.b, ...args);
		} finally {
			state.a = a;
			real._wbg_cb_unref();
		}
	};
	real._wbg_cb_unref = () => {
		if (--state.cnt === 0) {
			wasm.__wbindgen_destroy_closure(state.a, state.b);
			state.a = 0;
			CLOSURE_DTORS.unregister(state);
		}
	};
	CLOSURE_DTORS.register(real, state, state);
	return real;
}
function passArrayJsValueToWasm0(array, malloc) {
	const ptr = malloc(array.length * 4, 4) >>> 0;
	for (let i = 0; i < array.length; i++) {
		const add = addToExternrefTable0(array[i]);
		getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
	}
	WASM_VECTOR_LEN = array.length;
	return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
	if (realloc === void 0) {
		const buf = cachedTextEncoder.encode(arg);
		const ptr = malloc(buf.length, 1) >>> 0;
		getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
		WASM_VECTOR_LEN = buf.length;
		return ptr;
	}
	let len = arg.length;
	let ptr = malloc(len, 1) >>> 0;
	const mem = getUint8ArrayMemory0();
	let offset = 0;
	for (; offset < len; offset++) {
		const code = arg.charCodeAt(offset);
		if (code > 127) break;
		mem[ptr + offset] = code;
	}
	if (offset !== len) {
		if (offset !== 0) arg = arg.slice(offset);
		ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
		const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
		const ret = cachedTextEncoder.encodeInto(arg, view);
		offset += ret.written;
		ptr = realloc(ptr, len, offset, 1) >>> 0;
	}
	WASM_VECTOR_LEN = offset;
	return ptr;
}
function takeFromExternrefTable0(idx) {
	const value = wasm.__wbindgen_externrefs.get(idx);
	wasm.__externref_table_dealloc(idx);
	return value;
}
var cachedTextDecoder = new TextDecoder("utf-8", {
	ignoreBOM: true,
	fatal: true
});
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
	numBytesDecoded += len;
	if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
		cachedTextDecoder = new TextDecoder("utf-8", {
			ignoreBOM: true,
			fatal: true
		});
		cachedTextDecoder.decode();
		numBytesDecoded = len;
	}
	return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
var cachedTextEncoder = new TextEncoder();
if (!("encodeInto" in cachedTextEncoder)) cachedTextEncoder.encodeInto = function(arg, view) {
	const buf = cachedTextEncoder.encode(arg);
	view.set(buf);
	return {
		read: arg.length,
		written: buf.length
	};
};
var WASM_VECTOR_LEN = 0, wasm;
function __wbg_finalize_init(instance, module) {
	wasm = instance.exports;
	cachedDataViewMemory0 = null;
	cachedUint8ArrayMemory0 = null;
	wasm.__wbindgen_start();
	return wasm;
}
async function __wbg_load(module, imports) {
	if (typeof Response === "function" && module instanceof Response) {
		if (typeof WebAssembly.instantiateStreaming === "function") try {
			return await WebAssembly.instantiateStreaming(module, imports);
		} catch (e) {
			if (module.ok && expectedResponseType(module.type) && module.headers.get("Content-Type") !== "application/wasm") console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
			else throw e;
		}
		const bytes = await module.arrayBuffer();
		return await WebAssembly.instantiate(bytes, imports);
	} else {
		const instance = await WebAssembly.instantiate(module, imports);
		if (instance instanceof WebAssembly.Instance) return {
			instance,
			module
		};
		else return instance;
	}
	function expectedResponseType(type) {
		switch (type) {
			case "basic":
			case "cors":
			case "default": return true;
		}
		return false;
	}
}
function initSync(module) {
	if (wasm !== void 0) return wasm;
	if (module !== void 0) if (Object.getPrototypeOf(module) === Object.prototype) ({module} = module);
	else console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
	const imports = __wbg_get_imports();
	if (!(module instanceof WebAssembly.Module)) module = new WebAssembly.Module(module);
	return __wbg_finalize_init(new WebAssembly.Instance(module, imports), module);
}
async function __wbg_init(module_or_path) {
	if (wasm !== void 0) return wasm;
	if (module_or_path !== void 0) if (Object.getPrototypeOf(module_or_path) === Object.prototype) ({module_or_path} = module_or_path);
	else console.warn("using deprecated parameters for the initialization function; pass a single object instead");
	if (module_or_path === void 0) module_or_path = new URL("jazz_wasm_bg.wasm", import.meta.url);
	const imports = __wbg_get_imports();
	if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) module_or_path = fetch(module_or_path);
	const { instance, module } = await __wbg_load(await module_or_path, imports);
	return __wbg_finalize_init(instance, module);
}
//#endregion
export { WasmQueryBuilder, WasmRuntime, bench_get_cache_bytes, bench_get_overflow_threshold_bytes, bench_get_pin_internal_pages, bench_get_read_coalesce_pages, bench_opfs_cold_random_read, bench_opfs_cold_sequential_read, bench_opfs_matrix, bench_opfs_mixed_matrix, bench_opfs_mixed_scenario, bench_opfs_random_read, bench_opfs_random_write, bench_opfs_range_random_window, bench_opfs_range_seq_window, bench_opfs_sequential_read, bench_opfs_sequential_write, bench_reset_cache_bytes, bench_reset_overflow_threshold_bytes, bench_reset_pin_internal_pages, bench_reset_read_coalesce_pages, bench_set_cache_bytes, bench_set_overflow_threshold_bytes, bench_set_pin_internal_pages, bench_set_read_coalesce_pages, currentTimestamp, __wbg_init as default, generateId, init, initSync, parseSchema };
