import type { StyleDef } from '../../types.js'

const tokens: StyleDef['tokens'] = {
	'bg-a': '#FBFAF6',
	'bg-b': 'color-mix(in srgb, var(--bg-a) 82%, rgb(255 255 255))',
	'tech-fill': 'rgba(255, 255, 255, 0.1)',
	'tech-fill-inner': 'rgba(255, 255, 255, 0.15)',
	'foreground-10': 'color-mix(in srgb, var(--text) 10%, transparent)',
	'hitl-dash': 'color-mix(in srgb, var(--text) 20%, transparent)',
	'surface-fill': 'var(--tech-fill)',
	'surface-2': 'var(--tech-fill-inner)',
	'surface-raised': 'var(--tech-fill-inner)',
	border: 'rgba(0, 0, 0, 0.1)',
	'border-strong': 'rgba(0, 0, 0, 0.14)',
	'border-soft': 'color-mix(in srgb, var(--border) 35%, transparent)',
	muted: 'rgba(26, 26, 26, 0.45)',
	text: '#1a1a1a',
	'brand-accent': '#e6b34d',
	'banner-divider': 'color-mix(in srgb, var(--text) 12%, transparent)',
	'row-divider': 'color-mix(in srgb, var(--border) 55%, transparent)',
	'radius-2xl': '2rem',
	'radius-md': '1rem',
	'font-sans': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

const components: StyleDef['components'] = {
	invoiceUiContainer: {
		padding: '1.25rem 1.5rem',
		borderRadius: 'var(--radius-2xl)',
		background: 'var(--tech-fill)',
		border: 'none',
	},
	invoiceGrid: {
		display: 'grid',
		gap: '16px',
		gridTemplateColumns: '1fr 1fr',
		marginBottom: '16px',
	},
	invoiceCard: {
		background: 'var(--tech-fill)',
		border: '1px dashed var(--hitl-dash)',
		borderRadius: 'var(--radius-2xl)',
		padding: '18px 20px',
		' h4': {
			margin: '0 0 8px 0',
			fontSize: '10px',
			fontWeight: '700',
			color: 'var(--muted)',
			textTransform: 'uppercase',
			letterSpacing: '0.12em',
			opacity: '0.55',
		},
		' .big': {
			fontSize: '15px',
			fontWeight: '700',
			color: 'var(--text)',
			marginBottom: '4px',
		},
		' .line': {
			fontSize: '13px',
			color: 'var(--text)',
			marginTop: '2px',
			whiteSpace: 'pre-wrap',
			wordBreak: 'break-word',
		},
		' .muted': {
			color: 'var(--muted)',
			fontSize: '12px',
			marginTop: '2px',
		},
		' .party-org-id-line + .party-org-id-line': {
			marginTop: '4px',
		},
	},
	invPartyNameText: {
		textDecoration: 'underline',
		textDecorationColor: 'color-mix(in srgb, var(--text) 22%, transparent)',
		textUnderlineOffset: '2px',
	},
	invPartyAddressBlock: {
		marginTop: '6px',
		' .line.inv-party-addr-line': {
			display: 'block',
			marginTop: '4px',
		},
		' .line.inv-party-addr-line:first-child': {
			marginTop: '0',
		},
	},
	partyRepresentativeLine: {
		marginTop: '4px',
		display: 'flex',
		flexDirection: 'column',
		gap: '0',
		lineHeight: '1.35',
	},
	partyRepresentativeSublabel: {
		fontSize: '11px',
		fontWeight: '600',
		margin: '0',
		lineHeight: '1.25',
		textTransform: 'none',
		letterSpacing: 'normal',
	},
	invPartyRepName: {
		fontSize: '13px',
		color: 'var(--text)',
		lineHeight: '1.35',
		margin: '0',
	},
	partyOrgIdLine: {
		marginTop: '8px',
		marginBottom: '0',
		fontSize: '12px',
		lineHeight: '1.4',
		color: 'var(--muted)',
		fontWeight: '400',
		' .party-org-id-label': {
			fontWeight: '500',
			color: 'var(--muted)',
		},
		' .party-org-id-value': {
			fontWeight: '500',
			color: 'var(--text)',
			fontSize: 'inherit',
		},
	},
	invoiceDocBanner: {
		background: 'var(--tech-fill-inner)',
		border: '1px dashed var(--hitl-dash)',
		borderRadius: 'var(--radius-2xl)',
		padding: '14px 20px',
		marginBottom: '16px',
		fontSize: '13px',
	},
	invBannerHeroRow: {
		display: 'grid',
		gridTemplateColumns: '1fr auto',
		gap: '12px 28px',
		alignItems: 'end',
		width: '100%',
	},
	invBannerValue: {
		fontSize: '1.35rem',
		fontWeight: '800',
		lineHeight: '1.2',
		color: 'var(--text)',
		letterSpacing: '-0.02em',
	},
	invBannerSublabel: {
		fontSize: '11px',
		fontWeight: '700',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		marginTop: '6px',
	},
	invBannerHeroRight: {
		textAlign: 'right',
		minWidth: '0',
	},
	invBannerFieldsRow: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
		gap: '12px 20px',
		marginTop: '12px',
		paddingTop: '10px',
		borderTop: '1px solid var(--banner-divider)',
		alignItems: 'start',
	},
	invBannerField: {
		minWidth: '0',
	},
	invBannerMid: {
		display: 'grid',
		gridTemplateColumns: 'minmax(0, 1fr) auto',
		alignItems: 'end',
		gap: '12px 20px',
		marginTop: '12px',
		paddingTop: '10px',
		borderTop: '1px solid var(--banner-divider)',
	},
	invBannerCompactValue: {
		fontSize: '0.88rem',
		fontWeight: '700',
		lineHeight: '1.3',
		color: 'var(--text)',
	},
	invBannerCompactSublabel: {
		fontSize: '9px',
		fontWeight: '700',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		marginTop: '3px',
	},
	invoiceItemsWrap: {
		background: 'var(--tech-fill)',
		border: '1px dashed var(--hitl-dash)',
		borderRadius: 'var(--radius-2xl)',
		overflow: 'auto',
		marginBottom: '16px',
	},
	invoiceItemsCapStatement: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
		' .invoice-cap-block--title': {
			fontSize: '15px',
			fontWeight: '800',
			color: 'var(--text)',
			letterSpacing: '-0.01em',
			lineHeight: '1.35',
			marginBottom: '2px',
		},
	},
	invoiceItemsCapTitleRow: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'baseline',
		justifyContent: 'space-between',
		gap: '8px 20px',
		' .invoice-cap-block--title': {
			marginBottom: '0',
			flex: '1 1 120px',
			minWidth: '0',
		},
	},
	invoiceItemsCapSubline: {
		flex: '0 1 auto',
		maxWidth: '100%',
		textAlign: 'right',
		' .invoice-cap-kv': {
			justifyContent: 'flex-end',
		},
	},
	invoiceCapKv: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'baseline',
		gap: '6px 10px',
		fontSize: '12px',
		lineHeight: '1.4',
	},
	invoiceCapK: {
		fontSize: '10px',
		fontWeight: '700',
		letterSpacing: '0.06em',
		textTransform: 'uppercase',
		color: 'var(--muted)',
	},
	invoiceCapV: {
		fontWeight: '600',
		color: 'var(--text)',
	},
	invoiceItems: {
		width: '100%',
		borderCollapse: 'collapse',
		fontSize: '13px',
		' thead th': {
			textAlign: 'left',
			background: 'var(--surface-2)',
			padding: '10px 14px',
			borderBottom: '1px solid var(--border)',
			fontWeight: '700',
			fontSize: '11px',
			textTransform: 'uppercase',
			letterSpacing: '0.05em',
			color: 'var(--muted)',
		},
		' thead th.num': {
			textAlign: 'right',
			fontFamily: 'ui-monospace, Menlo, monospace',
			fontVariantNumeric: 'tabular-nums',
		},
		' tbody td': {
			padding: '10px 14px',
			borderBottom: '1px solid var(--row-divider)',
			verticalAlign: 'top',
		},
		' tbody tr:last-child td': {
			borderBottom: 'none',
		},
		' tr.inv-line-discount td': {
			color: 'var(--muted)',
			fontStyle: 'italic',
		},
		' td.num': {
			textAlign: 'right',
			fontFamily: 'ui-monospace, Menlo, monospace',
			fontVariantNumeric: 'tabular-nums',
			whiteSpace: 'nowrap',
		},
		' td.idx': {
			color: 'var(--muted)',
			width: '32px',
			fontSize: '11px',
		},
	},
	invLineItemPrimary: {
		fontWeight: '600',
		color: 'var(--text)',
		lineHeight: '1.35',
	},
	invLineItemSecondary: {
		fontSize: '12px',
		color: 'var(--muted)',
		lineHeight: '1.4',
		marginTop: '3px',
	},
	invoiceFinancials: {
		marginLeft: 'auto',
		maxWidth: '380px',
		minWidth: '260px',
		background: 'var(--tech-fill)',
		border: '1px dashed var(--hitl-dash)',
		borderRadius: 'var(--radius-2xl)',
		fontSize: '15px',
		marginTop: '12px',
		overflow: 'hidden',
	},
	invoiceTotalsEmbedded: {
		margin: '0',
		maxWidth: 'none',
		minWidth: '0',
		padding: '0',
		border: 'none',
		background: 'transparent',
		borderRadius: '0',
	},
	invoiceRootOutstandingLabel: {
		fontSize: '10px',
		fontWeight: '800',
		letterSpacing: '0.06em',
		textTransform: 'uppercase',
		color: 'var(--muted)',
	},
	invoiceRootOutstandingValue: {
		fontSize: '1.1rem',
		fontWeight: '800',
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--text)',
	},
	invoiceBundleLabel: {
		fontSize: '10px',
		fontWeight: '700',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.12em',
		opacity: '0.55',
		marginBottom: '12px',
	},
}

