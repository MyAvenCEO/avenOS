import "./permissions";

import { Group, co, z } from "jazz-tools";

export const Todo = co.map({
	title: z.string(),
	done: z.boolean(),
});

const AccountRoot = co.map({
	todos: co.list(Todo),
});

export const AvenOSAccount = co
	.account({
		root: AccountRoot,
		profile: co.profile(),
	})
	.withMigration(async (account) => {
		const { root } = await account.$jazz.ensureLoaded({
			resolve: { root: true },
		});
		if (!root.$jazz.has("todos")) {
			const owner = Group.create({ owner: account });
			root.$jazz.set("todos", co.list(Todo).create([], { owner }));
		}
	});
