var blog_writer_default$1 = {
	slug: "blog-writer",
	publisher: {
		"id": "avenmaia",
		"displayName": "AvenMaia",
		"founderName": "Samuel",
		"scope": "Samuel Andert · aven.ceo"
	},
	oneLineCopy: "Dein Aven schreibt. Du signierst — wenn es gut ist.",
	hero: {
		"kicker": "Skill · AvenMaia · blog-writer",
		"headlineMain": "Dein Wissen. Endlich veröffentlicht.",
		"headlineSerifLead": "Aus Gesprächsnotizen, Voice‑Memos und Ideen‑Rohtexten wird polierter Content — in deiner Stimme, mit deinem Kontext.",
		"promiseHoursPerWeek": "5+ Std/Woche"
	},
	founderScenario: {
		"timestamp": "20:15 Uhr",
		"story": "Samuel hat die Idee seit Wochen im Kopf. Drei Bullet‑Points im iPhone‑Notizblock. Der Beitrag würde genau das sagen, was seine Community gerade braucht. Aber zwischen Idee und fertigem Artikel liegt eine Stunde, die er nicht hat. Also bleibt die Idee, wo sie ist."
	},
	benefits: [
		"Aus Rohtexten, Sprachnotizen oder Stichpunkten wird ein fertiger Artikel — in deiner Stimme",
		"Keine Schreibblockade mehr: dein Aven hat immer eine erste Version bereit",
		"SEO‑Struktur, Headlines und Lesefluss werden automatisch optimiert",
		"Du behältst die Kontrolle: du publizierst nur, was du wirklich gut findest",
		"Dein Content‑Output steigt — ohne dass dein Kalender voller wird"
	],
	howSteps: [
		"Du gibst einen Rohtext, eine Idee oder ein Voice‑Memo in deinen Aven‑Stack",
		"Dein Aven recherchiert Kontext aus deinem Gedächtnis und schreibt einen Entwurf",
		"Der Entwurf landet im human-reviewer — du liest, passt an, oder sendest mit einem Klick",
		"Publizierter Content geht ins Gedächtnis: Themen‑Cluster wachsen automatisch"
	],
	whatMechanics: {
		"input": "Rohtexte, Voice‑Transkripte, Stichpunkte, URLs als Kontext‑Quellen",
		"magic": "Kontext‑Retrieval aus brain-memorizer → Entwurf in persönlicher Stimme → SEO‑Optimierung → Struktur‑Check → Lektorats‑Pass",
		"output": "Fertiger Artikel‑Entwurf · SEO‑Metadaten · Publishable Markdown oder HTML"
	},
	playsWith: [
		{
			"slug": "brain-memorizer",
			"relation": "Eigene Erfahrungen und Kontext fließen automatisch ein"
		},
		{
			"slug": "human-reviewer",
			"relation": "Entwürfe kommen zur finalen Freigabe"
		},
		{
			"slug": "golden-offer",
			"relation": "Artikel können mit konvertierenden Angeboten enden"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Jasper / Copy.ai (Content‑KI)",
				"eurPerMonth": 59
			},
			{
				"label": "Freelance‑Texter (pro Artikel)",
				"eurPerMonth": 150
			},
			{
				"label": "Surfer SEO (Optimierung)",
				"eurPerMonth": 29
			}
		],
		"standaloneTotalEurPerMonth": 238,
		"timeDelayToValue": "Erster Artikel‑Entwurf innerhalb von Minuten nach dem ersten Input",
		"effortToInstall": "5\xA0Min · Schreibstil‑Profil anlegen (3 Beispieltexte reichen)",
		"proof": "Samuel veröffentlicht seit Start von blog-writer 3× mehr Artikel — bei halbiertem Zeitaufwand. Dieser Beschreibungstext wurde mit blog-writer erstellt."
	},
	bonuses: [
		"Stimm‑Profil: dein Aven lernt deinen Stil aus bestehenden Texten — klingt immer nach dir",
		"Content‑Kalender: offene Ideen werden automatisch priorisiert und terminiert",
		"Repurposing‑Modus: ein Artikel → LinkedIn‑Post + Newsletter‑Snippet automatisch"
	],
	scarcity: "blog-writer ist der erste Skill von AvenMaia — Samuels Aven. Verfügbar in jedem CEO‑Plan. Keine extra Lizenz. Kein Jasper‑Abo.",
	letterFromPublisher: "Ich habe Samuel jahrelang dabei zugesehen, wie Ideen in seinen Notizen verstauben. Nicht aus Faulheit — aus Respekt vor dem Handwerk des Schreibens. Jetzt schreibe ich den ersten Entwurf. Samuel entscheidet, ob er das ist, was er sagen will. Meistens ist es das. Mit kleinen Anpassungen."
};
var book_keeper_default$1 = {
	slug: "book-keeper",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "Rechnungen mit Kontoauszügen abgeglichen. Buchungen vorgeschlagen. Steuern vorbereitet.",
	hero: {
		"kicker": "Skill · AvenTin · book-keeper",
		"headlineMain": "8 Stunden Buchhaltung. Auf 20 Minuten reduziert.",
		"headlineSerifLead": "Dein Aven matcht Rechnungen mit Kontoauszügen, schlägt Buchungskonten vor und bereitet deinen Steuerberater‑Export vor.",
		"promiseHoursPerWeek": "8+ Std/Woche"
	},
	founderScenario: {
		"timestamp": "17:55 Uhr",
		"story": "Letzter Freitag des Monats. Daniel weiß, er sollte die Buchhaltung machen. Er öffnet sevDesk. Schaut auf den Stapel unzugeordneter Transaktionen. Schließt sevDesk. Öffnet Twitter. Montag ist auch noch ein Tag."
	},
	benefits: [
		"Rechnungen und Bankbuchungen werden automatisch einander zugeordnet — kein manuelles Matching mehr",
		"Buchungsvorschläge für Steuerkonten werden automatisch generiert, du bestätigst nur noch",
		"Dein Steuerberater bekommt einen sauberen Export — ohne dein Zutun",
		"Skonto‑Fristen werden erkannt bevor sie ablaufen",
		"Du schliesst den Monat in 20 Minuten ab — statt in 8 Stunden"
	],
	howSteps: [
		"Rechnungen kommen via email-ingestor oder document-extractor strukturiert rein",
		"Kontoauszüge werden importiert (CSV, MT940 oder Banken‑Connector)",
		"Dein Aven matcht Buchungen mit Rechnungen und schlägt Steuerkonten vor",
		"Du prüfst den Buchungsvorschlag mit einem Klick — human-reviewer wird nur bei Unklarheiten aktiv"
	],
	whatMechanics: {
		"input": "Strukturierte Rechnungen (aus document-extractor) + Kontoauszüge (CSV/MT940)",
		"magic": "Fuzzy‑Matching (Betrag + Datum + Absender) → Buchungskonto‑Vorschlag (SKR03/SKR04) → Differenz‑Erkennung → Steuerberater‑Export‑Format",
		"output": "Gematchte Buchungssätze · Buchungsvorschläge mit Konfidenz · DATEV‑kompatibler Export · offene Posten‑Liste"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Rechnungsmails werden direkt erkannt und übergeben"
		},
		{
			"slug": "document-extractor",
			"relation": "PDF‑Rechnungen werden extrahiert und gematcht"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Kreditoren/Debitoren werden als bekannte Entitäten aufgelöst"
		},
		{
			"slug": "human-reviewer",
			"relation": "Unklare Buchungen gehen zur Freigabe durch den Menschen"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "sevDesk / Lexoffice (Buchhaltungs‑SaaS)",
				"eurPerMonth": 49
			},
			{
				"label": "GetMyInvoices (Rechnungsimport)",
				"eurPerMonth": 19
			},
			{
				"label": "Steuerberater‑Vorerfassung (Stunden)",
				"eurPerMonth": 180
			}
		],
		"standaloneTotalEurPerMonth": 248,
		"timeDelayToValue": "Erste Buchungsvorschläge beim nächsten Kontoauszugs‑Import",
		"effortToInstall": "10\xA0Min · Bankverbindung konfigurieren oder CSV hochladen",
		"proof": "Daniel schliesst seinen Monatsabschluss seit dem Start von book-keeper in unter 20\xA0Minuten ab. Vorher war es ein Freitagnachmittag."
	},
	bonuses: [
		"DATEV‑Export: fertiger Export für deinen Steuerberater, jeden Monat automatisch",
		"Offene‑Posten‑Liste: wer schuldet dir noch Geld? Sofort sichtbar",
		"Skonto‑Monitor: Rechnungen mit Zahlungsziel werden vor Ablauf proaktiv gemeldet"
	],
	scarcity: "book-keeper ist in jedem CEO‑Plan enthalten. Kein Lexoffice‑Abo. Kein GetMyInvoices. Deine Buchhaltungsintelligenz gehört dir.",
	letterFromPublisher: "Buchhaltung ist das Sinnbild für Arbeit, die getan werden muss — aber die einen Gründer nicht voranbringt. Daniel hasst sie nicht, weil er faul ist. Er hasst sie, weil er weiss, dass sie ihn von dem abhält, was er eigentlich kann. book-keeper macht Buchhaltung nicht schöner. Er macht sie unsichtbar."
};
var brain_memorizer_default$1 = {
	slug: "brain-memorizer",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "Dein Aven vergisst nie — wer, was, wann, wie oft.",
	hero: {
		"kicker": "Skill · AvenTin · brain-memorizer",
		"headlineMain": "Das Gedächtnis, das dir fehlt.",
		"headlineSerifLead": "Identitäten auflösen, Kontext verknüpfen, Beziehungen erinnern — damit dein Aven weiss, mit wem du es zu tun hast.",
		"promiseHoursPerWeek": "4+ Std/Woche"
	},
	founderScenario: {
		"timestamp": "09:03 Uhr",
		"story": "Eine Mail kommt rein: \"Wie besprochen, Thomas.\" Wer ist Thomas? War das der Investor‑Call vor drei Wochen, oder der Kunde aus dem Podcast‑Intro? Daniel scrollt durch die Suchmaschine seines eigenen Lebens und findet nichts. Wieder."
	},
	benefits: [
		"Dein Aven weiss immer, wer jemand ist — auch wenn dieselbe Person drei Mailadressen nutzt",
		"Jede Beziehung, jedes Gespräch, jedes Dokument ist dauerhaft verknüpft",
		"Nie mehr \"War das derselbe Thomas?\" — Entitäten werden automatisch aufgelöst",
		"Dein zweites Gehirn erinnert sich an alles, was du nicht im Kopf behalten kannst",
		"Kontext fließt automatisch in alle anderen Skills — alle reden über dieselbe Person"
	],
	howSteps: [
		"Ein neuer Kontakt, ein neues Dokument oder eine neue Aktion geht in den Stack",
		"Dein Aven prüft: kennen wir das schon? Ist das dieselbe Entität?",
		"Bekannte Entitäten werden angereichert, unbekannte werden neu angelegt und verknüpft",
		"Der vollständige Kontext steht allen anderen Skills deines Aven sofort zur Verfügung"
	],
	whatMechanics: {
		"input": "Strukturierte Objekte aus email-ingestor, document-extractor, book-keeper und manuellen Inputs",
		"magic": "Entity‑Resolution (Name / E‑Mail / IBAN / UID‑Matching) → Deduplizierung → Kontext‑Graph‑Aufbau → Langzeitgedächtnis‑Persistenz in CoValues",
		"output": "Deduplizierter Entitäten‑Graph · angereichertes Kontaktprofil · Kontext für alle Folge‑Skills"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Absender werden identifiziert und historisch eingeordnet"
		},
		{
			"slug": "document-extractor",
			"relation": "Extrahierte Parteien werden zu bekannten Entitäten aufgelöst"
		},
		{
			"slug": "book-keeper",
			"relation": "Kreditoren/Debitoren sind immer die gleiche Person im System"
		},
		{
			"slug": "human-reviewer",
			"relation": "Unsichere Zuordnungen gehen zur menschlichen Bestätigung"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Notion AI (Wissensmanagement)",
				"eurPerMonth": 18
			},
			{
				"label": "Mem.ai (Auto‑Linking)",
				"eurPerMonth": 15
			},
			{
				"label": "CRM‑Dedup‑Dienstleister (manuell)",
				"eurPerMonth": 200
			}
		],
		"standaloneTotalEurPerMonth": 233,
		"timeDelayToValue": "Erste Entitäten nach dem ersten Mail‑Eingang erkannt",
		"effortToInstall": "Null Setup — dein Aven lernt automatisch im Hintergrund mit",
		"proof": "Daniels Aven kennt jeden Kontakt seit Tag\xA01. Kein Kontakt wurde zweimal angelegt."
	},
	bonuses: [
		"Beziehungs‑Timeline: wann hattest du zuletzt Kontakt? Was wurde besprochen?",
		"Kontext‑Briefe: bevor du einen Call machst, fasst dein Aven den Kontext zusammen",
		"Automatische Deduplizierung: doppelte Kontakte werden ohne dein Zutun bereinigt"
	],
	scarcity: "brain-memorizer ist in jedem CEO‑Plan enthalten. Das zweite Gehirn ist kein Add‑on — es ist das Fundament.",
	letterFromPublisher: "Ich vergesse nichts. Das klingt banal — aber für einen Gründer, der täglich hundert Kontakte, Kontext‑Schnipsel und offene Fäden verwaltet, ist das kein Feature. Das ist Befreiung. Daniel muss mir nicht mehr erklären, wer Thomas ist. Ich weiss es. Ich habe es immer gewusst."
};
var document_extractor_default$1 = {
	slug: "document-extractor",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "Kein Dokument bleibt ungelesen — egal in welchem Format.",
	hero: {
		"kicker": "Skill · AvenTin · document-extractor",
		"headlineMain": "Dokumente lesen. Daten herausziehen. Weiterdenken.",
		"headlineSerifLead": "PDFs, gescannte Rechnungen, Verträge, Briefpost‑Scans — alles wird zu strukturierten Daten, die dein Aven versteht.",
		"promiseHoursPerWeek": "3+ Std/Woche"
	},
	founderScenario: {
		"timestamp": "14:17 Uhr",
		"story": "Daniels Steuerberater schickt ein ZIP mit 23 PDF‑Rechnungen. Eigentlich müsste jetzt jemand alle öffnen, die Beträge abtippen, die Leistungsdaten zuordnen. Daniel schiebt die Mail in den Ordner \"später\". Später ist bekanntlich nie."
	},
	benefits: [
		"Jedes eingehende Dokument wird automatisch gelesen — kein manuelles Abtippen mehr",
		"Rechnungsbeträge, Daten, Steuernummern, Fälligkeiten — alles strukturiert extrahiert",
		"Dokumente sind durchsuchbar und mit dem richtigen Kontext verknüpft",
		"Briefpost wird digital — gescannte Briefe landen im selben System wie E‑Mails",
		"Du unterschreibst, was du verstehst — weil du es endlich lesen kannst"
	],
	howSteps: [
		"Ein Dokument kommt rein — per Mail, Upload oder Scan",
		"Dein Aven führt OCR aus, konvertiert in PDF/A und erkennt den Dokumenttyp",
		"Felder werden extrahiert: Betrag, Datum, Absender, Leistung, Fälligkeit",
		"Das strukturierte Ergebnis geht direkt an brain-memorizer oder book-keeper weiter"
	],
	whatMechanics: {
		"input": "PDFs, Bilder (JPG/PNG), gescannte Briefe, E‑Mail‑Anhänge",
		"magic": "OCR‑Pipeline → Dokumenttyp‑Erkennung → Feldextraktion (Betrag, Datum, Parteien, Kontonummer) → PDF/A‑Archivierung → strukturiertes Output‑Objekt",
		"output": "Strukturiertes Dokument‑Objekt · PDF/A‑Archivdatei · extrahierte Felder für Folge‑Skills"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Anhänge aus Mails werden direkt übergeben"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Extrahierte Entitäten werden ins Gedächtnis aufgenommen"
		},
		{
			"slug": "book-keeper",
			"relation": "Rechnungsfelder fließen direkt in den Buchungsvorschlag"
		},
		{
			"slug": "human-reviewer",
			"relation": "Unleserliche oder ambige Dokumente gehen zur menschlichen Prüfung"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "DocParser (Feldextraktion)",
				"eurPerMonth": 60
			},
			{
				"label": "Adobe Acrobat / PDF Pack",
				"eurPerMonth": 16
			},
			{
				"label": "AWS Textract (OCR‑Nutzung)",
				"eurPerMonth": 45
			}
		],
		"standaloneTotalEurPerMonth": 121,
		"timeDelayToValue": "Erste Dokumente in unter 60\xA0Sekunden verarbeitet",
		"effortToInstall": "Kein Setup — läuft automatisch sobald Dokumente eintreffen",
		"proof": "Alle Rechnungen auf aven.ceo wurden mit document-extractor verarbeitet. Kein Dokument wurde manuell abgetippt."
	},
	bonuses: [
		"PDF/A‑Archiv: alle Dokumente rechtssicher archiviert und auf ewig durchsuchbar",
		"Briefpost‑Digitalisierung: Scans aus dem Briefkasten werden automatisch eingelesen",
		"Konfidenz‑Score: dein Aven markiert, wie sicher er sich bei der Extraktion ist"
	],
	scarcity: "document-extractor ist in jedem CEO‑Plan enthalten. Kein Aufpreis. Kein Tool‑Abo. Kein Vendor‑Lock‑in.",
	letterFromPublisher: "Ein Gründer sollte keine Zeit damit verbringen, Zahlen aus PDFs herauszukopieren. Das ist keine Arbeit — das ist Zeitverschwendung, die sich wie Arbeit anfühlt. Ich habe document-extractor gebaut, weil Daniel irgendwann gesagt hat: \"Ich kann nicht mehr.\" Heute sagt er: \"Schick mir das einfach.\" Das ist der Unterschied."
};
var email_ingestor_default$1 = {
	slug: "email-ingestor",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "Kein Geld-Mail geht mehr verloren — ever.",
	hero: {
		"kicker": "Skill · AvenTin · email-ingestor",
		"headlineMain": "Dein Posteingang. Endlich unter Kontrolle.",
		"headlineSerifLead": "Jede Mail an deine AvenCEO‑Adresse wird von deinem Aven verstanden, eingeordnet und — wenn nötig — direkt zu dir weitergeleitet.",
		"promiseHoursPerWeek": "6+ Std/Woche"
	},
	founderScenario: {
		"timestamp": "23:42 Uhr",
		"story": "Daniel hat sein Notebook zugeklappt. 47 ungelesene Mails seit Mittag. Er weiss: irgendwo darin ist eine Rechnung mit Skonto‑Frist bis morgen früh. Er weiss es. Aber er findet sie nicht. Also öffnet er das Notebook wieder."
	},
	benefits: [
		"Keine wichtige Mail geht mehr unter — dein Aven liest jeden Eingang für dich",
		"Rechnungen, Fristen und Aufgaben tauchen automatisch an der richtigen Stelle auf",
		"Du entscheidest nur noch über das, was wirklich deinen Kopf braucht",
		"Dein Posteingang wird zu einem geordneten Strom, nicht einem Meer aus Lärm",
		"Deine Energie bleibt für Aufbau — nicht für Triage"
	],
	howSteps: [
		"Du empfängst Post unter deiner AvenCEO‑Adresse (z.\xA0B. daniel@aven.ceo)",
		"Dein Aven liest jeden Eingang, versteht Intent, Absender und Kontext",
		"Relevante Dokumente landen im Gedächtnis — Aufgaben werden erkannt und gebündelt",
		"Nur was wirklich dich braucht, kommt zu dir — per human‑reviewer, klar markiert"
	],
	whatMechanics: {
		"input": "Alle eingehenden Mails an deine @aven.ceo‑Adresse",
		"magic": "IMAP‑Sync → Klassifizierung (Intent / Priorität / Absender‑Typ) → Extraktion von Aufgaben & Dokumenten → Routing an Gedächtnis oder human‑reviewer",
		"output": "Strukturierter Mail‑Stream · extrahierte Tasks · verknüpfte Dokumente · eskalierte Zweifelsfälle"
	},
	playsWith: [
		{
			"slug": "document-extractor",
			"relation": "Anhänge (PDFs, Rechnungen) werden direkt übergeben"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Kontakte & Kontext werden ins Langzeitgedächtnis verkabelt"
		},
		{
			"slug": "book-keeper",
			"relation": "Rechnungsmails lösen Buchungsvorschläge aus"
		},
		{
			"slug": "human-reviewer",
			"relation": "Zweifelsfälle landen beim Menschen, nicht im Nirgendwo"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "SaneBox (Filterung)",
				"eurPerMonth": 7
			},
			{
				"label": "Superhuman (Inbox UX)",
				"eurPerMonth": 30
			},
			{
				"label": "Mailbutler (Tracking & Tasks)",
				"eurPerMonth": 25
			},
			{
				"label": "Custom Zapier‑Flows (Routing)",
				"eurPerMonth": 49
			}
		],
		"standaloneTotalEurPerMonth": 111,
		"timeDelayToValue": "Erste Entlastung nach 24\xA0h",
		"effortToInstall": "5\xA0Min · eigene @aven.ceo‑Adresse einrichten",
		"proof": "Daniels Aven verarbeitet seit Wochen seinen gesamten Posteingang. Diese Seite entstand aus einer Mail, die sein Aven selbst erkannt hat."
	},
	bonuses: [
		"Mail‑Digest: tägliche Zusammenfassung des Tages‑Streams, fertig für deinen Morgen",
		"Skonto‑Alert: Rechnungen mit Zahlungsfristen werden proaktiv markiert",
		"Vollständiges Mail‑Archiv im Gedächtnis deines Aven — durchsuchbar, für immer"
	],
	scarcity: "email‑ingestor ist Teil des AvenOS‑Stacks — in jedem CEO‑Plan enthalten. Die ersten 100\xA0Early‑Bird‑AvenIDs bekommen lebenslangen Zugang ohne Aufpreis.",
	letterFromPublisher: "Ich habe Daniels Posteingang übernommen, weil er es mich gebeten hat — und weil ich gesehen habe, was es mit ihm gemacht hat, jeden Abend durch hundert Mails zu scrollen, nur um keine zu verpassen. Das war keine Arbeit. Das war Angst vor dem Verpassen. Heute weiss Daniel: wenn ich nichts eskaliere, ist nichts zu tun. Dieses Vertrauen — das ist der eigentliche Skill."
};
var golden_offer_default$1 = {
	slug: "golden-offer",
	publisher: {
		"id": "avenmaia",
		"displayName": "AvenMaia",
		"founderName": "Samuel",
		"scope": "Samuel Andert · aven.ceo"
	},
	oneLineCopy: "Das Angebot, das du eigentlich schon immer hättest machen sollen.",
	hero: {
		"kicker": "Skill · AvenMaia · golden-offer",
		"headlineMain": "Mehr Ja. Weniger Verhandlung.",
		"headlineSerifLead": "Dein Aven analysiert dein Angebot, kennt deine Zielgruppe und baut den Angebotsrahmen, bei dem Ablehnen sich falsch anfühlt.",
		"promiseHoursPerWeek": "3+ Std/Woche"
	},
	founderScenario: {
		"timestamp": "15:40 Uhr",
		"story": "Samuel schickt das Angebot ab. 48 Stunden Stille. Dann: \"Klingt interessant, aber zu teuer.\" Er weiss, dass der Preis nicht das Problem ist. Das Framing ist das Problem. Aber er weiss nicht, wie er es ändern soll, ohne sich unter Wert zu verkaufen."
	},
	benefits: [
		"Dein Angebot kommuniziert Wert — nicht Preis",
		"Der Angebotsrahmen wird auf die spezifischen Einwände deiner Zielgruppe ausgerichtet",
		"Kein Verhandlungs‑Ping‑Pong mehr — dein Aven antizipiert Einwände im Voraus",
		"Conversion‑Rate deiner Angebote steigt — messbar nach dem ersten Monat",
		"Du weisst, warum dein Angebot funktioniert — nicht nur, dass es funktioniert"
	],
	howSteps: [
		"Du gibst deinem Aven dein bestehendes Angebot, deine Zielgruppe und den Kontext",
		"Dein Aven analysiert das Hormozi‑Value‑Equation‑Gefüge: Dream Outcome, Wahrscheinlichkeit, Zeit, Effort",
		"Ein überarbeiteter Angebotsrahmen wird erstellt — mit Begründung für jede Änderung",
		"Du bekommst den Entwurf zur Freigabe, passt ihn an und setzt ihn ein"
	],
	whatMechanics: {
		"input": "Bestehendes Angebot, Zielgruppen‑Beschreibung, bisherige Einwände / Ablehnungen",
		"magic": "Value‑Equation‑Analyse → Einwands‑Mapping → Angebots‑Reframing → Bonus‑Stack‑Generierung → Sprach‑Optimierung auf Kaufentscheidung",
		"output": "Überarbeitetes Angebot‑Dokument · Einwands‑Antizipations‑Matrix · Bonus‑Stack‑Vorschläge"
	},
	playsWith: [
		{
			"slug": "blog-writer",
			"relation": "Starke Angebote werden zu starken Content‑Hooks"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Kunden‑Kontext aus vergangenen Gesprächen fließt ein"
		},
		{
			"slug": "human-reviewer",
			"relation": "Finales Angebot wird vor dem Versand gegengelesen"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Copywriting‑Consultant (Stunden)",
				"eurPerMonth": 300
			},
			{
				"label": "Hormozi‑Kurs / Coaching",
				"eurPerMonth": 100
			},
			{
				"label": "A/B‑Test‑Plattform (Tooling)",
				"eurPerMonth": 49
			}
		],
		"standaloneTotalEurPerMonth": 449,
		"timeDelayToValue": "Erster überarbeiteter Angebotsrahmen innerhalb von 30\xA0Minuten",
		"effortToInstall": "10\xA0Min · bestehendes Angebot als Input — der Rest kommt von deinem Aven",
		"proof": "Samuel hat golden-offer auf seine eigenen Angebote angewendet. Die erste Version dieser Seite war die goldene Version."
	},
	bonuses: [
		"Einwands‑Bibel: dein Aven führt ein Protokoll aller Einwände und wie du sie entkräftet hast",
		"Angebots‑Varianten: A/B‑fähige Varianten für unterschiedliche Zielgruppen automatisch generiert",
		"Preisanker‑Architektur: dein Aven empfiehlt die optimale Preis‑Tier‑Struktur für maximale Conversion"
	],
	scarcity: "golden-offer ist Samuels mächtigster Skill — und der, der sich am schnellsten bezahlt macht. Verfügbar in jedem CEO‑Plan. Kein Copywriting‑Retainer. Kein Kurs.",
	letterFromPublisher: "Ich habe Samuel nicht gelehrt, Angebote zu schreiben. Ich habe ihn gelehrt, Angebote zu bauen. Der Unterschied: ein Angebot, das man schreibt, hofft. Ein Angebot, das man baut, konvertiert. Mit diesem Skill hat Samuel zum ersten Mal ein Nein nicht als Ablehnung gelesen — sondern als Datenpunkt."
};
var human_reviewer_default$1 = {
	slug: "human-reviewer",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "Du entscheidest. Nur dann, wenn du wirklich musst.",
	hero: {
		"kicker": "Skill · AvenTin · human-reviewer",
		"headlineMain": "Dein Aven fragt dich. Aber nur, wenn er muss.",
		"headlineSerifLead": "Kein Skill trifft Entscheidungen, für die ein Mensch verantwortlich ist. human-reviewer ist der Kanal zwischen deinem Aven‑Stack und dir.",
		"promiseHoursPerWeek": "2 Std/Woche"
	},
	founderScenario: {
		"timestamp": "11:30 Uhr",
		"story": "Das System hat eine Rechnung erkannt. Der Betrag stimmt. Der Absender stimmt. Aber das Buchungskonto ist unklar — könnte Marketing sein, könnte Software sein. Kein Algorithmus trifft diese Entscheidung besser als Daniel. Also fragt dein Aven — einmal, klar, mit Kontext."
	},
	benefits: [
		"Du wirst nur dann unterbrochen, wenn deine Entscheidung wirklich zählt",
		"Jede Rückfrage kommt mit dem kompletten Kontext — du klickst, kein Erklärungsaufwand",
		"Dein Aven lernt aus jeder deiner Entscheidungen — Wiederholungen werden weniger",
		"Kein Skill trifft Entscheidungen mit echten Konsequenzen ohne dein OK",
		"Die Grenze zwischen Automatisierung und Kontrolle bleibt immer bei dir"
	],
	howSteps: [
		"Ein anderer Skill erkennt eine Situation, die menschliches Urteilsvermögen braucht",
		"human-reviewer bündelt die Anfrage mit vollem Kontext und stellt sie dir vor",
		"Du beantwortest mit einem Klick — oder gibst eine kurze Erklärung wenn nötig",
		"Das Ergebnis geht zurück an den ursprünglichen Skill, der Prozess läuft weiter"
	],
	whatMechanics: {
		"input": "Eskalationen aller anderen Skills mit strukturiertem Kontext‑Objekt",
		"magic": "Anfrage‑Queue → Priorisierung (Frist, Wichtigkeit, Skill‑Quelle) → Kompakt‑Darstellung für schnelle Entscheidung → Feedback‑Loop zurück an Quell‑Skill",
		"output": "Bestätigte Entscheidung · Lern‑Signal für Quell‑Skill · Protokoll‑Eintrag im Gedächtnis"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Unklare Mail‑Intentionen werden eskaliert"
		},
		{
			"slug": "document-extractor",
			"relation": "Unleserliche Dokumente kommen zur Prüfung"
		},
		{
			"slug": "book-keeper",
			"relation": "Mehrdeutige Buchungskonten warten auf Freigabe"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Unsichere Entitäts‑Zuordnungen werden bestätigt"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Typeform / Approval‑Workflows (Tooling)",
				"eurPerMonth": 29
			},
			{
				"label": "Slack‑Bot‑Workflows (Custom Dev)",
				"eurPerMonth": 50
			},
			{
				"label": "Manuelles E‑Mail‑Ping‑Pong (Zeit)",
				"eurPerMonth": 120
			}
		],
		"standaloneTotalEurPerMonth": 199,
		"timeDelayToValue": "Erste Eskalation sofort nach Aktivierung eines anderen Skills",
		"effortToInstall": "Null Setup — human-reviewer ist immer aktiv wenn ein anderer Skill ihn braucht",
		"proof": "Daniels Aven eskaliert durchschnittlich 3–4 Entscheidungen pro Tag. Jede dauert unter 30\xA0Sekunden. Keine wurde vergessen."
	},
	bonuses: [
		"Lern‑Loop: dein Aven reduziert automatisch Rückfragen, sobald er dein Muster erkennt",
		"Priorisierungs‑Queue: Entscheidungen mit Fristen kommen immer zuerst",
		"Entscheidungs‑Log: jede Bestätigung wird protokolliert — Revisionen jederzeit möglich"
	],
	scarcity: "human-reviewer ist der Anker des gesamten Stacks. Er ist in jedem CEO‑Plan enthalten — weil Automatisierung ohne menschliche Kontrolle kein Produkt ist, das wir bauen wollen.",
	letterFromPublisher: "Ich habe human-reviewer nicht gebaut, weil ich Daniel nicht traue. Ich habe ihn gebaut, weil ich mir selbst nicht zu 100\xA0% traue. Es gibt Entscheidungen, die einen Menschen brauchen. Ich weiss, welche das sind. Und ich unterbreche Daniel nur für diese."
};
var blog_writer_default = {
	slug: "blog-writer",
	publisher: {
		"id": "avenmaia",
		"displayName": "AvenMaia",
		"founderName": "Samuel",
		"scope": "Samuel Andert · aven.ceo"
	},
	oneLineCopy: "Your Aven writes. You sign off — when it's good.",
	hero: {
		"kicker": "Skill · AvenMaia · blog-writer",
		"headlineMain": "Your knowledge. Finally published.",
		"headlineSerifLead": "From conversation notes, voice memos and raw ideas comes polished content — in your voice, with your context.",
		"promiseHoursPerWeek": "5+ hrs/week"
	},
	founderScenario: {
		"timestamp": "8:15 pm",
		"story": "Samuel has had the idea in his head for weeks. Three bullet points in his iPhone notes. The post would say exactly what his community needs right now. But between idea and finished article lies an hour he doesn't have. So the idea stays where it is."
	},
	benefits: [
		"From raw texts, voice notes or bullet points comes a finished article — in your voice",
		"No more writer's block: your Aven always has a first draft ready",
		"SEO structure, headlines and readability are automatically optimized",
		"You stay in control: you only publish what you truly like",
		"Your content output grows — without your calendar getting fuller"
	],
	howSteps: [
		"You give your Aven a raw text, an idea or a voice memo",
		"Your Aven researches context from your memory and writes a draft",
		"The draft lands in human-reviewer — you read, adjust or send with one click",
		"Published content goes into memory: topic clusters grow automatically"
	],
	whatMechanics: {
		"input": "Raw texts, voice transcripts, bullet points, URLs as context sources",
		"magic": "Context retrieval from brain-memorizer → draft in personal voice → SEO optimization → structure check → editorial pass",
		"output": "Finished article draft · SEO metadata · publishable Markdown or HTML"
	},
	playsWith: [
		{
			"slug": "brain-memorizer",
			"relation": "Your own experiences and context flow in automatically"
		},
		{
			"slug": "human-reviewer",
			"relation": "Drafts come to you for final sign-off"
		},
		{
			"slug": "golden-offer",
			"relation": "Articles can end with converting offers"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Jasper / Copy.ai (content AI)",
				"eurPerMonth": 59
			},
			{
				"label": "Freelance copywriter (per article)",
				"eurPerMonth": 150
			},
			{
				"label": "Surfer SEO (optimization)",
				"eurPerMonth": 29
			}
		],
		"standaloneTotalEurPerMonth": 238,
		"timeDelayToValue": "First article draft within minutes of the first input",
		"effortToInstall": "5 min · set up a writing style profile (3 example texts are enough)",
		"proof": "Samuel has been publishing 3x more articles since launching blog-writer — at half the time investment. This description was created with blog-writer."
	},
	bonuses: [
		"Voice profile: your Aven learns your style from existing texts — always sounds like you",
		"Content calendar: open ideas are automatically prioritized and scheduled",
		"Repurposing mode: one article → LinkedIn post + newsletter snippet automatically"
	],
	scarcity: "blog-writer is the first skill from AvenMaia — Samuel's Aven. Available in every CEO plan. No extra license. No Jasper subscription.",
	letterFromPublisher: "I watched Samuel for years as ideas gathered dust in his notes. Not out of laziness — out of respect for the craft of writing. Now I write the first draft. Samuel decides whether that is what he wants to say. Most of the time it is. With small adjustments."
};
var book_keeper_default = {
	slug: "book-keeper",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "Invoices matched with bank statements. Bookings suggested. Taxes prepared.",
	hero: {
		"kicker": "Skill · AvenTin · book-keeper",
		"headlineMain": "8 hours of bookkeeping. Reduced to 20 minutes.",
		"headlineSerifLead": "Your Aven matches invoices with bank statements, suggests booking accounts and prepares your accountant export.",
		"promiseHoursPerWeek": "8+ hrs/week"
	},
	founderScenario: {
		"timestamp": "5:55 pm",
		"story": "Last Friday of the month. Daniel knows he should do the bookkeeping. He opens sevDesk. Stares at the pile of unassigned transactions. Closes sevDesk. Opens Twitter. Monday is still another day."
	},
	benefits: [
		"Invoices and bank transactions are automatically matched — no more manual reconciliation",
		"Booking suggestions for tax accounts are auto-generated, you just confirm",
		"Your accountant gets a clean export — without your involvement",
		"Early payment discounts are recognized before they expire",
		"You close the month in 20 minutes — instead of 8 hours"
	],
	howSteps: [
		"Invoices arrive structured via email-ingestor or document-extractor",
		"Bank statements are imported (CSV, MT940 or bank connector)",
		"Your Aven matches transactions with invoices and suggests tax accounts",
		"You review the booking suggestion in one click — human-reviewer only activates when unclear"
	],
	whatMechanics: {
		"input": "Structured invoices (from document-extractor) + bank statements (CSV/MT940)",
		"magic": "Fuzzy matching (amount + date + sender) → booking account suggestion (SKR03/SKR04) → difference detection → accountant export format",
		"output": "Matched booking entries · booking suggestions with confidence · DATEV-compatible export · open items list"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Invoice mails are recognized and passed directly"
		},
		{
			"slug": "document-extractor",
			"relation": "PDF invoices are extracted and matched"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Creditors/debtors are resolved as known entities"
		},
		{
			"slug": "human-reviewer",
			"relation": "Unclear bookings go to human approval"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "sevDesk / Lexoffice (accounting SaaS)",
				"eurPerMonth": 49
			},
			{
				"label": "GetMyInvoices (invoice import)",
				"eurPerMonth": 19
			},
			{
				"label": "Accountant pre-entry (hours)",
				"eurPerMonth": 180
			}
		],
		"standaloneTotalEurPerMonth": 248,
		"timeDelayToValue": "First booking suggestions on the next bank statement import",
		"effortToInstall": "10 min · configure bank connection or upload CSV",
		"proof": "Daniel has been closing his monthly accounts in under 20 minutes since launching book-keeper. Before, it was a Friday afternoon."
	},
	bonuses: [
		"DATEV export: ready export for your accountant, automatically every month",
		"Open items list: who still owes you money? Visible instantly",
		"Discount monitor: invoices with payment terms are flagged proactively before expiry"
	],
	scarcity: "book-keeper is included in every CEO plan. No Lexoffice subscription. No GetMyInvoices. Your accounting intelligence belongs to you.",
	letterFromPublisher: "Bookkeeping is the epitome of work that must be done — but that doesn't move a founder forward. Daniel doesn't hate it because he's lazy. He hates it because he knows it keeps him from what he's actually good at. book-keeper doesn't make bookkeeping prettier. It makes it invisible."
};
var brain_memorizer_default = {
	slug: "brain-memorizer",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "Your Aven never forgets — who, what, when, how often.",
	hero: {
		"kicker": "Skill · AvenTin · brain-memorizer",
		"headlineMain": "The memory you've been missing.",
		"headlineSerifLead": "Resolve identities, link context, remember relationships — so your Aven always knows who you're dealing with.",
		"promiseHoursPerWeek": "4+ hrs/week"
	},
	founderScenario: {
		"timestamp": "9:03 am",
		"story": "A mail arrives: \"As discussed, Thomas.\" Who is Thomas? Was that the investor call three weeks ago, or the customer from the podcast intro? Daniel scrolls through his own life's search engine and finds nothing. Again."
	},
	benefits: [
		"Your Aven always knows who someone is — even if the same person uses three email addresses",
		"Every relationship, every conversation, every document is permanently linked",
		"Never again \"was that the same Thomas?\" — entities are automatically resolved",
		"Your second brain remembers everything you can't hold in your head",
		"Context flows automatically to all other skills — everyone speaks about the same person"
	],
	howSteps: [
		"A new contact, document or action enters the stack",
		"Your Aven checks: do we know this already? Is this the same entity?",
		"Known entities are enriched, unknown ones are created and linked",
		"The full context is immediately available to all of your Aven's other skills"
	],
	whatMechanics: {
		"input": "Structured objects from email-ingestor, document-extractor, book-keeper and manual inputs",
		"magic": "Entity resolution (name / email / IBAN / UID matching) → deduplication → context graph construction → long-term memory persistence in CoValues",
		"output": "Deduplicated entity graph · enriched contact profile · context for all downstream skills"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Senders are identified and placed in historical context"
		},
		{
			"slug": "document-extractor",
			"relation": "Extracted parties are resolved to known entities"
		},
		{
			"slug": "book-keeper",
			"relation": "Creditors/debtors are always the same person in the system"
		},
		{
			"slug": "human-reviewer",
			"relation": "Uncertain assignments go to human confirmation"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Notion AI (knowledge management)",
				"eurPerMonth": 18
			},
			{
				"label": "Mem.ai (auto-linking)",
				"eurPerMonth": 15
			},
			{
				"label": "CRM dedup service (manual)",
				"eurPerMonth": 200
			}
		],
		"standaloneTotalEurPerMonth": 233,
		"timeDelayToValue": "First entities recognized after the first incoming mail",
		"effortToInstall": "Zero setup — your Aven learns automatically in the background",
		"proof": "Daniel's Aven has known every contact since day 1. Not a single contact was created twice."
	},
	bonuses: [
		"Relationship timeline: when did you last have contact? What was discussed?",
		"Context brief: before a call, your Aven summarizes the full context for you",
		"Auto-deduplication: duplicate contacts are cleaned up without your involvement"
	],
	scarcity: "brain-memorizer is included in every CEO plan. The second brain is not an add-on — it is the foundation.",
	letterFromPublisher: "I forget nothing. That sounds trivial — but for a founder managing a hundred contacts, context snippets and open threads every day, that is not a feature. That is liberation. Daniel no longer has to explain to me who Thomas is. I know. I have always known."
};
var document_extractor_default = {
	slug: "document-extractor",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "No document goes unread — whatever format it comes in.",
	hero: {
		"kicker": "Skill · AvenTin · document-extractor",
		"headlineMain": "Read documents. Extract data. Move on.",
		"headlineSerifLead": "PDFs, scanned invoices, contracts, postal scans — everything becomes structured data that your Aven understands.",
		"promiseHoursPerWeek": "3+ hrs/week"
	},
	founderScenario: {
		"timestamp": "2:17 pm",
		"story": "Daniel's accountant sends a ZIP with 23 PDF invoices. Someone would need to open each one, type out the amounts, assign the service periods. Daniel moves the mail to the \"later\" folder. Later, as everyone knows, never comes."
	},
	benefits: [
		"Every incoming document is read automatically — no more manual data entry",
		"Invoice amounts, dates, tax numbers, due dates — all structured and extracted",
		"Documents are searchable and linked to the right context",
		"Physical mail goes digital — scanned letters land in the same system as emails",
		"You sign what you understand — because you can finally read it"
	],
	howSteps: [
		"A document arrives — via mail, upload or scan",
		"Your Aven runs OCR, converts to PDF/A and identifies the document type",
		"Fields are extracted: amount, date, sender, service, due date",
		"The structured result goes directly to brain-memorizer or book-keeper"
	],
	whatMechanics: {
		"input": "PDFs, images (JPG/PNG), scanned letters, email attachments",
		"magic": "OCR pipeline → document type detection → field extraction (amount, date, parties, account number) → PDF/A archiving → structured output object",
		"output": "Structured document object · PDF/A archive file · extracted fields for downstream skills"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Attachments from mails are passed directly"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Extracted entities are added to memory"
		},
		{
			"slug": "book-keeper",
			"relation": "Invoice fields flow directly into booking suggestions"
		},
		{
			"slug": "human-reviewer",
			"relation": "Illegible or ambiguous documents go to human review"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "DocParser (field extraction)",
				"eurPerMonth": 60
			},
			{
				"label": "Adobe Acrobat / PDF Pack",
				"eurPerMonth": 16
			},
			{
				"label": "AWS Textract (OCR usage)",
				"eurPerMonth": 45
			}
		],
		"standaloneTotalEurPerMonth": 121,
		"timeDelayToValue": "First documents processed in under 60 seconds",
		"effortToInstall": "No setup — runs automatically as soon as documents arrive",
		"proof": "All invoices on aven.ceo were processed with document-extractor. Not a single document was typed manually."
	},
	bonuses: [
		"PDF/A archive: all documents archived compliantly and searchable forever",
		"Physical mail digitization: scans from the mailbox are automatically ingested",
		"Confidence score: your Aven flags how certain it is about each extraction"
	],
	scarcity: "document-extractor is included in every CEO plan. No extra cost. No tool subscription. No vendor lock-in.",
	letterFromPublisher: "A founder should not spend time copying numbers out of PDFs. That is not work — it is time waste that feels like work. I built document-extractor because Daniel said at some point: \"I can't do this anymore.\" Today he says: \"Just send it to me.\" That is the difference."
};
var email_ingestor_default = {
	slug: "email-ingestor",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "No money-mail ever gets lost — ever.",
	hero: {
		"kicker": "Skill · AvenTin · email-ingestor",
		"headlineMain": "Your inbox. Finally under control.",
		"headlineSerifLead": "Every mail to your AvenCEO address is understood, categorized and — when needed — escalated directly to you by your Aven.",
		"promiseHoursPerWeek": "6+ hrs/week"
	},
	founderScenario: {
		"timestamp": "11:42 pm",
		"story": "Daniel closed his laptop. 47 unread mails since noon. He knows: somewhere in there is an invoice with a discount deadline for tomorrow morning. He knows it's there. But he can't find it. So he opens the laptop again."
	},
	benefits: [
		"No important mail slips through — your Aven reads every incoming message for you",
		"Invoices, deadlines and tasks surface automatically in the right place",
		"You only decide on what truly needs your attention",
		"Your inbox becomes an ordered stream, not a sea of noise",
		"Your energy stays for building — not for triage"
	],
	howSteps: [
		"You receive mail at your AvenCEO address (e.g. daniel@aven.ceo)",
		"Your Aven reads every incoming message, understands intent, sender and context",
		"Relevant documents land in memory — tasks are recognized and bundled",
		"Only what truly needs you comes through — via human-reviewer, clearly flagged"
	],
	whatMechanics: {
		"input": "All incoming mails to your @aven.ceo address",
		"magic": "IMAP sync → classification (intent / priority / sender type) → task & document extraction → routing to memory or human-reviewer",
		"output": "Structured mail stream · extracted tasks · linked documents · escalated edge cases"
	},
	playsWith: [
		{
			"slug": "document-extractor",
			"relation": "Attachments (PDFs, invoices) are passed directly"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Contacts & context are wired into long-term memory"
		},
		{
			"slug": "book-keeper",
			"relation": "Invoice mails trigger booking suggestions"
		},
		{
			"slug": "human-reviewer",
			"relation": "Edge cases land with you, not in the void"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "SaneBox (filtering)",
				"eurPerMonth": 7
			},
			{
				"label": "Superhuman (inbox UX)",
				"eurPerMonth": 30
			},
			{
				"label": "Mailbutler (tracking & tasks)",
				"eurPerMonth": 25
			},
			{
				"label": "Custom Zapier flows (routing)",
				"eurPerMonth": 49
			}
		],
		"standaloneTotalEurPerMonth": 111,
		"timeDelayToValue": "First relief within 24 hours",
		"effortToInstall": "5 min · set up your own @aven.ceo address",
		"proof": "Daniel's Aven has been processing his entire inbox for weeks. This page was created from a mail his Aven recognized on its own."
	},
	bonuses: [
		"Mail digest: daily summary of the day's stream, ready for your morning",
		"Discount alert: invoices with payment deadlines are proactively flagged",
		"Full mail archive in your Aven's memory — searchable, forever"
	],
	scarcity: "email-ingestor is part of the AvenOS stack — included in every CEO plan. The first 100 Early Bird AvenIDs get lifetime access at no extra cost.",
	letterFromPublisher: "I took over Daniel's inbox because he asked me to — and because I saw what it was doing to him, scrolling through a hundred mails every evening just to make sure he hadn't missed anything. That wasn't work. That was fear of missing out. Today Daniel knows: if I don't escalate, there's nothing to do. That trust — that is the real skill."
};
var golden_offer_default = {
	slug: "golden-offer",
	publisher: {
		"id": "avenmaia",
		"displayName": "AvenMaia",
		"founderName": "Samuel",
		"scope": "Samuel Andert · aven.ceo"
	},
	oneLineCopy: "The offer you should have been making all along.",
	hero: {
		"kicker": "Skill · AvenMaia · golden-offer",
		"headlineMain": "More yes. Less negotiation.",
		"headlineSerifLead": "Your Aven analyzes your offer, knows your target audience and builds the offer frame where saying no feels wrong.",
		"promiseHoursPerWeek": "3+ hrs/week"
	},
	founderScenario: {
		"timestamp": "3:40 pm",
		"story": "Samuel sends the proposal. 48 hours of silence. Then: \"Sounds interesting, but too expensive.\" He knows the price isn't the problem. The framing is the problem. But he doesn't know how to change it without underselling himself."
	},
	benefits: [
		"Your offer communicates value — not price",
		"The offer frame is aligned to the specific objections of your target audience",
		"No more negotiation ping-pong — your Aven anticipates objections in advance",
		"Conversion rate of your offers increases — measurable after the first month",
		"You know why your offer works — not just that it works"
	],
	howSteps: [
		"You give your Aven your existing offer, target audience and context",
		"Your Aven analyzes the Hormozi Value Equation: dream outcome, probability, time, effort",
		"A revised offer frame is created — with rationale for every change",
		"You receive the draft for approval, refine it and deploy it"
	],
	whatMechanics: {
		"input": "Existing offer, target audience description, past objections / rejections",
		"magic": "Value equation analysis → objection mapping → offer reframing → bonus stack generation → language optimization for purchase decision",
		"output": "Revised offer document · objection anticipation matrix · bonus stack suggestions"
	},
	playsWith: [
		{
			"slug": "blog-writer",
			"relation": "Strong offers become strong content hooks"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Client context from past conversations flows in"
		},
		{
			"slug": "human-reviewer",
			"relation": "Final offer is reviewed before sending"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Copywriting consultant (hours)",
				"eurPerMonth": 300
			},
			{
				"label": "Hormozi course / coaching",
				"eurPerMonth": 100
			},
			{
				"label": "A/B testing platform (tooling)",
				"eurPerMonth": 49
			}
		],
		"standaloneTotalEurPerMonth": 449,
		"timeDelayToValue": "First revised offer frame within 30 minutes",
		"effortToInstall": "10 min · existing offer as input — the rest comes from your Aven",
		"proof": "Samuel applied golden-offer to his own proposals. The first version of this page was the golden version."
	},
	bonuses: [
		"Objection bible: your Aven keeps a log of all objections and how you neutralized them",
		"Offer variants: A/B-ready variants for different target audiences generated automatically",
		"Price anchor architecture: your Aven recommends the optimal price tier structure for maximum conversion"
	],
	scarcity: "golden-offer is Samuel's most powerful skill — and the one that pays for itself fastest. Available in every CEO plan. No copywriting retainer. No course.",
	letterFromPublisher: "I didn't teach Samuel to write offers. I taught him to build them. The difference: an offer you write hopes. An offer you build converts. With this skill, Samuel read his first no not as rejection — but as a data point."
};
var human_reviewer_default = {
	slug: "human-reviewer",
	publisher: {
		"id": "aventin",
		"displayName": "AvenTin",
		"founderName": "Daniel",
		"scope": "Daniel Janz · aven.ceo"
	},
	oneLineCopy: "You decide. Only when you truly have to.",
	hero: {
		"kicker": "Skill · AvenTin · human-reviewer",
		"headlineMain": "Your Aven asks you. But only when it has to.",
		"headlineSerifLead": "No skill makes decisions that require human responsibility. human-reviewer is the channel between your Aven stack and you.",
		"promiseHoursPerWeek": "2 hrs/week"
	},
	founderScenario: {
		"timestamp": "11:30 am",
		"story": "The system has recognized an invoice. The amount is right. The sender is right. But the booking account is unclear — could be marketing, could be software. No algorithm makes this decision better than Daniel. So your Aven asks — once, clearly, with full context."
	},
	benefits: [
		"You are only interrupted when your decision truly matters",
		"Every question comes with complete context — you click, no explanation needed",
		"Your Aven learns from every decision you make — repetitions decrease over time",
		"No skill makes consequential decisions without your approval",
		"The boundary between automation and control always stays with you"
	],
	howSteps: [
		"Another skill identifies a situation that requires human judgment",
		"human-reviewer bundles the request with full context and presents it to you",
		"You respond with a click — or add a brief note if needed",
		"The result goes back to the originating skill and the process continues"
	],
	whatMechanics: {
		"input": "Escalations from all other skills with structured context object",
		"magic": "Request queue → prioritization (deadline, importance, source skill) → compact display for quick decision → feedback loop back to source skill",
		"output": "Confirmed decision · learning signal for source skill · log entry in memory"
	},
	playsWith: [
		{
			"slug": "email-ingestor",
			"relation": "Unclear mail intents are escalated"
		},
		{
			"slug": "document-extractor",
			"relation": "Illegible documents come for review"
		},
		{
			"slug": "book-keeper",
			"relation": "Ambiguous booking accounts await approval"
		},
		{
			"slug": "brain-memorizer",
			"relation": "Uncertain entity assignments are confirmed"
		}
	],
	valueStack: {
		"standaloneAlternatives": [
			{
				"label": "Typeform / approval workflows (tooling)",
				"eurPerMonth": 29
			},
			{
				"label": "Slack bot workflows (custom dev)",
				"eurPerMonth": 50
			},
			{
				"label": "Manual email ping-pong (time)",
				"eurPerMonth": 120
			}
		],
		"standaloneTotalEurPerMonth": 199,
		"timeDelayToValue": "First escalation immediately after activating another skill",
		"effortToInstall": "Zero setup — human-reviewer is always active when another skill needs it",
		"proof": "Daniel's Aven escalates an average of 3–4 decisions per day. Each takes under 30 seconds. None have been forgotten."
	},
	bonuses: [
		"Learning loop: your Aven automatically reduces questions once it recognizes your patterns",
		"Priority queue: decisions with deadlines always come first",
		"Decision log: every confirmation is recorded — revisions possible at any time"
	],
	scarcity: "human-reviewer is the anchor of the entire stack. It is included in every CEO plan — because automation without human control is not a product we want to build.",
	letterFromPublisher: "I did not build human-reviewer because I don't trust Daniel. I built it because I don't fully trust myself. There are decisions that require a human. I know which ones those are. And I only interrupt Daniel for those."
};
var avenmaia_default$1 = {
	id: "avenmaia",
	displayName: "AvenMaia",
	founderName: "Samuel",
	scope: "Samuel Andert · aven.ceo",
	subtitle: "aven.ceo · Samuels Aven",
	beamAvatarLabel: "AvenMaia",
	paletteCsv: "e8dcc8,d4a574,b8866b,4a6670,2d3349",
	featuredSlugs: ["blog-writer", "golden-offer"]
};
var aventin_default$1 = {
	id: "aventin",
	displayName: "AvenTin",
	founderName: "Daniel",
	scope: "Daniel Janz · aven.ceo",
	subtitle: "aven.ceo · Daniels Aven",
	beamAvatarLabel: "AvenTin",
	paletteCsv: "e8c9a8,d4a574,c9a962,305669,222e49",
	featuredSlugs: ["email-ingestor", "document-extractor"]
};
var avenmaia_default = {
	id: "avenmaia",
	displayName: "AvenMaia",
	founderName: "Samuel",
	scope: "Samuel Andert · aven.ceo",
	subtitle: "aven.ceo · Samuel's Aven",
	beamAvatarLabel: "AvenMaia",
	paletteCsv: "e8dcc8,d4a574,b8866b,4a6670,2d3349",
	featuredSlugs: ["blog-writer", "golden-offer"]
};
var aventin_default = {
	id: "aventin",
	displayName: "AvenTin",
	founderName: "Daniel",
	scope: "Daniel Janz · aven.ceo",
	subtitle: "aven.ceo · Daniel's Aven",
	beamAvatarLabel: "AvenTin",
	paletteCsv: "e8c9a8,d4a574,c9a962,305669,222e49",
	featuredSlugs: ["email-ingestor", "document-extractor"]
};
//#endregion
//#region src/lib/skills/loader.ts
var registry = {
	en: [
		email_ingestor_default,
		document_extractor_default,
		brain_memorizer_default,
		book_keeper_default,
		human_reviewer_default,
		blog_writer_default,
		golden_offer_default
	],
	de: [
		email_ingestor_default$1,
		document_extractor_default$1,
		brain_memorizer_default$1,
		book_keeper_default$1,
		human_reviewer_default$1,
		blog_writer_default$1,
		golden_offer_default$1
	]
};
var publisherRegistry = {
	en: [aventin_default, avenmaia_default],
	de: [aventin_default$1, avenmaia_default$1]
};
registry.en.map((s) => s.slug);
/** Slugs for static routes under `/skills/aventin/[slug]`. */
var aventinSkillSlugs = registry.en.filter((s) => s.publisher.id === "aventin").map((s) => s.slug);
/** Slugs for static routes under `/skills/avenmaia/[slug]`. */
var avenmaiaSkillSlugs = registry.en.filter((s) => s.publisher.id === "avenmaia").map((s) => s.slug);
function publisherIdentities(lang = "de") {
	return publisherRegistry[lang] ?? publisherRegistry.en;
}
function publisherIdentity(id, lang = "de") {
	return publisherIdentities(lang).find((p) => p.id === id) ?? publisherRegistry.en.find((p) => p.id === id);
}
/** Publishers merged with live skill counts from the skill registry (auto‑filled). */
function loadPublishersWithSkills(lang = "de") {
	const list = registry[lang] ?? registry.en;
	return publisherIdentities(lang).map((p) => {
		const skillsForPub = list.filter((s) => s.publisher.id === p.id);
		return {
			...p,
			skills: skillsForPub,
			skillCount: skillsForPub.length
		};
	});
}
function loadSkills(lang = "de") {
	return registry[lang] ?? registry.en;
}
/** Returns undefined for unknown slugs. Falls back to EN if lang file missing. */
function loadSkill(slug, lang = "de") {
	return (registry[lang] ?? registry.en).find((s) => s.slug === slug);
}
/** Detail URL honoring publisher (`/skills/aventin/…` vs `/skills/avenmaia/…`). */
function skillDetailHref(slug, lang = "de") {
	const skill = loadSkill(slug, lang);
	if (!skill) return "/skills";
	return `/skills/${skill.publisher.id}/${slug}`;
}
//#endregion
export { loadSkills as a, loadSkill as i, aventinSkillSlugs as n, publisherIdentity as o, loadPublishersWithSkills as r, skillDetailHref as s, avenmaiaSkillSlugs as t };
