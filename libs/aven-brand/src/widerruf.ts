/**
 * Widerrufsbelehrung — the statutory model instruction (EGBGB Anlage 1 zu
 * Artikel 246a § 1 Absatz 2 Satz 2) with the Gestaltungshinweise resolved
 * for what we actually sell: services and digital content, no goods, no
 * shipping. Frist runs from Vertragsabschluss (Hinweis 1a); the online
 * revocation function is the eRecht24 button on the page itself (Hinweis 3,
 * "anderer geeigneter Hinweis"); early-start services are settled pro rata
 * (letzter Hinweis). Anlage 2 (Muster-Widerrufsformular) is attached, so
 * "das beigefügte Muster-Widerrufsformular" refers to something real.
 * The English mirror uses the official EU model instruction wording
 * (Directive 2011/83/EU, Annex I) at /withdrawal. Contact data is templated
 * from [[COMPANY]].
 */
import { COMPANY } from './company.js'
import type { LegalDocument } from './legal.js'

const c = COMPANY

export const WIDERRUF_DE: LegalDocument = {
	slug: 'widerruf',
	lang: 'de',
	title: 'Widerrufsbelehrung',
	path: '/de/widerruf/',
	sections: [
		{
			level: 2,
			title: 'Widerrufsrecht',
			blocks: [
				{
					lines: [
						'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.'
					]
				},
				{
					lines: ['Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.']
				},
				{
					lines: [
						`Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${c.legalName}, ${c.street}, ${c.city}, Telefon: ${c.phone}, E-Mail: ${c.email}) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.`
					]
				},
				{
					lines: [
						'Sie können Ihr Widerrufsrecht auch online über den Widerrufsbutton auf dieser Seite ausüben. Wenn Sie diese Online-Funktion nutzen, übermitteln wir Ihnen auf einem dauerhaften Datenträger (z. B. durch eine E-Mail) unverzüglich eine Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs.'
					]
				},
				{
					lines: [
						'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.'
					]
				}
			]
		},
		{
			level: 2,
			title: 'Folgen des Widerrufs',
			blocks: [
				{
					lines: [
						'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.'
					]
				},
				{
					lines: [
						'Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.'
					]
				}
			]
		},
		{
			level: 2,
			title: 'Muster-Widerrufsformular',
			blocks: [
				{
					lines: [
						'(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)'
					]
				},
				{
					lines: [
						`– An ${c.legalName}, ${c.street}, ${c.city}, E-Mail: ${c.email}:`,
						'– Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)',
						'– Bestellt am (*)/erhalten am (*)',
						'– Name des/der Verbraucher(s)',
						'– Anschrift des/der Verbraucher(s)',
						'– Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)',
						'– Datum'
					]
				},
				{ lines: ['(*) Unzutreffendes streichen.'] }
			]
		}
	]
}

export const WITHDRAWAL_EN: LegalDocument = {
	slug: 'widerruf',
	lang: 'en',
	title: 'Right of Withdrawal',
	path: '/withdrawal/',
	sections: [
		{
			level: 2,
			title: 'Right of withdrawal',
			blocks: [
				{
					lines: [
						'You have the right to withdraw from this contract within fourteen days without giving any reason.'
					]
				},
				{
					lines: [
						'The withdrawal period will expire after fourteen days from the day of the conclusion of the contract.'
					]
				},
				{
					lines: [
						`To exercise the right of withdrawal, you must inform us (${c.legalName}, ${c.street}, ${c.city}, Germany, phone: ${c.phone}, e-mail: ${c.email}) of your decision to withdraw from this contract by an unequivocal statement (e.g. a letter sent by post or an e-mail). You may use the attached model withdrawal form, but it is not obligatory.`
					]
				},
				{
					lines: [
						'You can also exercise your right of withdrawal online via the revocation button on this page. If you use this online function, we will send you without undue delay an acknowledgement of receipt on a durable medium (e.g. by e-mail), including information on the content of the withdrawal declaration and the date and time of its receipt.'
					]
				},
				{
					lines: [
						'To meet the withdrawal deadline, it is sufficient for you to send your communication concerning your exercise of the right of withdrawal before the withdrawal period has expired.'
					]
				}
			]
		},
		{
			level: 2,
			title: 'Effects of withdrawal',
			blocks: [
				{
					lines: [
						'If you withdraw from this contract, we shall reimburse to you all payments received from you, including the costs of delivery (with the exception of the supplementary costs resulting from your choice of a type of delivery other than the least expensive type of standard delivery offered by us), without undue delay and in any event not later than fourteen days from the day on which we are informed about your decision to withdraw from this contract. We will carry out such reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement.'
					]
				},
				{
					lines: [
						'If you requested to begin the performance of services during the withdrawal period, you shall pay us an amount which is in proportion to what has been provided until you have communicated to us your withdrawal from this contract, in comparison with the full coverage of the contract.'
					]
				}
			]
		},
		{
			level: 2,
			title: 'Model withdrawal form',
			blocks: [
				{
					lines: ['(Complete and return this form only if you wish to withdraw from the contract.)']
				},
				{
					lines: [
						`– To ${c.legalName}, ${c.street}, ${c.city}, Germany, e-mail: ${c.email}:`,
						'– I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract of sale of the following goods (*)/for the provision of the following service (*)',
						'– Ordered on (*)/received on (*)',
						'– Name of consumer(s)',
						'– Address of consumer(s)',
						'– Signature of consumer(s) (only if this form is notified on paper)',
						'– Date'
					]
				},
				{ lines: ['(*) Delete as appropriate.'] }
			]
		}
	]
}
