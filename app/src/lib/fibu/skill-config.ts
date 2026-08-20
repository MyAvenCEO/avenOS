/**
 * Skills — the layer above flows (board 0140).
 *
 * Flows are FLAT: one registry, no ownership. A skill is a named set over
 * that registry plus a contract — what it accepts, what it hands on, and
 * where work enters. The same flow may therefore appear in several skills,
 * exactly as an actor can serve several flows.
 *
 * A skill is the unit aven installs, activates and creates. Skills pass
 * work to each other through `handoff` nodes: the sending flow ends at a
 * skill boundary instead of swallowing the next skill's flows, which is
 * what keeps the flow graph flat.
 */

export interface Skill {
	id: string
	name: string
	description: string
	/** Flow ids this skill brings — a flow may belong to more than one skill. */
	flows: string[]
	/**
	 * Where handed-off work enters; must be one of `flows`. Other flows in
	 * the skill may still run on their own cadence — the DATEV export is
	 * triggered by the period, not by an incoming item.
	 */
	entry: string
	/** What may be handed in — the other side of someone else's `provides`. */
	accepts: string[]
	/** What this skill hands on. */
	provides: string[]
}

import { intentsSkill } from './intents-config'

export const skills: Skill[] = [
	{
		id: 'inbox',
		name: 'Inbox',
		description:
			'Der eine Eingang: annehmen, Vorgänge trennen, einmal klassifizieren — und aus Dokumenten lesbare Daten machen (Extraktion, OCR). Gibt strukturierte Positionen und Transaktionen weiter; was keine Klasse findet, geht an einen Menschen.',
		flows: ['inbox-triage', 'belege-extrahieren', 'scan-zu-dokument'],
		entry: 'inbox-triage',
		accepts: ['mail', 'post', 'upload'],
		provides: ['positionen', 'transaktionen', 'unklar']
	},
	{
		id: 'buchhaltung',
		name: 'Buchhaltung',
		description:
			'Aus Daten werden Buchungen: Zahlungen gegen offene Posten abgleichen, Positionen kontieren, Buchungszeilen ableiten, Soll/Ist. Komponiert den Buchungsvorgang als Subflow — der ist zugleich ein eigener Skill, denn Flows sind flach und dürfen in mehreren Skills liegen. Der Monatsabschluss ist bewusst KEIN Teil mehr: anderer Takt, eigene Grenze.',
		flows: ['eingangsrechnung-buchen', 'zahlungsabgleich', 'buchungsvorgang'],
		entry: 'eingangsrechnung-buchen',
		accepts: ['positionen', 'transaktionen'],
		provides: ['buchungsstapel', 'unklar']
	},
	{
		id: 'buchen',
		name: 'Buchungsvorgang',
		description:
			'Der steuerliche Kern als eigene Einheit: Leistungsart klassifizieren, Steuerlogik, Buchungszeilen ableiten, validieren, Vier-Augen-Freigabe, Festschreibung mit Anker. Läuft als Subflow in der Buchhaltung UND als eigener Skill — derselbe flache Flow, zwei Verträge.',
		flows: ['buchungsvorgang'],
		entry: 'buchungsvorgang',
		accepts: ['positionen', 'abgeglichen'],
		provides: ['buchungsstapel', 'unklar']
	},
	{
		id: 'abschluss',
		name: 'Monatsabschluss',
		description:
			'Der Perioden-Skill: läuft am Monatsende, nicht am Beleg. Sammelt Festgeschriebenes, bildet Stapel, faltet Vorsteuer, schreibt und prüft die EXTF-Datei für den Berater. Sein Eingang ist die Periode — deshalb eine eigene Skill-Grenze statt eines weiteren Buchhaltungs-Flows.',
		flows: ['datev-export'],
		entry: 'datev-export',
		accepts: ['festgeschrieben'],
		provides: ['extf-datei', 'fehler']
	},
	{
		id: 'hitl',
		name: 'HITL',
		description:
			'Der Mensch in der Schleife, generisch für alle Skills: eine Warteschlange für Freigaben, Fehler und Unklares — nach Risiko sortiert, mit Begründung statt Häkchen. Jeder Fehler ist in v1 eine Meldung an einen Menschen — automatische Reparatur kommt später. Jede Entscheidung zählt in die Autonomie-Bilanz des Actors, der sie ausgelöst hat.',
		flows: ['hitl-posteingang', 'hitl-whitelist'],
		entry: 'hitl-posteingang',
		accepts: ['freigabe', 'fehler', 'unklar'],
		provides: ['entscheidung', 'actor-caps']
	},
	intentsSkill
]
