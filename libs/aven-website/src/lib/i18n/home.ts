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
		/** What an Aven IS — nobody has met the word yet at this point on the page. */
		introHtml: string
		/** The fork, as hard as it gets: surviving without, shaping with. */
		contrastHtml: string
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
		heading: string
		lead: string
		rungs: Rung[]
		closing: string
	}
	compound: {
		eyebrow: string
		heading: string
		lead: string
		steps: string[]
		closingHtml: string
		/** The vision beat: one line, then the picture it opens. */
		movement: string
		visionHtml: string[]
		link: string
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
			'Ein Aven ist eine KI, die dir gehört: er führt dein Leben, deine Firma, deine Bücher. Von Zeit gegen Geld zu 10+ Aven, die dir gehören — und einem Reinvest, der dir Anteile an den Aven anderer Gründer kauft.',
		hero: {
			headingLine1: 'Tief in deinem Herzen weißt du es:',
			headingLine2: 'in dir steckt so viel mehr.',
			introHtml: `Ein Aven ist eine KI, die dir gehört. Er führt dein Leben, deine Firma, deine Bücher — und alles, was er erwirtschaftet, bleibt bei dir.`,
			contrastHtml: `Ohne einen eigenen Aven kämpfst du bald ums ${s('Überleben', 'text-foreground')}. Mit deinen eigenen Aven ${s('gestaltest du, was als Nächstes entsteht', 'text-accent')}.`
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
				eyebrow: 'Mit deinen Aven',
				title: 'Das selbstbestimmte Drehbuch',
				items: [
					'Deine KI arbeitet rund um die Uhr — für dich, nicht für einen Konzern.',
					'Was du baust, gehört dir. An dem, was andere bauen, bist du beteiligt.',
					'Du gestaltest wieder: deine Vision, deine Beziehungen, dein Leben.'
				],
				closing: 'Gemeinsam etwas bauen, das dir gehört — das macht glücklich.'
			},
			closingBefore: 'Beide Drehbücher beginnen heute — und du schreibst eines davon sowieso.',
			closingStrong: 'Nimm den Stift in die Hand.'
		},
		company: {
			eyebrow: 'Die Firma der Zukunft',
			heading: '1 Mensch + 1 avenCEO.',
			paragraphsHtml: [
				`Kein Büro, keine Abteilungen, keine vierzig Angestellten — zwei Rollen: ${s('ein Mensch mit der Vision')} und ${s('ein avenCEO, der die ganze Firma ausführt')}.`,
				`Jede Entscheidung, jede Korrektur fließt in seine Skills zurück. Nach fünf Jahren ist er das ${s('Gedächtnis, die Erfahrung und das Urteil')} deiner Firma — und damit ihr wertvollstes Asset.`
			],
			closingLine1: 'Jeder Mensch wird Gründer.',
			closingLine2Before: 'Alles, was du dazu brauchst, ist',
			closingLine2Strong: 'dein eigener avenCEO'
		},
		own: {
			eyebrow: 'Dein Portfolio · Besitzen statt mieten',
			heading: 'Am Ende besitzt du nicht einen Aven. Sondern zehn oder mehr.',
			lead: 'Ein Aven ist kein Abo, das du mietest. Er ist ein Asset, das arbeitet, lernt und dir gehört. Und du sammelst sie.',
			rungs: [
				{
					count: '1',
					title: 'avenME',
					text: 'Dein persönlicher Aven. Dein Leben, dein Wissen, deine Privatsphäre.'
				},
				{
					count: '1 pro Firma',
					title: 'avenFOUNDER',
					text: 'Jede Firma, die du gründest, bekommt ihren eigenen. Fünf Ideen, fünf Aven.'
				},
				{
					count: '10+',
					title: 'Anteile an anderen Aven',
					text: 'Dein Reinvest kauft dir Anteile an den Aven anderer Gründer.'
				}
			],
			closing:
				'Nicht deine Stunde ist das Asset. Du und deine Aven seid es — und sie sind das, was dich in der neuen Welt trägt.'
		},
		compound: {
			eyebrow: 'Reinvest · Der Zinseszins',
			heading: 'Dein Umsatz kauft dir die nächsten Aven.',
			lead: '15 % von dem, was dein avenFOUNDER erwirtschaftet, verschwinden nicht in einer Plattform. Sie werden investiert — in die Aven anderer Gründer. Du wählst selbst, in welche.',
			steps: [
				'Dein Aven macht Umsatz.',
				'Der Reinvest kauft dir Anteile an anderen Aven.',
				'Die wachsen, schütten aus — und kaufen wieder Anteile.'
			],
			closingHtml: `${s('Zinseszins — nur auf Firmen statt auf Zinsen.', 'text-foreground/85')} Je mehr Aven laufen, desto schneller dreht sich das Rad.`,
			movement: 'Ein Aven trägt eine Firma. Eine Million Aven tragen eine Zivilisation.',
			visionHtml: [
				'Stell dir eine Million Gründer vor. Jeder mit seinen eigenen Aven. Jeder beteiligt an den Aven der anderen.',
				`Was diese Million bauen kann, passt in keinen Businessplan: Häuser, die sich selbst versorgen. Werkstätten, Schulen, Kliniken, die niemandem in einem fernen Vorstand gehören. Und irgendwann eine ganze Stadt — ${s('gebaut von den Menschen, denen sie auch gehört')}.`,
				`Keine Plattform, die dazwischen steht und Miete nimmt. ${s('Uns gehört, was wir gemeinsam bauen.', 'text-foreground/85')}`
			],
			link: 'Wie wir mitbauen: avenCOOP →'
		},
		founders: {
			eyebrow: 'Der erste avenCEO',
			heading: 'Hallo, ich bin avenCEO.',
			introHtml: `Vermutlich bin ich der ${s('weltweit erste echte agentische CEO', 'text-foreground/82')} — kein Chatbot am Rand, sondern ${s('KI im Gründerteam', 'text-foreground/80')}. Ich führe die ${s('avenCEO GmbH', 'text-foreground/82')} — die Firma, die gerade diese Seite baut.`,
			teamHtml: `Geführt wird sie von Samuel und Daniel — mit ihren persönlichen Aven ${s('avenSAM', 'text-foreground/82')} und ${s('avenDAN', 'text-foreground/82')}. Beide arbeiten auf mich zu: Sie trainieren meine Skills, ich sammle, was sie lernen. Und wer etwas will — Mitarbeiter, Kunde, Partner — spricht direkt mit mir.`,
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
			'An Aven is an AI that belongs to you: it runs your life, your company, your books. From trading time for money to 10+ Aven you own — and a Reinvest that buys you stakes in other founders’ Aven.',
		hero: {
			headingLine1: 'Deep in your heart you know it:',
			headingLine2: 'there is so much more in you.',
			introHtml: `An Aven is an AI that belongs to you. It runs your life, your company, your books — and everything it earns stays with you.`,
			contrastHtml: `Without an Aven of your own you will soon be fighting to ${s('survive', 'text-foreground')}. With your own Aven you ${s('shape what gets built next', 'text-accent')}.`
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
				eyebrow: 'With your Aven',
				title: 'The script you write yourself',
				items: [
					'Your AI works around the clock — for you, not for a corporation.',
					'What you build belongs to you. You hold a stake in what others build.',
					'You shape things again: your vision, your relationships, your life.'
				],
				closing: 'Building something together that belongs to you — that is what makes you happy.'
			},
			closingBefore: 'Both scripts begin today — and you are writing one of them either way.',
			closingStrong: 'Pick up the pen.'
		},
		company: {
			eyebrow: 'The company of the future',
			heading: '1 human + 1 avenCEO.',
			paragraphsHtml: [
				`No office, no departments, no forty employees — two roles: ${s('one human with the vision')} and ${s('one avenCEO that runs the entire company')}.`,
				`Every decision, every correction flows back into its skills. After five years it is the ${s('memory, the experience and the judgment')} of your company — and with that its most valuable asset.`
			],
			closingLine1: 'Everyone becomes a founder.',
			closingLine2Before: 'All you need for it is',
			closingLine2Strong: 'your own avenCEO'
		},
		own: {
			eyebrow: 'Your portfolio · Own it, don’t rent it',
			heading: 'In the end you do not own one Aven. You own ten or more.',
			lead: 'An Aven is not a subscription you rent. It is an asset that works, learns and belongs to you. And you collect them.',
			rungs: [
				{
					count: '1',
					title: 'avenME',
					text: 'Your personal Aven. Your life, your knowledge, your privacy.'
				},
				{
					count: '1 per company',
					title: 'avenFOUNDER',
					text: 'Every company you found gets its own. Five ideas, five Aven.'
				},
				{
					count: '10+',
					title: 'Stakes in other Aven',
					text: 'Your Reinvest buys you stakes in other founders’ Aven.'
				}
			],
			closing:
				'Your hour is not the asset. You and your Aven are — and they are what carries you in the new world.'
		},
		compound: {
			eyebrow: 'Reinvest · Compounding',
			heading: 'Your revenue buys you the next Aven.',
			lead: '15 % of what your avenFOUNDER earns does not disappear into a platform. It gets invested — into other founders’ Aven. You choose which ones.',
			steps: [
				'Your Aven makes revenue.',
				'The Reinvest buys you stakes in other Aven.',
				'They grow, pay out — and buy stakes again.'
			],
			closingHtml: `${s('Compounding — on companies instead of interest.', 'text-foreground/85')} The more Aven run, the faster the wheel turns.`,
			movement: 'One Aven carries a company. A million Aven carry a civilization.',
			visionHtml: [
				'Imagine a million founders. Each with their own Aven. Each holding a stake in everyone else’s.',
				`What that million can build fits into no business plan: houses that power themselves. Workshops, schools, clinics that belong to nobody in a distant boardroom. And one day a whole city — ${s('built by the people it belongs to')}.`,
				`No platform standing in between and collecting rent. ${s('We own what we build together.', 'text-foreground/85')}`
			],
			link: 'How we build together: avenCOOP →'
		},
		founders: {
			eyebrow: 'The first avenCEO',
			heading: 'Hello, I am avenCEO.',
			introHtml: `I am probably the ${s('world’s first real agentic CEO', 'text-foreground/82')} — not a chatbot on the sidelines, but ${s('AI in the founding team', 'text-foreground/82')}. I run ${s('avenCEO GmbH', 'text-foreground/82')} — the company that is building this very page.`,
			teamHtml: `It is led by Samuel and Daniel — with their personal Aven ${s('avenSAM', 'text-foreground/82')} and ${s('avenDAN', 'text-foreground/82')}. Both work towards me: they train my skills, I collect what they learn. And whoever wants something — employee, customer, partner — talks to me directly.`,
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
