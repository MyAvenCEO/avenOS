import type { Lang } from './index'

/** Header, footer, the avenID call to action and the waiting list — shared by every page. */
export const common: Record<
	Lang,
	{
		nav: { skills: string; avens: string; pricing: string; cta: string }
		switchLabel: string
		footer: {
			tagline: string
			pagesLabel: string
			legalLabel: string
			socialLabel: string
			ctaLabel: string
			copyright: string
			legal: {
				impressum: string
				datenschutz: string
				socialMedia: string
				agb: string
				widerruf: string
			}
		}
		idCta: {
			eyebrow: string
			title: (price: string) => string
			/** HTML — our own static copy, carries <strong> emphasis. */
			bodyHtml: string
			placeholder: string
			button: string
			exampleLabel: string
			priceNote: (price: string) => string
			formLabel: string
		}
		board: {
			eyebrow: (next: number) => string
			more: (n: number) => string
			yourName: string
			free: string
			footnote: string
		}
	}
> = {
	de: {
		nav: { skills: 'Skills', avens: 'Avens', pricing: 'Preise', cta: 'avenID sichern' },
		switchLabel: 'Sprache',
		footer: {
			tagline: 'Deine eigene KI, deine eigene Firma — und das, was du damit baust, gehört dir.',
			pagesLabel: 'Seiten',
			legalLabel: 'Rechtliches',
			socialLabel: 'Social Media',
			ctaLabel: 'avenID sichern',
			copyright: 'avenCEO · avenOS — Own your life',
			legal: {
				impressum: 'Impressum',
				datenschutz: 'Datenschutz',
				socialMedia: 'Social-Media-Datenschutz',
				agb: 'AGB',
				widerruf: 'Widerrufsrecht'
			}
		},
		idCta: {
			eyebrow: 'Warteliste · Invite only',
			title: (price) => `Sichere dir deine avenID für einmalig ${price} €`,
			bodyHtml:
				'Wie eine Domain — aber für deinen Aven: <strong class="font-medium text-foreground/82">maia.aven.ceo</strong>. Sie ist zugleich dein Platz auf der Warteliste: Eingeladen wird der Reihe nach, <strong class="font-medium text-foreground/82">wer zuerst kommt, gründet zuerst</strong>. Der Name ist damit <strong class="font-medium text-foreground/82">für 1 Jahr für dich gesichert</strong> — solange ihn niemand anders hält. Dazu bekommst du <strong class="font-medium text-foreground/82">20 Min Test‑Zugang</strong>, sobald du eingeladen bist.',
			placeholder: 'maia',
			button: 'avenID sichern →',
			exampleLabel: 'Beispiel:',
			priceNote: (price) => `einmalig ${price} € inkl. USt.`,
			formLabel: 'avenID sichern'
		},
		board: {
			eyebrow: (next) => `Warteliste · Platz ${next} ist frei`,
			more: (n) => `und ${n} weitere`,
			yourName: 'dein Name',
			free: 'frei',
			footnote: 'Wer zuerst steht, gründet zuerst — und jeden Namen gibt es genau einmal.'
		}
	},
	en: {
		nav: { skills: 'Skills', avens: 'Avens', pricing: 'Pricing', cta: 'Claim your avenID' },
		switchLabel: 'Language',
		footer: {
			tagline: 'Your own AI, your own company — and what you build with it belongs to you.',
			pagesLabel: 'Pages',
			legalLabel: 'Legal',
			socialLabel: 'Social media',
			ctaLabel: 'Claim your avenID',
			copyright: 'avenCEO · avenOS — Own your life',
			legal: {
				impressum: 'Imprint',
				datenschutz: 'Privacy',
				socialMedia: 'Social media privacy',
				agb: 'Terms',
				widerruf: 'Right of withdrawal'
			}
		},
		idCta: {
			eyebrow: 'Waiting list · Invite only',
			title: (price) => `Claim your avenID for a one-time ${price} €`,
			bodyHtml:
				'Like a domain — but for your Aven: <strong class="font-medium text-foreground/82">maia.aven.ceo</strong>. It is also your place on the waiting list: invitations go out in order, <strong class="font-medium text-foreground/82">first come, first founded</strong>. The name is <strong class="font-medium text-foreground/82">reserved for you for 1 year</strong> — as long as nobody else holds it. On top you get <strong class="font-medium text-foreground/82">20 min of trial access</strong> the moment you are invited.',
			placeholder: 'maia',
			button: 'Claim avenID →',
			exampleLabel: 'Example:',
			priceNote: (price) => `one-time ${price} € incl. VAT`,
			formLabel: 'Claim your avenID'
		},
		board: {
			eyebrow: (next) => `Waiting list · place ${next} is open`,
			more: (n) => `and ${n} more`,
			yourName: 'your name',
			free: 'open',
			footnote: 'Whoever stands first, founds first — and every name exists exactly once.'
		}
	}
}