const selectors: StyleDef['selectors'] = {
	'*, *::before, *::after': {
		boxSizing: 'border-box',
	},
	':host': {
		fontFamily: 'var(--font-sans)',
		background: 'var(--bg-a)',
		color: 'var(--text)',
		margin: '0',
		minHeight: '100%',
		height: '100%',
	},
	'.invoice-card .inv-party-name-line:has(+ .party-representative-line)': {
		marginBottom: '0',
	},
	'.party-representative-line + .inv-party-address-block': {
		marginTop: '4px',
	},
	'.inv-banner-hero-row.inv-banner-hero-only-right': {
		gridTemplateColumns: '1fr',
		justifyItems: 'end',
	},
	'.inv-banner-value.inv-banner-money': {
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--brand-accent)',
	},
	'.inv-banner-value.inv-banner-field-value': {
		fontSize: '1.05rem',
		fontWeight: '700',
		lineHeight: '1.3',
		color: 'var(--text)',
		wordBreak: 'break-word',
	},
	'.inv-banner-mid--compact .inv-banner-mid-dates': {
		display: 'flex',
		flexWrap: 'wrap',
		justifyContent: 'flex-end',
		alignItems: 'end',
		gap: '8px 16px',
	},
	'.inv-banner-mid--compact .inv-banner-mid-dates--merged': {
		flexWrap: 'nowrap',
		gap: '6px 12px',
		minWidth: '0',
	},
	'.inv-banner-mid--compact .inv-banner-mid-dates--merged .inv-banner-field': {
		flex: '0 1 auto',
		minWidth: '0',
	},
	'.inv-banner-mid--compact .inv-banner-mid-dates .inv-banner-field': {
		textAlign: 'right',
	},
	'.inv-banner-mid--compact .inv-banner-mid-dates .inv-banner-field .inv-banner-field-value': {
		fontSize: '0.88rem',
		fontWeight: '700',
	},
	'.inv-banner-mid--compact .inv-banner-mid-dates .inv-banner-sublabel': {
		fontSize: '9px',
		marginTop: '2px',
	},
	'.invoice-items-wrap--unified .invoice-items-cap': {
		background: 'var(--tech-fill-inner)',
		borderBottom: '1px solid var(--border-soft)',
		padding: '12px 16px 10px',
		borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0',
	},
	'.invoice-items-cap-title-row--subline-only': {
		justifyContent: 'flex-end',
	},
	'.invoice-items-cap-title-row--subline-only .invoice-items-cap-subline': {
		textAlign: 'right',
	},
	'.invoice-items-wrap--unified .invoice-items': {
		borderRadius: '0 0 var(--radius-2xl) var(--radius-2xl)',
	},
	'.invoice-items-wrap--unified .invoice-items thead th': {
		background: 'var(--surface-2)',
	},
	'.invoice-financials__section--totals': {
		padding: '16px 20px 14px',
	},
	'.invoice-financials__section--payments': {
		borderTop: '1px solid var(--border)',
		padding: '14px 20px 16px',
	},
	'.invoice-financials__section--payments .invoice-bundle-label': {
		marginBottom: '6px !important',
	},
	'.invoice-financials__outstanding': {
		borderTop: '1px solid var(--border-soft)',
		padding: '12px 20px 14px',
		background: 'var(--foreground-10)',
	},
	'.invoice-financials__outstanding .invoice-root-outstanding-inner': {
		maxWidth: 'none',
		minWidth: '0',
		width: '100%',
		border: 'none',
		background: 'transparent',
		borderRadius: '0',
		padding: '0',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'flex-end',
		gap: '4px',
	},
	'.invoice-totals .row': {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'baseline',
		gap: '12px 20px',
		padding: '6px 0',
		color: 'var(--muted)',
	},
	'.invoice-totals .row > span:first-child': {
		minWidth: '0',
	},
	'.invoice-totals .inv-totals-line--subtotal, .invoice-totals .inv-totals-line--tax, .invoice-totals .inv-totals-line--tax-total-sum':
		{
			fontSize: '16px',
			lineHeight: '1.35',
			color: 'var(--muted)',
		},
	'.invoice-totals .inv-totals-line--subtotal .num, .invoice-totals .inv-totals-line--tax .num, .invoice-totals .inv-totals-line--tax-total-sum .num':
		{
			fontSize: '17px',
			fontWeight: '700',
			color: 'var(--text)',
		},
	'.invoice-totals .inv-totals-line--tax .num, .invoice-totals .inv-totals-line--tax-total-sum .num': {
		fontWeight: '600',
	},
	'.invoice-totals .inv-totals-line--tax-total-sum': {
		borderTop: '1px solid var(--border)',
		marginTop: '4px',
		paddingTop: '8px',
	},
	'.invoice-totals .inv-totals-line--tax-rate': {
		fontSize: '14px',
		color: 'var(--muted)',
		padding: '2px 0',
	},
	'.invoice-totals .inv-totals-line--tax-rate .inv-totals-line__tax-labcell': {
		display: 'flex',
		flexDirection: 'column',
		gap: '2px',
		minWidth: '0',
	},
	'.invoice-totals .inv-totals-line--tax-rate .inv-totals-line__tax-sub': {
		fontSize: '12px',
		fontWeight: '400',
		lineHeight: '1.2',
		color: 'var(--muted)',
	},
	'.invoice-totals .inv-totals-line--tax-rate .num': {
		fontWeight: '500',
		color: 'var(--muted)',
	},
	'.invoice-totals .inv-totals-line--invoice-total': {
		marginTop: '4px',
		paddingTop: '12px',
		borderTop: '2px solid var(--border-strong)',
		color: 'var(--text)',
	},
	'.invoice-totals .inv-totals-line--invoice-total > span:first-child': {
		fontSize: '13px',
		fontWeight: '800',
		textTransform: 'uppercase',
		letterSpacing: '0.04em',
		color: 'var(--muted)',
	},
	'.invoice-totals .inv-totals-line--invoice-total .num': {
		fontSize: '1.5rem',
		fontWeight: '800',
		letterSpacing: '-0.03em',
		color: 'var(--text)',
		lineHeight: '1.15',
	},
	'.invoice-totals .num': {
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontVariantNumeric: 'tabular-nums',
	},
	'@media (max-width: 760px)': {
		'.invoice-grid': {
			gridTemplateColumns: '1fr',
		},
	},
	'@media (max-width: 560px)': {
		'.inv-banner-hero-row': {
			gridTemplateColumns: '1fr',
		},
		'.inv-banner-hero-row.inv-banner-hero-only-right': {
			justifyItems: 'start',
		},
		'.inv-banner-hero-right': {
			textAlign: 'left !important',
		},
		'.inv-banner-mid--compact': {
			gridTemplateColumns: '1fr',
		},
		'.inv-banner-mid--compact .inv-banner-mid-dates': {
			justifyContent: 'flex-start',
			textAlign: 'left',
		},
		'.inv-banner-mid--compact .inv-banner-mid-dates .inv-banner-field': {
			textAlign: 'left',
		},
	},
	'@media (max-width: 720px)': {
		'.inv-banner-mid--compact .inv-banner-mid-dates--merged': {
			flexWrap: 'wrap',
			justifyContent: 'flex-end',
		},
	},
}

export const invoiceStyle: StyleDef = {
	tokens,
	components,
	selectors,
}
