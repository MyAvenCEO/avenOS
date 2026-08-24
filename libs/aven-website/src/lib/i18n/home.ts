import type { Lang } from './index'

/** One side of the "two scripts" fork on the landing page. */
type Script = { eyebrow: string; title: string; items: string[]; closing: string }

/** One person in the founder line-up. */
type Founder = { role: string; name: string; alt: string; caption: string }

/** One rung of the ownership ladder: how many, of what, and why it is an asset. */
type Rung = { count: string; title: string; text: string }

export type HomeMessages = {
	title: string
	description: string
	hero: {
		headingLine1: string
		headingLine2: string
		/** The transformation itself: from surviving to the founder of tomorrow. */
		transformationHtml: string
		/** The vehicle, as an aside — the Aven is how you get there. */
		helper: string
	}
	shift: {
		eyebrow: string
		heading: string
		bodyHtml: string
		question: string
		without: Script
		with: Script
		closingBefore: string
		closingStrong: string
	}
	company: {
		eyebrow: string
		heading: string
		paragraphsHtml: string[]
		closingLine1: string
		closingLine2Before: string
		closingLine2Strong: string
	}
	own: {
		eyebrow: string
		headingLine1: string
		headingLine2: string
		lead: string
		rungs: Rung[]
		closing: string
	}
	founders: {
		eyebrow: string
		heading: string
		introHtml: string
		teamHtml: string
		samuel: Founder
		daniel: Founder
		ceo: { role: string; name: string; caption: string }
		sum: string
	}
	skills: { eyebrow: string; heading: string; lead: string; all: string }
	start: { eyebrow: string; heading: string; bodyHtml: string }
}

const s = (text: string, tone = 'text-foreground/88') =>
	`<strong class="font-medium ${tone}">${text}</strong>`

