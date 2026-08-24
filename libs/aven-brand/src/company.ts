/**
 * The company, as facts — ONE place. Every legal document, footer line and
 * settings screen renders THESE values; a changed address or VAT id is a
 * one-line edit here, never a hunt across three apps.
 */
export const COMPANY = {
	legalName: 'avenCEO GmbH',
	street: 'Aventinstr. 8',
	city: '80469 München',
	/** Commercial register entry and the court that keeps it. */
	register: 'HRB 292608',
	registerCourt: 'München',
	/** Managing director — also editorially responsible for the sites. */
	representative: 'Daniel Janz',
	phone: '+49 89 38466851',
	email: 'mail@aven.ceo',
	/** USt-IdNr. gemäß § 27 a UStG. */
	vatId: 'DE368356417',
	/** Wirtschafts-Identifikationsnummer. */
	businessId: 'DE368356417-00001',
	/** Languages the DSA contact point answers in. */
	contactLanguages: { de: 'Deutsch, Englisch', en: 'German, English' }
} as const
