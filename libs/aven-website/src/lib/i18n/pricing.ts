import type { Lang } from './index'

/** Everything on the pricing page that is not plan data (that lives in ./plans.ts). */
export interface PricingMessages {
	title: string
	description: string
	eyebrow: string
	heading: string
	/** The warm bridge under the heading — the wish, before the three facts. */
	lead: string
	/** HTML — our own static copy, carries <strong> emphasis. */
	introHtml: string
	idEyebrow: string
	yourChoice: string
	availability: string
	applyOnly: string
	/**
	 * The promise every paid tier makes, spelled once and printed on all of
	 * them: the thing you buy belongs to you. `lead` carries the emphasis.
	 */
	sovereignty: { lead: string; text: string }
	/** "+ 6,8 %" — the number in the reader's number style. */
	pct: (n: number) => string
	/** What the percentage is taken FROM — printed under every number. */
	ofRevenue: string
	/** The tiny reassurance under it: the payment fees are already inside. */
	inclFees: string
	/** The early-adopter window, printed under the regular price. */
	beta: {
		badge: string
		headline: (pct: number) => string
		note: (months: number, regularPrice: string) => string
	}
	skills: string
	soon: string
	allSkills: (n: number) => string
	runtime: string
	runtimeHours: (hours: number) => string
	fairUse: string
	extraMinute: (cents: number) => string
	bundleNote: (idName: string, price: string, per: 'person' | 'company' | undefined) => string
	os: {
		eyebrow: string
		title: string
		subtitle: string
		listLabel: string
		sync: string
		byok: string
		noBackups: string
		noBackupsNote: string
		support: string
		quote: string
		noTrap: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		selfHostingHtml: string
		github: string
	}
}

