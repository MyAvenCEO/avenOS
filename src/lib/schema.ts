import './permissions'

import { co, Group, z } from 'jazz-tools'

export const Todo = co.map({
	title: z.string(),
	done: z.boolean()
})

export const AccountRoot = co.map({
	todos: co.list(Todo)
})

export const AvenOSAccount = co
	.account({
		root: AccountRoot,
		profile: co.profile()
	})
	.withMigration(async (account) => {
		// If `root` is missing, deep resolve fails with "ref root is required but missing".
		// Seed it first (see jazz-tools deepLoading / custom account tests).
		if (!account.$jazz.has('root')) {
			account.$jazz.set('root', { todos: [] })
		}

		const { root } = await account.$jazz.ensureLoaded({
			resolve: { root: true }
		})

		if (!root.$jazz.has('todos')) {
			const owner = Group.create({ owner: account })
			root.$jazz.set('todos', co.list(Todo).create([], { owner }))
		}
	})
