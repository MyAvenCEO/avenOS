namespace Aven.Roles.Accounting;

internal static class AccountingOperationTypes
{
    public const string IngestDocument = "accounting.ingest_document";
    public const string Invoice = "accounting.invoice";
    public const string Statement = "accounting.statement";
    public const string AccountStatement = "accounting.account_statement";

    public const string InvoiceExtractPurpose = "accounting.invoice.extract";
    public const string StatementExtractPurpose = "accounting.statement.extract";
    public const string ClassificationPurpose = "accounting.document.classify";
}