export const pricing: Record<Lang, PricingMessages> = {
	de: {
		title: 'Preise — aven.ceo · avenCEO',
		description:
			'Alles beginnt mit einem Namen: avenID 25 € einmalig, avenME 55 €/Monat — der persönliche AI‑CEO für dein Leben, avenFOUNDER 377 €/Monat — der professionelle AI‑CEO für deine Firma. Keine Stufen, zwei Rollen. Mit avenCOOP baust du deine eigenen Aven‑Skills und verkaufst sie auf unserem Marketplace an andere Avens — auf Bewerbung.',
		eyebrow: 'Pricing',
		heading: 'Alles beginnt mit einem Namen.',
		lead: 'Hinter deinem Namen entsteht eine KI, die wirklich dir gehört — sie lernt dein Leben kennen, führt deine Firma und wächst mit jeder Idee, die du ihr anvertraust. Du bringst die Vision. Dein Aven bringt sie ins Laufen.',
		introHtml:
			'<strong class="font-medium text-foreground/85">avenME</strong> ist dein persönlicher AI‑CEO für dein Leben — einer pro Mensch.<br> <strong class="font-medium text-foreground/85">avenFOUNDER</strong> ist der professionelle AI‑CEO für deine Firma — einer pro Firma.<br> Mit <strong class="font-medium text-foreground/85">avenCOOP</strong> baust du deine eigenen Aven‑Skills und verkaufst sie auf unserem Marketplace an andere Avens.',
		idEyebrow: 'Der Anfang',
		yourChoice: 'Deine Wahl:',
		availability: 'Verfügbarkeit bestätigen wir bei der Buchung.',
		applyOnly: 'Nur auf Bewerbung',
		sovereignty: {
			lead: 'Deine Daten und deine KI gehören dir.',
			text: 'Ende‑zu‑Ende verschlüsselt, die Schlüssel liegen bei dir — auch wir kommen nicht rein.'
		},
		pct: (n) => `+ ${n.toLocaleString('de-DE')} %`,
		ofRevenue: 'vom Umsatz',
		inclFees: 'inkl. Transaktionsgebühren',
		beta: {
			badge: 'Early‑Adopter‑BETA',
			headline: (pct) => `${pct} % Rabatt`,
			note: (months, regularPrice) =>
				`${months === 1 ? 'den ersten Monat' : `die ersten ${months} Monate`} — danach ${regularPrice} €/Monat.`
		},
		skills: 'Skills',
		soon: 'bald',
		allSkills: (n) => `Alle ${n} Skills ansehen →`,
		runtime: 'KI‑Laufzeit',
		runtimeHours: (hours) => `Bis zu ${hours} Std/Tag Agent‑Laufzeit`,
		fairUse: '(Fair Use)',
		extraMinute: (cents) => `danach ${cents} Cent pro Minute`,
		bundleNote: (idName, price, per) =>
			`+ ${idName} (${price} € einmalig) im Bundle, falls ${per === 'company' ? 'deine Firma noch keine hat' : 'du noch keine hast'} — avenID ist nicht enthalten.`,
		os: {
			eyebrow: 'Optional · Eigenes Hosting',
			title: 'avenOS',
			subtitle: 'Open‑Source‑Stack zum Selbsthosten',
			listLabel: 'avenOS Übersicht',
			sync: 'Self‑hosted Sync‑Service',
			byok: 'Bring Your Own API Keys',
			noBackups: 'Keine Backups',
			noBackupsNote: '— optional selbst bereitstellbar',
			support: 'Community‑Forum‑Support',
			quote:
				'Kein Produkt ohne Haltung — das ist kein Satz aus dem Handbuch. Deine Daten gehören dir. Deine Arbeitsintelligenz gehört dir. Ende‑zu‑Ende‑verschlüsselt, Schlüssel bei dir — wir haben keinen Hinterzugang, und wir wollen keinen.',
			noTrap:
				'Wir bauen keine Falle. Wenn du gehst, kommen deine Skills und deine gesamte aufgebaute Arbeitsintelligenz mit. Kein Pflichtgespräch, kein Labyrinth, das sich erst beim Kündigen zeigt. Wer dich festhält, wenn du frei sein willst, war nie wirklich auf deiner Seite.',
			selfHostingHtml:
				'<strong class="font-semibold text-foreground/85">Self‑Hosting über avenOS</strong> ist für alle, die ihre eigene Infra lieben — und für alle, die einfach wissen wollen, dass die Tür offen ist.',
			github: 'avenOS auf GitHub'
		}
	},
	en: {
		title: 'Pricing — aven.ceo · avenCEO',
		description:
			'It all starts with a name: avenID 25 € one-time, avenME 55 €/month — the personal AI‑CEO for your life, avenFOUNDER 377 €/month — the professional AI‑CEO for your company. No tiers, two roles. With avenCOOP you build your own Aven skills and sell them on our Marketplace to other Avens — by application.',
		eyebrow: 'Pricing',
		heading: 'It all starts with a name.',
		lead: 'Behind your name grows an AI that truly belongs to you — it learns your life, runs your company and grows with every idea you trust it with. You bring the vision. Your Aven sets it in motion.',
		introHtml:
			'<strong class="font-medium text-foreground/85">avenME</strong> is your personal AI‑CEO for your life — one per human.<br> <strong class="font-medium text-foreground/85">avenFOUNDER</strong> is the professional AI‑CEO for your company — one per company.<br> With <strong class="font-medium text-foreground/85">avenCOOP</strong> you build your own Aven skills and sell them on our Marketplace to other Avens.',
		idEyebrow: 'The start',
		yourChoice: 'Your choice:',
		availability: 'We confirm availability at booking.',
		applyOnly: 'By application only',
		sovereignty: {
			lead: 'Your data and your AI belong to you.',
			text: 'End-to-end encrypted, the keys stay with you — not even we can get in.'
		},
		pct: (n) => `+ ${n.toLocaleString('en-US')} %`,
		ofRevenue: 'of revenue',
		inclFees: 'incl. transaction fees',
		beta: {
			badge: 'Early adopter BETA',
			headline: (pct) => `${pct} % off`,
			note: (months, regularPrice) =>
				`${months === 1 ? 'the first month' : `the first ${months} months`} — ${regularPrice} €/month after that.`
		},
		skills: 'Skills',
		soon: 'soon',
		allSkills: (n) => `See all ${n} skills →`,
		runtime: 'AI runtime',
		runtimeHours: (hours) => `Up to ${hours} h/day of agent runtime`,
		fairUse: '(fair use)',
		extraMinute: (cents) => `then ${cents} cents per minute`,
		bundleNote: (idName, price, per) =>
			`+ ${idName} (${price} € one-time) as a bundle if ${per === 'company' ? 'your company has none yet' : 'you have none yet'} — avenID is not included.`,
		os: {
			eyebrow: 'Optional · Self-hosting',
			title: 'avenOS',
			subtitle: 'Open-source stack to host yourself',
			listLabel: 'avenOS overview',
			sync: 'Self-hosted sync service',
			byok: 'Bring Your Own API Keys',
			noBackups: 'No backups',
			noBackupsNote: '— optionally provide your own',
			support: 'Community forum support',
			quote:
				'No product without a stance — that is not a line from the handbook. Your data belongs to you. Your working intelligence belongs to you. End-to-end encrypted, keys with you — we have no back door, and we do not want one.',
			noTrap:
				'We build no trap. When you leave, your skills and all the working intelligence you have built come with you. No mandatory call, no maze that only shows up when you cancel. Whoever holds you back when you want to be free was never really on your side.',
			selfHostingHtml:
				'<strong class="font-semibold text-foreground/85">Self-hosting via avenOS</strong> is for everyone who loves their own infra — and for everyone who simply wants to know the door is open.',
			github: 'avenOS on GitHub'
		}
	}
}
