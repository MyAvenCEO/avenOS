using Aven.Roles.Accounting.Schemas;

namespace Aven.Roles.Accounting.Extraction;

internal enum AccountingDocumentTarget
{
    Invoice,
    Statement,
    Unsupported,
    Unknown
}

internal static class AccountingDocumentClassifier
{
    public static AccountingDocumentTarget ClassifyDeterministically(AccountingDocumentCommand command)
    {
        if (command.RequiredSchemas.Any(IsAccountStatementSchema))
        {
            return AccountingDocumentTarget.Statement;
        }

        if (command.RequiredSchemas.Any(IsInvoiceSchema))
        {
            return AccountingDocumentTarget.Invoice;
        }

        return AccountingDocumentTarget.Unknown;
    }

    public static SchemaRef ResolveSchemaRef(AccountingDocumentTarget target) => target switch
    {
        AccountingDocumentTarget.Statement => AccountingSchemaRefs.AccountStatementExtractionV1,
        AccountingDocumentTarget.Invoice => AccountingSchemaRefs.InvoiceExtractionV1,
        _ => AccountingSchemaRefs.DocumentClassificationV1
    };

    public static string ResolvePurpose(AccountingDocumentTarget target) => target switch
    {
        AccountingDocumentTarget.Statement => AccountingOperationTypes.StatementExtractPurpose,
        AccountingDocumentTarget.Invoice => AccountingOperationTypes.InvoiceExtractPurpose,
        _ => AccountingOperationTypes.ClassificationPurpose
    };

    private static bool IsAccountStatementSchema(SchemaRef schemaRef) =>
        schemaRef == AccountingSchemaRefs.AccountStatementExtractionV1 || schemaRef == AccountingSchemaRefs.AccountStatementV3;

    private static bool IsInvoiceSchema(SchemaRef schemaRef) =>
        schemaRef == AccountingSchemaRefs.InvoiceExtractionV1 || schemaRef == AccountingSchemaRefs.InvoiceV3;
}
