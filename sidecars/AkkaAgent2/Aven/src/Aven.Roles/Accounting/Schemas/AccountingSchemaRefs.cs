namespace Aven.Roles.Accounting.Schemas;

public static class AccountingSchemaRefs
{
    public static readonly SchemaRef DocumentClassificationV1 = new("schema://accounting/document-classification@1");

    // Extraction schemas: the rich, document-faithful shapes the LLM fills via structured output.
    public static readonly SchemaRef InvoiceExtractionV1 = new("schema://accounting/invoice-extraction@1");
    public static readonly SchemaRef AccountStatementExtractionV1 = new("schema://accounting/account-statement-extraction@1");

    // Canonical schemas: normalized, validated shapes that are stored, queried, and matched.
    public static readonly SchemaRef InvoiceV3 = new("schema://accounting/invoice@3");
    public static readonly SchemaRef AccountStatementV3 = new("schema://accounting/account-statement@3");
    public static readonly SchemaRef StatementTransactionV3 = new("schema://accounting/statement-transaction@3");
    public static readonly SchemaRef PaymentMatchV3 = new("schema://accounting/payment-match@3");
}
