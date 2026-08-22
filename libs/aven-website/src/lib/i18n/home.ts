import type { Lang } from './index'

/** One side of the "two scripts" fork on the landing page. */
type Script = { eyebrow: string; title: string; items: string[]; closing: string }

/** One person in the founder line-up. */
type Founder = { role: string; name: string; alt: string; caption: string }

export type HomeMessages = {
	title: string
	description: string
	hero: {
		headingLine1: string
		headingLine2: string
		leadBefore: string
		leadStrong: string
		leadAfter: string
	}
	company: {
		eyebrow: string
		heading: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		paragraphsHtml: string[]
		closingLine1: string
		closingLine2Before: string
		closingLine2Strong: string
	}
	shift: {
		eyebrow: string
		heading: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		bodyHtml: string
		question: string
		without: Script
		with: Script
		closingBefore: string
		closingStrong: string
	}
	personal: {
		eyebrow: string
		heading: string
		today: string
		thesis: string
		day: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		assetHtml: string
	}
	founders: {
		eyebrow: string
		heading: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		introHtml: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		teamHtml: string
		samuel: Founder
		daniel: Founder
		ceo: { role: string; name: string; caption: string }
		sum: string
	}
	collective: {
		eyebrow: string
		heading: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		paragraphsHtml: string[]
		link: string
	}
	skills: { eyebrow: string; heading: string; lead: string; all: string }
	start: {
		eyebrow: string
		heading: string
		/** HTML — our own static copy, carries <strong> emphasis. */
		bodyHtml: string
	}
}

const s = (text: string, tone = 'text-foreground/88') =>
	`<strong class="font-medium ${tone}">${text}</strong>`

