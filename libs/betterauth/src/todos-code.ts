// board 0111 — the todos vertical's CRUD behavior AS SANDBOXED ACTOR CODE. This is the canonical `code`
// string seeded onto the data_crud actor row (migration): a QuickJS module that dispatches list/create/
// update/delete to the named `todos.*` data_operations via the ONLY capability it is granted — `ops`. It is
// the SSOT: the chat tool loop and the vibe UI both post the same `{schema, action, items, ids, id}` mailbox
// to this one behavior. No DB handle, no network — everything goes through `caps.ops`, which the host wires
// to `runOperation` (see actor-run.ts). The fancy chat-only concerns (gemma id-resolution, the before→after
// diff, the delete HITL, vibe selection) stay in the host's ToolResult mapping around this pure core.

export const DATA_CRUD_CODE = `
async function handle(msg, caps) {
	const schema = msg.schema;
	const action = msg.action;
	if (action === 'list') {
		// a configured filter selects a named universal query op — schema + '.' + filter (e.g. todos.done);
		// no filter (or 'all') runs the full schema.list. The available filters are DATA (data_operations
		// rows authored with the universal query grammar), never hardcoded here. return { items } to match
		// the engine shape the chat host reads (id-resolution + before-diff).
		const f = msg.filter;
		const op = (f && f !== 'all') ? (schema + '.' + f) : (schema + '.list');
		const res = await caps.ops(op, {});
		return { items: (res && res.rows) || [] };
	}
	if (action === 'create') {
		const created = [];
		for (const item of (msg.items || [])) created.push(await caps.ops(schema + '.create', item));
		return { created };
	}
	if (action === 'update') {
		const updated = [];
		for (const item of (msg.items || [])) updated.push(await caps.ops(schema + '.update', item));
		return { updated };
	}
	if (action === 'delete') {
		const ids = msg.ids || (msg.id ? [msg.id] : []);
		const deleted = [];
		for (const id of ids) deleted.push(await caps.ops(schema + '.delete', { id }));
		return { deleted };
	}
	throw new Error('unknown action: ' + action);
}
`.trim()

/** The caps this code actor needs — only `ops` (named data_operation execution). */
export const DATA_CRUD_CAPS = ['ops']
