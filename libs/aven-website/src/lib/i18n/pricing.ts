import type { Lang } from './index'

/** Everything on the pricing page that is not plan data (that lives in ./plans.ts). */
export interface PricingMessages {
	title: string
	description: string
	eyebrow: string
	heading: string
	/** HTML — our own static copy, carries <strong> emphasis. */
	introHtml: string
	/** HTML — our own static copy, carries <strong> emphasis. */
	shareHtml: string
	idEyebrow: string
	yourChoice: string
	availability: string
	applyOnly: string
	onePerCompany: string
	onePerPerson: string
	revenueShare: (pct: number) => string
	platform: string
	inclFees: string
	reinvest: string
	reinvestInto: string
	equity: (pct: number) => string
	skills: string
	soon: string
	allSkills: (n: number) => string
	runtime: string
	runtimeHours: (hours: number) => string
	fairUse: string
	extraMinute: (cents: number) => string
	bundleNote: (idName: string, price: string, per: 'person' | 'company' | undefined) => string
	referral: (pct: number) => string
	referralNote: string
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
			'Ein Name als Anfang, zwei Aven nebeneinander: avenID 25 € einmalig, avenME 58 €/Monat — der persönliche AI‑CEO für dein Leben, avenFOUNDER 426 €/Monat — der professionelle AI‑CEO für deine Firma. Keine Stufen, zwei Rollen. avenCOOP als technischer Co‑Founder — auf Bewerbung.',
		eyebrow: 'Pricing',
		heading: 'Ein Name als Anfang. Zwei Aven nebeneinander.',
		introHtml:
			'<strong class="font-medium text-foreground/85">avenME</strong> ist dein persönlicher AI‑CEO für dein Leben — einer pro Mensch.<br> <strong class="font-medium text-foreground/85">avenFOUNDER</strong> ist der professionelle AI‑CEO für deine Firma — einer pro Firma.<br> Mit <strong class="font-medium text-foreground/85">avenCOOP</strong> werden wir dein technischer Co‑Founder.',
		shareHtml:
			'Der Anteil am Umsatz ist zur Hälfte Plattform und zur Hälfte <strong class="font-medium text-accent">Reinvest</strong>: Er kauft dir Anteile an anderen Aven — du wählst selbst, an welchen.',
		idEyebrow: 'Der Anfang · Pro Mensch und pro Firma',
		yourChoice: 'Deine Wahl:',
		availability: 'Verfügbarkeit bestätigen wir bei der Buchung.',
		applyOnly: 'Nur auf Bewerbung',
		onePerCompany: 'Ein avenFOUNDER pro Firma — jede weitere Firma bekommt ihren eigenen.',
		onePerPerson: 'Ein avenME pro Mensch — dein eigener, unabhängig von jeder Firma.',
		revenueShare: (pct) => `+ ${pct} % vom Umsatz`,
		platform: 'Plattform',
		inclFees: 'inkl. Stripe & Co.',
		reinvest: 'Reinvest',
		reinvestInto: 'in andere Aven',
		equity: (pct) => `+ ${pct} % Firmenanteile an deiner Firma`,
		skills: 'Skills',
		soon: 'bald',
		allSkills: (n) => `Alle ${n} Skills ansehen →`,
		runtime: 'KI‑Laufzeit',
		runtimeHours: (hours) => `Bis zu ${hours} Std/Tag Agent‑Laufzeit`,
		fairUse: '(Fair Use)',
		extraMinute: (cents) => `danach ${cents} Cent pro Minute`,
		bundleNote: (idName, price, per) =>
			`+ ${idName} (${price} € einmalig) im Bundle, falls ${per === 'company' ? 'deine Firma noch keine hat' : 'du noch keine hast'} — avenID ist nicht enthalten.`,
		referral: (pct) => `${pct} % Provision`,
		referralNote: 'auf jedes aven‑Produkt, das du vermittelst — monatlich, solange es läuft.',
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
			'One name to start, two Aven side by side: avenID 25 € one-time, avenME 58 €/month — the personal AI‑CEO for your life, avenFOUNDER 426 €/month — the professional AI‑CEO for your company. No tiers, two roles. avenCOOP as your technical co-founder — by application.',
		eyebrow: 'Pricing',
		heading: 'One name to start. Two Aven side by side.',
		introHtml:
			'<strong class="font-medium text-foreground/85">avenME</strong> is your personal AI‑CEO for your life — one per human.<br> <strong class="font-medium text-foreground/85">avenFOUNDER</strong> is the professional AI‑CEO for your company — one per company.<br> With <strong class="font-medium text-foreground/85">avenCOOP</strong> we become your technical co-founder.',
		shareHtml:
			'The revenue share is half platform and half <strong class="font-medium text-accent">Reinvest</strong>: it buys you equity in other Aven — you choose which ones.',
		idEyebrow: 'The start · Per human and per company',
		yourChoice: 'Your choice:',
		availability: 'We confirm availability at booking.',
		applyOnly: 'By application only',
		onePerCompany: 'One avenFOUNDER per company — every further company gets its own.',
		onePerPerson: 'One avenME per human — your own, independent of any company.',
		revenueShare: (pct) => `+ ${pct} % of revenue`,
		platform: 'Platform',
		inclFees: 'incl. Stripe & Co.',
		reinvest: 'Reinvest',
		reinvestInto: 'into other Aven',
		equity: (pct) => `+ ${pct} % equity in your company`,
		skills: 'Skills',
		soon: 'soon',
		allSkills: (n) => `See all ${n} skills →`,
		runtime: 'AI runtime',
		runtimeHours: (hours) => `Up to ${hours} h/day of agent runtime`,
		fairUse: '(fair use)',
		extraMinute: (cents) => `then ${cents} cents per minute`,
		bundleNote: (idName, price, per) =>
			`+ ${idName} (${price} € one-time) as a bundle if ${per === 'company' ? 'your company has none yet' : 'you have none yet'} — avenID is not included.`,
		referral: (pct) => `${pct} % commission`,
		referralNote: 'on every aven product you refer — monthly, for as long as it runs.',
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