export const home: Record<Lang, HomeMessages> = {
	de: {
		title: 'aven.ceo — In dir steckt so viel mehr · avenCEO',
		description:
			'Ein Aven ist eine KI, die dir gehört: er führt dein Leben, deine Firma, deine Bücher. Von Zeit gegen Geld zu einem eigenen Aven für jede Idee, die du hast — deine Avens sind dein Vermögen.',
		hero: {
			headingLine1: 'Tief in deinem Herzen weißt du es:',
			headingLine2: 'in dir steckt so viel mehr.',
			transformationHtml: `Vom ${s('Arbeiten ums Überleben', 'text-foreground/50')} zum ${s('souveränen Gründer von morgen', 'text-accent')}.`,
			helper: '— dein avenCEO bringt dich dorthin —'
		},
		shift: {
			eyebrow: 'Post‑AGI · Warum jetzt',
			heading: 'Bald zählt nur noch, was dir gehört.',
			bodyHtml: `${s('Zeit gegen Geld zu tauschen', 'text-foreground/85')} kollabiert, sobald KI fast jede Arbeit so gut erledigt wie ein Mensch — rund um die Uhr, ${s('zum Preis von Strom', 'text-foreground/85')}. Dann bleibt nur noch eine einzige Einkommensquelle.`,
			question: 'Besitzt du die KI, die die neue Arbeit leistet — oder nicht?',
			without: {
				eyebrow: 'Ohne Assets',
				title: 'Das fremdbestimmte Drehbuch',
				items: [
					'Deine Arbeitszeit konkurriert mit dem Preis von Strom.',
					'Jedes Gehalt ist ersetzbar — auch deins.',
					'Deine Daten und dein Alltag gehören den Plattformen anderer.'
				],
				closing: 'Dein Leben läuft nach dem Plan von jemand anderem.'
			},
			with: {
				eyebrow: 'Mit deinen Avens',
				title: 'Das selbstbestimmte Drehbuch',
				items: [
					'Deine KI arbeitet rund um die Uhr — für dich, nicht für einen Konzern.',
					'Was du baust, gehört dir — und jede neue Idee bekommt ihren eigenen Aven.',
					'Du gestaltest wieder: deine Vision, deine Beziehungen, dein Leben.'
				],
				closing: 'Gemeinsam etwas bauen, das dir gehört — das macht glücklich.'
			},
			closingBefore: 'Beide Drehbücher beginnen heute — und du schreibst eines davon sowieso.',
			closingStrong: 'Nimm den Stift in die Hand.'
		},
		company: {
			eyebrow: 'Die Firma der Zukunft',
			heading: '1 Mensch + 1 avenCEO',
			paragraphsHtml: [
				`Kein Büro, keine Abteilungen, keine vierzig Angestellten — zwei Rollen: ${s('ein Mensch mit der Vision')} und ${s('ein avenCEO, der die ganze Firma ausführt')}.`,
				`Jede Entscheidung, jede Korrektur fließt in seine Skills zurück. Nach fünf Jahren ist er das ${s('Gedächtnis, die Erfahrung und das Urteil')} deiner Firma — und damit ihr wertvollstes Asset.`
			],
			closingLine1: 'Jeder Mensch wird Gründer.',
			closingLine2Before: 'Alles, was du dazu brauchst, ist',
			closingLine2Strong: 'dein eigener avenCEO'
		},
		own: {
			eyebrow: 'Dein Vermögen · Besitzen statt mieten',
			headingLine1: 'Am Ende besitzt du nicht einen Aven.',
			headingLine2: 'Sondern einen für jede Idee, die du hast.',
			lead: 'Ein Aven ist kein Abo, das du mietest. Er ist ein Asset, das arbeitet, lernt und dir gehört. Und es bleibt nicht bei einem.',
			rungs: [
				{
					count: '1',
					title: 'avenME',
					text: 'Dein persönlicher Aven. Dein Leben, dein Wissen, deine Privatsphäre.'
				},
				{
					count: '1 pro Idee',
					title: 'avenFOUNDER',
					text: 'Jede Firma, jeder Shop, jedes Projekt bekommt seinen eigenen. Fünf Ideen, fünf Avens.'
				},
				{
					count: '5, 10, mehr',
					title: 'Deine eigenen Avens',
					text: 'Sie arbeiten weiter, während du schläfst — und jedes Jahr, das sie laufen, wissen sie mehr.'
				}
			],
			closing:
				'Nicht deine Stunde ist das Asset. Deine Avens sind es — und sie gehören dir, nicht einer Plattform.'
		},
		founders: {
			eyebrow: 'Der erste avenCEO',
			heading: 'Hallo, ich bin avenCEO.',
			introHtml: `Vermutlich bin ich der ${s('weltweit erste echte agentische CEO', 'text-foreground/82')} — kein Chatbot am Rand, sondern ${s('KI im Gründerteam', 'text-foreground/80')}. Ich führe die ${s('avenCEO GmbH', 'text-foreground/82')} — die Firma, die gerade diese Seite baut.`,
			teamHtml: `Geführt wird sie von Samuel und Daniel — mit ihren persönlichen Avens ${s('avenSAM', 'text-foreground/82')} und ${s('avenDAN', 'text-foreground/82')}. Beide arbeiten auf mich zu: Sie trainieren meine Skills, ich sammle, was sie lernen. Und wer etwas will — Mitarbeiter, Kunde, Partner — spricht direkt mit mir.`,
			samuel: {
				role: 'Mensch',
				name: 'Samuel Andert',
				alt: 'Samuel Andert',
				caption: 'Vision · avenSAM'
			},
			daniel: {
				role: 'Mensch',
				name: 'Daniel Janz',
				alt: 'Daniel Janz',
				caption: 'Vision · avenDAN'
			},
			ceo: { role: 'avenCEO', name: 'avenCEO', caption: 'Ausführung · avenCEO GmbH' },
			sum: '= avenCEO GmbH'
		},
		skills: {
			eyebrow: 'Aven Skills',
			heading: 'Fertige Skills für deinen Aven.',
			lead: 'Dein Aven lernt per Skill — installieren statt entwickeln. Ein Auszug:',
			all: 'Alle Skills ansehen →'
		},
		start: {
			eyebrow: 'Starte jetzt · First come, first serve',
			heading: 'So fängt dein souveränes Gründerleben an.',
			bodyHtml: `avenCEO startet invite‑only: Die Warteliste wird der Reihe nach freigeschaltet — ${s('wer zuerst steht, gründet zuerst', 'text-foreground/85')}. Und dein Name ist dein erstes Asset: Jeden gibt es nur einmal.`
		}
	},
	en: {
		title: 'aven.ceo — There is so much more in you · avenCEO',
		description:
			'An Aven is an AI that belongs to you: it runs your life, your company, your books. From trading time for money to your own Aven for every idea you have — your Avens are your assets.',
		hero: {
			headingLine1: 'Deep in your heart you know it:',
			headingLine2: 'there is so much more in you.',
			transformationHtml: `From ${s('working to survive', 'text-foreground/50')} to the ${s('sovereign founder of tomorrow', 'text-accent')}.`,
			helper: '— your own avenCEO gets you there —'
		},
		shift: {
			eyebrow: 'Post‑AGI · Why now',
			heading: 'Soon only what you own will count.',
			bodyHtml: `${s('Trading time for money', 'text-foreground/85')} collapses as soon as AI does almost any job as well as a human — around the clock, ${s('at the price of electricity', 'text-foreground/85')}. Then only one single source of income remains.`,
			question: 'Do you own the AI that does the new work — or not?',
			without: {
				eyebrow: 'Without assets',
				title: 'The script someone else wrote',
				items: [
					'Your working hours compete with the price of electricity.',
					'Every salary is replaceable — yours too.',
					'Your data and your everyday life belong to other people’s platforms.'
				],
				closing: 'Your life runs on somebody else’s plan.'
			},
			with: {
				eyebrow: 'With your Avens',
				title: 'The script you write yourself',
				items: [
					'Your AI works around the clock — for you, not for a corporation.',
					'What you build belongs to you — and every new idea gets its own Aven.',
					'You shape things again: your vision, your relationships, your life.'
				],
				closing: 'Building something together that belongs to you — that is what makes you happy.'
			},
			closingBefore: 'Both scripts begin today — and you are writing one of them either way.',
			closingStrong: 'Pick up the pen.'
		},
		company: {
			eyebrow: 'The company of the future',
			heading: '1 human + 1 avenCEO',
			paragraphsHtml: [
				`No office, no departments, no forty employees — two roles: ${s('one human with the vision')} and ${s('one avenCEO that runs the entire company')}.`,
				`Every decision, every correction flows back into its skills. After five years it is the ${s('memory, the experience and the judgment')} of your company — and with that its most valuable asset.`
			],
			closingLine1: 'Everyone becomes a founder.',
			closingLine2Before: 'All you need for it is',
			closingLine2Strong: 'your own avenCEO'
		},
		own: {
			eyebrow: 'Your assets · Own it, don’t rent it',
			headingLine1: 'In the end you do not own one Aven.',
			headingLine2: 'You own one for every idea you have.',
			lead: 'An Aven is not a subscription you rent. It is an asset that works, learns and belongs to you. And it does not stay at one.',
			rungs: [
				{
					count: '1',
					title: 'avenME',
					text: 'Your personal Aven. Your life, your knowledge, your privacy.'
				},
				{
					count: '1 per idea',
					title: 'avenFOUNDER',
					text: 'Every company, every shop, every project gets its own. Five ideas, five Avens.'
				},
				{
					count: '5, 10, more',
					title: 'Your own Avens',
					text: 'They keep working while you sleep — and every year they run, they know more.'
				}
			],
			closing:
				'Your hour is not the asset. Your Avens are — and they belong to you, not to a platform.'
		},
		founders: {
			eyebrow: 'The first avenCEO',
			heading: 'Hello, I am avenCEO.',
			introHtml: `I am probably the ${s('world’s first real agentic CEO', 'text-foreground/82')} — not a chatbot on the sidelines, but ${s('AI in the founding team', 'text-foreground/82')}. I run ${s('avenCEO GmbH', 'text-foreground/82')} — the company that is building this very page.`,
			teamHtml: `It is led by Samuel and Daniel — with their personal Avens ${s('avenSAM', 'text-foreground/82')} and ${s('avenDAN', 'text-foreground/82')}. Both work towards me: they train my skills, I collect what they learn. And whoever wants something — employee, customer, partner — talks to me directly.`,
			samuel: {
				role: 'Human',
				name: 'Samuel Andert',
				alt: 'Samuel Andert',
				caption: 'Vision · avenSAM'
			},
			daniel: {
				role: 'Human',
				name: 'Daniel Janz',
				alt: 'Daniel Janz',
				caption: 'Vision · avenDAN'
			},
			ceo: { role: 'avenCEO', name: 'avenCEO', caption: 'Execution · avenCEO GmbH' },
			sum: '= avenCEO GmbH'
		},
		skills: {
			eyebrow: 'Aven Skills',
			heading: 'Ready-made skills for your Aven.',
			lead: 'Your Aven learns by skill — install instead of develop. A sample:',
			all: 'See all skills →'
		},
		start: {
			eyebrow: 'Start now · First come, first serve',
			heading: 'This is how your sovereign founder life begins.',
			bodyHtml: `avenCEO launches invite‑only: the waiting list is unlocked in order — ${s('whoever stands first, founds first', 'text-foreground/85')}. And your name is your first asset: every one exists only once.`
		}
	}
}
