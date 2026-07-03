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
		return await caps.ops(schema + '.list', {});
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
