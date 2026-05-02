import { schema as s } from 'jazz-tools'

export const app = s.defineApp({
	profiles: s.table({
		name: s.string()
	}),
	todos: s.table({
		title: s.string(),
		done: s.boolean()
	})
})
