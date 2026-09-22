import type { PendingInput } from './input-inbox-controller'

export function inputCopy(locale: string) {
	const de = locale.toLowerCase().startsWith('de')
	return de
		? {
				checking: 'Ziel wird geprüft…',
				choice: 'Wohin damit?',
				assigning: 'Wird gesendet…',
				failed: 'Noch nicht gesendet',
				edit: 'Ändern',
				discard: 'Verwerfen',
				retry: 'Erneut prüfen',
				choose: 'Anderes Ziel…',
				keep: 'Hier bleiben',
				create: 'Neuer Intent',
				search: 'Suchen',
				find: 'Intent finden…',
				newTitle: 'Neuen Intent benennen',
				send: 'Erstellen & senden',
				pending: 'weitere Nachrichten',
				understood: 'Verstanden',
				question: (title: string, fresh: boolean) =>
					fresh ? `Neuen Intent „${title}“ erstellen?` : `In „${title}“ besprechen?`,
				noTarget: 'Wähle einen Intent oder benenne einen neuen.',
				unavailable: 'Suche gerade nicht verfügbar. Bitte erneut versuchen.',
				empty: 'Keine Treffer. Suche kürzer oder erstelle einen neuen Intent.'
			}
		: {
				checking: 'Checking destination…',
				choice: 'Where should this go?',
				assigning: 'Sending…',
				failed: 'Not sent yet',
				edit: 'Edit',
				discard: 'Discard',
				retry: 'Check again',
				choose: 'Another destination…',
				keep: 'Keep here',
				create: 'New Intent',
				search: 'Search',
				find: 'Find an Intent…',
				newTitle: 'Name a new Intent',
				send: 'Create & send',
				pending: 'other messages',
				understood: 'Understood',
				question: (title: string, fresh: boolean) =>
					fresh ? `Create a new Intent “${title}”?` : `Discuss this in “${title}”?`,
				noTarget: 'Choose an Intent or name a new one.',
				unavailable: 'Search is unavailable. Please try again.',
				empty: 'No matches. Try a shorter search or start a new Intent.'
			}
}
export function routingQuestion(item: PendingInput): string {
	const copy = inputCopy(item.locale)
	const target = item.suggestion
	if (!target) return copy.noTarget
	const title =
		target.kind === 'new' ? target.title : item.intents.find((i) => i.id === target.id)?.title
	return title ? copy.question(title, target.kind === 'new') : copy.noTarget
}
