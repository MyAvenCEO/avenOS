import type { StyleDef } from '../../engine/types.js'
import { withBrand } from '../../brand-style.js'

// Colours, radii, fonts and dark-blue ink come from the shared brand layer.
// Only invoice-specific surface aliases / dividers are overridden here.
const tokens: StyleDef['tokens'] = {
	'bg-b': 'color-mix(in srgb, var(--bg-a) 82%, rgb(255 255 255))',
	'foreground-10': 'color-mix(in srgb, var(--text) 10%, transparent)',
	'surface-fill': 'var(--tech-fill)',
	'surface-2': 'var(--tech-fill-inner)',
	'surface-raised': 'var(--tech-fill-inner)',
	'banner-divider': 'color-mix(in srgb, var(--text) 12%, transparent)',
	'row-divider': 'color-mix(in srgb, var(--border) 55%, transparent)',
}

const components: StyleDef['components'] = {
	invoiceUiContainer: {
		padding: 'var(--pad-card)',
		borderRadius: 'var(--radius-card)',
		background: 'var(--tech-fill)',
		border: 'none',
		maxWidth: 'var(--max-w)',
		margin: '0 auto',
	},
	invoiceGrid: {
		display: 'grid',
		gap: '16px',
		gridTemplateColumns: '1fr 1fr',
		marginBottom: '16px',
	},
	invoiceCard: {
		background: 'var(--tech-fill)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		padding: '18px 20px',
		' h4': {
			margin: '0 0 8px 0',
			fontSize: 'var(--fs-eyebrow)',
			fontWeight: '600',
			color: 'var(--muted)',
			textTransform: 'uppercase',
			letterSpacing: '0.12em',
			opacity: '0.55',
		},
		' .big': {
			fontSize: 'var(--fs-title)',
			fontWeight: '600',
			color: 'var(--text)',
			marginBottom: '4px',
		},
		' .line': {
			fontSize: 'var(--fs-body)',
			color: 'var(--text)',
			marginTop: '2px',
			whiteSpace: 'pre-wrap',
			wordBreak: 'break-word',
		},
		' .muted': {
			color: 'var(--muted)',
			fontSize: 'var(--fs-meta)',
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
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '500',
		margin: '0',
		lineHeight: '1.25',
		textTransform: 'none',
		letterSpacing: 'normal',
	},
	invPartyRepName: {
		fontSize: 'var(--fs-body)',
		color: 'var(--text)',
		lineHeight: '1.35',
		margin: '0',
	},
	partyOrgIdLine: {
		marginTop: '8px',
		marginBottom: '0',
		fontSize: 'var(--fs-meta)',
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
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		padding: '14px 20px',
		marginBottom: '16px',
		fontSize: 'var(--fs-body)',
	},
	invBannerHeroRow: {
		display: 'grid',
		gridTemplateColumns: '1fr auto',
		gap: '12px 28px',
		alignItems: 'end',
		width: '100%',
	},
	invBannerValue: {
		fontSize: 'var(--fs-hero)',
		fontWeight: '600',
		lineHeight: '1.2',
		color: 'var(--text)',
		letterSpacing: '-0.02em',
	},
	invBannerSublabel: {
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
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
		fontSize: 'var(--fs-section)',
		fontWeight: '600',
		lineHeight: '1.3',
		color: 'var(--text)',
	},
	invBannerCompactSublabel: {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		marginTop: '3px',
	},
	invoiceItemsWrap: {
		background: 'var(--tech-fill)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		overflow: 'auto',
		marginBottom: '16px',
	},
	invoiceItemsCapStatement: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
		' .invoice-cap-block--title': {
			fontSize: 'var(--fs-title)',
			fontWeight: '600',
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
		fontSize: 'var(--fs-meta)',
		lineHeight: '1.4',
	},
	invoiceCapK: {
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		letterSpacing: '0.06em',
		textTransform: 'uppercase',
		color: 'var(--muted)',
	},
	invoiceCapV: {
		fontWeight: '500',
		color: 'var(--text)',
	},
	invoiceItems: {
		width: '100%',
		borderCollapse: 'collapse',
		fontSize: 'var(--fs-body)',
		' thead th': {
			textAlign: 'left',
			background: 'var(--surface-2)',
			padding: '10px 14px',
			borderBottom: '1px solid var(--border)',
			fontWeight: '600',
			fontSize: 'var(--fs-eyebrow)',
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
			fontSize: 'var(--fs-eyebrow)',
		},
	},
	invLineItemPrimary: {
		fontWeight: '500',
		color: 'var(--text)',
		lineHeight: '1.35',
	},
	invLineItemSecondary: {
		fontSize: 'var(--fs-meta)',
		color: 'var(--muted)',
		lineHeight: '1.4',
		marginTop: '3px',
	},
	invoiceFinancials: {
		marginLeft: 'auto',
		maxWidth: '380px',
		minWidth: '260px',
		background: 'var(--tech-fill)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		fontSize: 'var(--fs-title)',
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
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		letterSpacing: '0.06em',
		textTransform: 'uppercase',
		color: 'var(--muted)',
	},
	invoiceRootOutstandingValue: {
		fontSize: 'var(--fs-lead)',
		fontWeight: '600',
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--text)',
	},
	invoiceBundleLabel: {
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
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
		fontSize: 'var(--fs-lead)',
		fontWeight: '600',
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
		fontSize: 'var(--fs-section)',
		fontWeight: '600',
	},
	'.inv-banner-mid--compact .inv-banner-mid-dates .inv-banner-sublabel': {
		fontSize: 'var(--fs-micro)',
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
			fontSize: 'var(--fs-lead)',
			lineHeight: '1.35',
			color: 'var(--muted)',
		},
	'.invoice-totals .inv-totals-line--subtotal .num, .invoice-totals .inv-totals-line--tax .num, .invoice-totals .inv-totals-line--tax-total-sum .num':
		{
			fontSize: 'var(--fs-lead)',
			fontWeight: '600',
			color: 'var(--text)',
		},
	'.invoice-totals .inv-totals-line--tax .num, .invoice-totals .inv-totals-line--tax-total-sum .num': {
		fontWeight: '500',
	},
	'.invoice-totals .inv-totals-line--tax-total-sum': {
		borderTop: '1px solid var(--border)',
		marginTop: '4px',
		paddingTop: '8px',
	},
	'.invoice-totals .inv-totals-line--tax-rate': {
		fontSize: 'var(--fs-section)',
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
		fontSize: 'var(--fs-meta)',
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
		fontSize: 'var(--fs-body)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.04em',
		color: 'var(--muted)',
	},
	'.invoice-totals .inv-totals-line--invoice-total .num': {
		fontSize: 'var(--fs-amount)',
		fontWeight: '600',
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

export const invoiceStyle: StyleDef = withBrand({ tokens, components, selectors })