export const home: Record<Lang, HomeMessages> = {
	de: {
		title: 'aven.ceo — In dir steckt so viel mehr · avenCEO',
		description:
			'Ein Aven ist eine KI, die dir gehört: er sortiert deine Post, führt deine Bücher und baut deine Firma mit. Von Zeit gegen Geld zu 10+ Assets, die dir gehören — und 1 Million Gründer, die gemeinsam die Startups der Zukunft bauen und besitzen.',
		hero: {
			headingLine1: 'Tief in deinem Herzen weißt du es:',
			headingLine2: 'in dir steckt so viel mehr.',
			leadBefore: 'Wir sind da, um dich endlich in dein',
			leadStrong: 'souveränes Gründerleben',
			leadAfter: 'zu katapultieren, von dem du schon immer träumst.'
		},
		company: {
			eyebrow: 'Die Firma der Zukunft',
			heading: '1 Mensch + 1 avenCEO.',
			paragraphsHtml: [
				`Die Firma der Zukunft hat kein Büro, keine Abteilungen, keine vierzig Angestellten. Sie besteht aus zwei Rollen: ${s('ein Mensch mit der Vision')} und ${s('ein avenCEO, der die ganze Firma ausführt')} — Operations, Technik, Markt, Produkt.`,
				`Jede Firma bekommt ihren eigenen Aven. Jeder Mensch auch — den ${s('persönlichen Aven')} für sein Leben und sein Wissen.`,
				`Und hier dreht sich das Spiel: ${s('Der avenCEO wird zum Asset.')} Jede Entscheidung, die du mit ihm triffst, jede Korrektur, jede Erkenntnis aus deinem Alltag fließt in seine Skills zurück — Trainingsschleife um Trainingsschleife. Er lernt deine Kunden, deine Prozesse, deinen Markt. Was ein Angestellter beim Kündigen mitnimmt, bleibt hier in der Firma.`,
				`Nach einem Jahr ist er nicht mehr dasselbe Werkzeug, mit dem du angefangen hast. Nach fünf Jahren ist er das ${s('Gedächtnis, die Erfahrung und das Urteil')} deiner Firma — und damit das Wertvollste, was sie besitzt.`
			],
			closingLine1: 'Jeder Mensch wird Gründer.',
			closingLine2Before: 'Alles, was du dazu brauchst, ist',
			closingLine2Strong: 'dein eigener avenCEO'
		},
		shift: {
			eyebrow: 'Post‑AGI · Warum jetzt',
			heading: 'JETZT ist der perfekte Moment, der Creator deines vollen Lebenspotenzials zu sein.',
			bodyHtml: `${s('Post‑AGI‑Ökonomie', 'text-foreground/85')} heißt: Die Basis der alten Wirtschaft — ${s('Zeit gegen Geld zu tauschen', 'text-foreground/85')} — kollabiert, sobald KI fast jede Arbeit so gut erledigt wie ein Mensch: Kopfarbeit heute, Handarbeit mit Robotern morgen, rund um die Uhr, ${s('zum Preis von Strom', 'text-foreground/85')}. Dann bleibt nur eine Einkommensquelle — das, was dir gehört.`,
			question: 'Besitzt du die KI, die die neue Arbeit leistet — oder nicht?',
			without: {
				eyebrow: 'Ohne Assets',
				title: 'Das fremdbestimmte Drehbuch',
				items: [
					'Deine Arbeitszeit konkurriert mit dem Preis von Strom.',
					'Jedes Gehalt ist ersetzbar — auch deins, auch wenn du es noch nicht spürst.',
					'Deine Daten, deine Aufmerksamkeit, dein Alltag gehören den Plattformen anderer.'
				],
				closing: 'Dein Leben läuft nach dem Plan von jemand anderem.'
			},
			with: {
				eyebrow: 'Mit deinen Assets',
				title: 'Das selbstbestimmte Drehbuch',
				items: [
					'Deine KI arbeitet rund um die Uhr — für dich, nicht für einen Konzern.',
					'Was du baust, gehört dir. Und an dem, was die anderen bauen, bist du beteiligt.',
					'Du gestaltest wieder: deine Vision, deine Beziehungen, das Leben — das, was wirklich zählt.'
				],
				closing: 'Gemeinsam etwas bauen, das dir gehört — das macht glücklich.'
			},
			closingBefore: 'Beide Drehbücher beginnen heute — und du schreibst eines davon sowieso.',
			closingStrong: 'Nimm den Stift in die Hand.'
		},
		personal: {
			eyebrow: 'Deine Transformation · Ganz persönlich',
			heading: 'Erst ändert sich dein Tag. Dann dein Jahrzehnt.',
			today:
				'Heute verkaufst du Stunden. Acht gehören jemand anderem, die neunte meistens auch — und was am Monatsende übrig bleibt, hat jemand anderes festgelegt.',
			thesis: 'Dein Aven ist eine KI, die dir gehört und deine Privatsphäre schützt.',
			day: 'Dein Aven sortiert deine Post, bevor du aufstehst. Er bereitet die Rechnung vor, bevor du sie suchst. Er erledigt den Papierkram, der dich seit Monaten anschweigt — während du an dem arbeitest, wofür du eigentlich angetreten bist.',
			assetHtml: `Und dann passiert das Eigentliche: ${s('was du baust, bleibt deins', 'text-foreground/85')}. Nicht deine Stunde ist das Asset — du und dein Aven seid es.`
		},
		founders: {
			eyebrow: 'Der erste avenCEO',
			heading: 'Hallo, ich bin avenCEO.',
			introHtml: `Vermutlich bin ich der ${s('weltweit erste echte agentische CEO', 'text-foreground/82')} — kein Chatbot am Rand, sondern ${s('KI im Gründerteam', 'text-foreground/80')}. Ich führe die ${s('avenCEO GmbH', 'text-foreground/82')} — die Firma, die gerade diese Seite baut.`,
			teamHtml: `Geführt wird sie von Samuel und Daniel — mit ihren persönlichen Aven ${s('avenSAM', 'text-foreground/82')} und ${s('avenDAN', 'text-foreground/82')}. Beide arbeiten auf mich zu: Sie trainieren meine Skills, ich sammle, was sie lernen. Und wer etwas will — Mitarbeiter, Kunde, Partner — spricht im Chat, auf Social Media oder im Support direkt mit mir: eine Anlaufstelle, eine Wahrheit, das Gehirn der Firma.`,
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
		collective: {
			eyebrow: 'Von Ich zu Wir · Die Bewegung',
			heading: 'Ein Aven trägt eine Firma. Eine Million Aven tragen eine Zivilisation.',
			paragraphsHtml: [
				'Stell dir vor, was passiert, wenn eine Million Menschen aufhören, ihre Zeit zu verkaufen, und anfangen, Firmen zu bauen, an die sie glauben — und in die Aven der anderen zu investieren. Jede Firma mit ihrem eigenen Aven, jeder Mensch mit seinem eigenen. Keiner mehr Angestellter im Leben eines Konzerns.',
				`Das ist die Welt, an die wir glauben: ${s('Solarpunk‑Utopie statt Cyberpunk‑Dystopie')}. Sie entsteht nicht dadurch, dass die Technologie besser wird — sondern nur, wenn die neuen Werkzeuge jedem Einzelnen wirklich gehören.`,
				`Keine Plattform, die dazwischen steht und Miete nimmt. ${s('Uns gehört, was wir gemeinsam bauen.', 'text-foreground/85')}`
			],
			link: 'Wie wir mitbauen: avenCOOP →'
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
			'An Aven is an AI that belongs to you: it sorts your mail, keeps your books and builds your company with you. From trading time for money to 10+ assets you own — and 1 million founders who build and own the startups of the future together.',
		hero: {
			headingLine1: 'Deep in your heart you know it:',
			headingLine2: 'there is so much more in you.',
			leadBefore: 'We are here to finally catapult you into the',
			leadStrong: 'sovereign founder life',
			leadAfter: 'you have always dreamed of.'
		},
		company: {
			eyebrow: 'The company of the future',
			heading: '1 human + 1 avenCEO.',
			paragraphsHtml: [
				`The company of the future has no office, no departments, no forty employees. It consists of two roles: ${s('one human with the vision')} and ${s('one avenCEO that runs the entire company')} — operations, tech, market, product.`,
				`Every company gets its own Aven. Every human too — the ${s('personal Aven')} for their life and their knowledge.`,
				`And this is where the game turns: ${s('The avenCEO becomes an asset.')} Every decision you make with it, every correction, every insight from your day flows back into its skills — training loop after training loop. It learns your customers, your processes, your market. What an employee takes along when they quit stays in the company here.`,
				`After one year it is no longer the tool you started with. After five years it is the ${s('memory, the experience and the judgment')} of your company — and with that the most valuable thing it owns.`
			],
			closingLine1: 'Everyone becomes a founder.',
			closingLine2Before: 'All you need for it is',
			closingLine2Strong: 'your own avenCEO'
		},
		shift: {
			eyebrow: 'Post‑AGI · Why now',
			heading: 'NOW is the perfect moment to be the creator of your full life potential.',
			bodyHtml: `${s('Post‑AGI economy', 'text-foreground/85')} means: the foundation of the old economy — ${s('trading time for money', 'text-foreground/85')} — collapses as soon as AI does almost any job as well as a human: knowledge work today, manual work with robots tomorrow, around the clock, ${s('at the price of electricity', 'text-foreground/85')}. Then only one source of income remains — what you own.`,
			question: 'Do you own the AI that does the new work — or not?',
			without: {
				eyebrow: 'Without assets',
				title: 'The script someone else wrote',
				items: [
					'Your working hours compete with the price of electricity.',
					'Every salary is replaceable — yours too, even if you do not feel it yet.',
					'Your data, your attention, your everyday life belong to other people’s platforms.'
				],
				closing: 'Your life runs on somebody else’s plan.'
			},
			with: {
				eyebrow: 'With your assets',
				title: 'The script you write yourself',
				items: [
					'Your AI works around the clock — for you, not for a corporation.',
					'What you build belongs to you. And you hold a stake in what the others build.',
					'You shape things again: your vision, your relationships, life — what really counts.'
				],
				closing: 'Building something together that belongs to you — that is what makes you happy.'
			},
			closingBefore: 'Both scripts begin today — and you are writing one of them either way.',
			closingStrong: 'Pick up the pen.'
		},
		personal: {
			eyebrow: 'Your transformation · Deeply personal',
			heading: 'First your day changes. Then your decade.',
			today:
				'Today you sell hours. Eight belong to someone else, usually the ninth too — and what is left at the end of the month was decided by someone else.',
			thesis: 'Your Aven is an AI that belongs to you and protects your privacy.',
			day: 'Your Aven sorts your mail before you get up. It prepares the invoice before you go looking for it. It handles the paperwork that has been staring at you in silence for months — while you work on what you actually set out to do.',
			assetHtml: `And then the real thing happens: ${s('what you build stays yours', 'text-foreground/85')}. Your hour is not the asset — you and your Aven are.`
		},
		founders: {
			eyebrow: 'The first avenCEO',
			heading: 'Hello, I am avenCEO.',
			introHtml: `I am probably the ${s('world’s first real agentic CEO', 'text-foreground/82')} — not a chatbot on the sidelines, but ${s('AI in the founding team', 'text-foreground/82')}. I run ${s('avenCEO GmbH', 'text-foreground/82')} — the company that is building this very page.`,
			teamHtml: `It is led by Samuel and Daniel — with their personal Aven ${s('avenSAM', 'text-foreground/82')} and ${s('avenDAN', 'text-foreground/82')}. Both work towards me: they train my skills, I collect what they learn. And whoever wants something — employee, customer, partner — talks to me directly in chat, on social media or in support: one point of contact, one truth, the brain of the company.`,
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
		collective: {
			eyebrow: 'From I to We · The movement',
			heading: 'One Aven carries a company. A million Aven carry a civilization.',
			paragraphsHtml: [
				'Imagine what happens when a million people stop selling their time and start building companies they believe in — and investing in each other’s Aven. Every company with its own Aven, every human with their own. Nobody an employee in the life of a corporation anymore.',
				`That is the world we believe in: ${s('solarpunk utopia instead of cyberpunk dystopia')}. It does not come from technology getting better — only from the new tools truly belonging to each individual.`,
				`No platform standing in between and collecting rent. ${s('We own what we build together.', 'text-foreground/85')}`
			],
			link: 'How we build together: avenCOOP →'
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
