import type { SkillDef } from './skill'

/**
 * The remaining skills of the epic (0152), DECLARED as minimal templates so
 * the intents workspace and the Skills viewer speak about the SAME flows —
 * template and instance in sync. Full workflows/views land with their own
 * cards (0154/0155); until then each carries its one canonical workflow.
 */

export const docsSkill: SkillDef = {
	id: 'docs',
	name: 'Docs',
	about: 'Dokumente: ablegen, finden, Antworten entwerfen — Freigabe bleibt beim Menschen.',
	tags: ['docs'],
	workflows: [
		{
			id: 'respond',
			name: 'Bearbeiten',
			about: 'Eine Anforderung wird zum Entwurf; freigegeben wird von Hand.',
			nodes: [
				{
					id: 'request-trigger',
					kind: 'trigger',
					name: 'Anforderung',
					about: 'Ein Intent verlangt ein Dokument — Antwort, Ablage oder Suche.',
					type: 'trigger:request',
					provides: ['doc_request(R)']
				},
				{
					id: 'draft',
					kind: 'op',
					name: 'Entwurf',
					about: 'Das Schreiben wird aufgesetzt, aus Artefakten und Kontext.',
					type: 'llm:draft',
					requires: ['doc_request(R)'],
					provides: ['draft(D)']
				},
				{
					id: 'approve',
					kind: 'op',
					name: 'Freigabe',
					about: 'HITL: nur ein Knopfdruck lässt den Entwurf hinaus.',
					type: 'human:approve',
					requires: ['draft(D)'],
					provides: ['approved(D)']
				},
				{
					id: 'finish',
					kind: 'output',
					name: 'Erledigt',
					about: 'Versendet bzw. abgelegt — und archiviert.',
					type: 'op:finish',
					requires: ['approved(D)'],
					provides: ['doc(D)']
				}
			]
		}
	]
}

export const calendarSkill: SkillDef = {
	id: 'calendar',
	name: 'Calendar',
	about: 'Termine und Fristen — aus Todos mit Datum, mit Erinnerung vor dem Ende.',
	tags: ['calendar'],
	workflows: [
		{
			id: 'frist',
			name: 'Frist',
			about: 'Ein Datum wird Termin, erinnert, und läuft ab.',
			nodes: [
				{
					id: 'date-trigger',
					kind: 'trigger',
					name: 'Datum erkannt',
					about: 'Ein Todo oder Intent trägt ein Datum oder eine Frist.',
					type: 'trigger:date',
					provides: ['date_intent(D)']
				},
				{
					id: 'schedule',
					kind: 'op',
					name: 'Eintragen',
					about: 'Der Termin landet im Kalender.',
					type: 'op:schedule',
					requires: ['date_intent(D)'],
					provides: ['event(E, Time)']
				},
				{
					id: 'remind',
					kind: 'op',
					name: 'Erinnern',
					about: 'Rechtzeitig vor der Frist meldet sich der Kalender.',
					type: 'op:remind',
					requires: ['event(E, Time)'],
					provides: ['reminder(R)']
				},
				{
					id: 'due',
					kind: 'output',
					name: 'Frist',
					about: 'Der Tag selbst — erledigt oder eskaliert.',
					type: 'view:due',
					requires: ['reminder(R)'],
					provides: ['due(E)']
				}
			]
		}
	]
}

export const brainSkill: SkillDef = {
	id: 'brain',
	name: 'Brain',
	about:
		'Das Gedächtnis: Entitäten jeder Art — Todos, Menschen, Firmen zuerst — als Wikilinks verknüpft und angereichert.',
	tags: ['brain'],
	workflows: [
		{
			id: 'verknuepfen',
			name: 'Verknüpfen',
			about: 'Eine Entität wird erkannt, verlinkt, angereichert.',
			nodes: [
				{
					id: 'entity-trigger',
					kind: 'trigger',
					name: 'Entität',
					about: 'Aus jedem Artefakt fallen Entitäten: Personen, Firmen, Konzepte.',
					type: 'trigger:entity',
					provides: ['entity(E)']
				},
				{
					id: 'resolve',
					kind: 'op',
					name: 'Erkennen',
					about: 'Dublette oder neu? Eine Entität existiert genau einmal.',
					type: 'op:resolve',
					requires: ['entity(E)'],
					provides: ['resolved(E)']
				},
				{
					id: 'link',
					kind: 'op',
					name: 'Verknüpfen',
					about: 'Wikilinks in beide Richtungen — das Netz wächst.',
					type: 'op:link',
					requires: ['resolved(E)'],
					provides: ['linked(E)']
				},
				{
					id: 'enrich',
					kind: 'output',
					name: 'Anreichern',
					about: 'Muster und Konzepte über den Verknüpfungen.',
					type: 'llm:enrich',
					requires: ['linked(E)'],
					provides: ['enriched(E)']
				}
			]
		}
	]
}

export const abgleichSkill: SkillDef = {
	id: 'abgleich',
	name: 'Abgleich',
	about: 'Kontoauszüge gegen offene Posten: Zahlungen finden ihre Rechnungen.',
	tags: ['abgleich'],
	workflows: [
		{
			id: 'match',
			name: 'Abgleichen',
			about: 'Transaktionen rein, Zuordnungen raus, Todos abgehakt.',
			nodes: [
				{
					id: 'statement-trigger',
					kind: 'trigger',
					name: 'Kontoauszug',
					about: 'CSV oder Feed — die Transaktionen des Zeitraums.',
					type: 'trigger:statement',
					provides: ['statement(S)']
				},
				{
					id: 'match',
					kind: 'op',
					name: 'Zuordnen',
					about: 'Jede Zahlung sucht ihre Rechnung; das Unklare fragt nach.',
					type: 'llm:match',
					requires: ['statement(S)'],
					provides: ['matched(M)']
				},
				{
					id: 'tick',
					kind: 'output',
					name: 'Abhaken',
					about: 'Bezahlte Todos gehen auf erledigt.',
					type: 'op:tick',
					requires: ['matched(M)'],
					provides: ['ticked(T)']
				}
			]
		}
	]
}
