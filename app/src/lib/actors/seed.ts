import { Actor } from './actor'

/**
 * The intent-router chain — the most basic flow a company has, seeded as
 * honest stub actors: contracts real, handlers not yet executable. They give
 * the mesh its shape (and the Flows view its content) before the execution
 * engine exists; each will be replaced by a working actor without the graph
 * changing, because the graph IS the contracts.
 */

const stub = (
	id: string,
	name: string,
	description: string,
	tags: string[],
	requires: string[],
	produces: string[]
) => new Actor({ id, name, description, tags, methods: [], requires, produces })

export const SEED_ACTORS: Actor[] = [
	stub(
		'inbox',
		'Inbox',
		'Der Intent-Briefkasten: alles was hereinkommt wird erst einmal Nachricht.',
		['intent-router'],
		['mail(M)', 'support(M)', 'request(M)'],
		['message(M)']
	),
	stub(
		'normalize',
		'Normalize',
		'Zieht aus einer Nachricht den reinen Text.',
		['intent-router', 'classify'],
		['message(M)'],
		['text(M)']
	),
	stub(
		'embed',
		'Embed',
		'Bettet den Text ein, damit Ähnlichkeit rechenbar wird.',
		['intent-router', 'classify'],
		['text(M)'],
		['vektor(M)']
	),
	stub(
		'label',
		'Label',
		'Bestimmt aus Text und Vektor die Absicht.',
		['intent-router', 'classify'],
		['vektor(M)', 'text(M)'],
		['intent(M, Class)']
	),
	stub(
		'route',
		'Route',
		'Verteilt erkannte Absichten: Arbeit, Antwort oder Ablage.',
		['intent-router'],
		['intent(M, Class)'],
		['work(M, Spark)', 'antwort(M)', 'ablage(M)']
	)
]
