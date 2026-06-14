using Aven.Roles.Accounting.Schemas;

namespace Aven.Roles.Accounting.Extraction;

internal static class AccountingExtractionPrompts
{
    public static string BuildClassificationPrompt() =>
        "Classify the uploaded accounting document as strict JSON matching the supplied schema. The document can be in any language supported by the model; classify by document semantics, not by English or German keywords. Use document_kind invoice_like for invoices, receipts, reminders, bills, credit notes, and payment requests. Use account_statement for bank/payment-account statements, card statements, and posted account transaction lists. Use unsupported when the document is neither.";

    public static string BuildExtractionPrompt(SchemaRef schemaRef) => schemaRef == AccountingSchemaRefs.AccountStatementExtractionV1
        ? StatementPrompt
        : InvoicePrompt;

    // Invoice extraction guidance, adapted from the source invoice doctype's system prompt. The per-field
    // hints live in the schema's `description`s; this prompt covers cross-field rules and document semantics.
    private const string InvoicePrompt =
        """
        Extract strict JSON matching the supplied schema. Preserve field names exactly, use null for unknown nullable fields and [] for empty arrays, and do not add fields outside the schema. Read the document in any language (German invoices are common); classify by meaning, not by English keywords. Follow the per-field `description`s in the schema.

        Parties: fill `vendor` (the issuer/creditor) and `buyer` (the bill-to). Put the legal entity name in `name` only — keep any named contact person in the `contact_name` fields, never merged into `name`. Use the full English country name (e.g. "Germany"), not a 2-letter code.

        Header vs. statements: put identifiers and the ISO-4217 `currency` under `header`; put `totals` and `payments` at the document root; use `statements[].line_items` (or `line_groups`) only for position/line tables. `header.invoice_number` is the primary Rechnungsnummer at root (not under statements). `header.issue_date` is the Rechnungsdatum/Ausstellungsdatum when printed (YYYY-MM-DD) — not a service/billing period. Use `header.due_date` for a stated payment-due date.

        Labeled references: for extra labeled IDs (Abrechnungsnummer, Gläubiger-ID, Ihre Referenz, Einlieferungszeitraum, sheet/ICR ranges) add one `header.reference_entries` row each with normalized `kind`, printed `label`, and `value`. Do not stuff composite billing IDs into `customer_number`.

        Totals & tax: `totals.invoice_total` is the gross document total; `totals.subtotal` the net. Whenever a VAT/MwSt table prints tax by rate, fill `totals.tax_breakdown` with one row per rate carrying numeric `tax_rate_percent` (0–100) and `tax_amount`; set `totals.tax_total` when a single tax sum is printed. Reverse-charge/0% is a valid 0 rate.

        Payments & balance: record every amount received in `payments[]` (itemized rows, or one roll-up row) — no separate scalar. `total_outstanding` is the amount still due: the printed balance due, `totals.invoice_total` if nothing is paid yet, `0` if paid in full, or the remaining balance for partial payments. Amounts are plain numbers in the document's currency (the system normalizes currency/minor-units afterward).

        SEPA/banking: put the creditor's receipt/collection accounts in `vendor.banking_accounts` (IBAN/BIC, Gläubiger-ID, Mandatsreferenz) and the debited debtor account in `buyer.banking_accounts`. Keep `payment_instructions` as verbatim prose when useful, but still fill the structured bank/reference fields.

        Line items: in `statements[].line_items`/`line_groups.rows`, put a position headline in `title` only when indented sub-lines follow, and the sub-lines in `description` — never duplicate the headline across both; use `description` alone (title null) for single-line rows.
        """;

    // Bank/payment-account statement extraction, adapted from the source bank_statement doctype system prompt.
    // Per-field hints live in the schema's `description`s; this prompt covers cross-field rules and completeness.
    private const string StatementPrompt =
        """
        Extract strict JSON matching the supplied schema. Preserve field names exactly, use null for unknown nullable fields and [] for empty arrays, and do not add fields outside the schema. Read the document in any language (German Kontoauszug is common). This tool is for bank/payment-account statements, not supplier invoices. `statement_kind` is required.

        Parties & account: fill `account_holder` and `institution` (legal names/addresses). Put only account/product metadata in `account_overview` (`iban`, `bic`, `account_number`, `domestic_bank_code`, `product_name`, `card_last_four`, `branch_name`) — never party names there.

        Period & balances: `period_start`/`period_end` are the transaction/listing period (Von/Bis), not the document print date; if a separate issue/print date is shown, put it in `statement_issue_date`. Map `opening_balance` and `closing_balance` from the header/summary for the full period (signed).

        Transactions — COMPLETENESS IS CRITICAL: emit one `transactions[]` object for EVERY posted logical line, in table order. Do NOT skip, summarize, deduplicate, or omit lines just because they repeat (e.g. many identical "CURSOR USAGE" rows) — each posting is a distinct transaction. The number of objects must match the number of posted lines.

        Each transaction is discrete (never fuse values into another field's string):
        - `amount`: signed total booked in the account currency (root `currency`, usually EUR); debits negative, credits positive.
        - Foreign-currency lines: whenever a line shows a foreign amount and/or a conversion rate (e.g. "1 EUR = 1,1717 USD" or a USD figure), you MUST also fill `original_amount` (the foreign Betrag, signed), `original_currency` (ISO 4217, e.g. USD), and `exchange_rate` (the Kurs/Umrechnungskurs as printed). `amount` stays the EUR figure; `original_amount` is never the rate.
        - `booking_date` (Datum Buchung) and `value_date` (Datum Beleg/Wertstellung): ISO YYYY-MM-DD or null only.
        - `description`: Verwendungszweck/merchant text; `counterparty_name` for the payee/merchant; `title` for a short headline when the row has a separate detail line (do not duplicate it in `description`). Capture an invoice/Rechnungsnummer printed on the line inside `description`.
        - `balance_after`: running balance if shown.
        Credit/charge-card statements: merge a card charge and its separate "x% für Währungsumrechnung" fee line into one object — `amount` = combined EUR total, `fx_surcharge_eur` = the EUR surcharge, `foreign_exchange_fee_percent` = the x%.
        """;
}
