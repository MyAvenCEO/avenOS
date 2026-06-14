using System.Text.Json;
using System.Text.Json.Nodes;
using Aven.Roles.Accounting.Schemas;
using Aven.Roles.Support;

namespace Aven.Roles.Accounting.Metadata;

internal static class AccountingMetadataWritePlanner
{
    public static IReadOnlyList<RoleOperation> BuildInvoiceOperations(AccountingExtractedDocument invoice, RoleAgentId roleAgentId, CorrelationId correlationId)
    {
        var subjectId = AccountingSubjectIds.InvoiceSubjectId(invoice.StructuredJson, invoice.SourceArtifact);
        var requestId = $"invoice-metadata-{subjectId}";
        return
        [
            RoleBehaviorSupport.MetadataWrite(
                requestId,
                correlationId,
                new MetadataWriteOperationPayload(
                    requestId,
                    AccountingMetadataSubjects.Invoice,
                    subjectId,
                    AccountingSchemaRefs.InvoiceV3,
                    invoice.StructuredJson,
                    "invoice extraction",
                    ArtifactId: new ArtifactId(invoice.SourceArtifact.ArtifactId.Value),
                    ArtifactRevisionId: invoice.SourceArtifact.RevisionId is null ? null : new ArtifactRevisionId(invoice.SourceArtifact.RevisionId.Value.Value),
                    CapabilityId: RoleCapabilityIds.ForRoleAgent(roleAgentId, "invoice-metadata")))
        ];
    }

    public static IReadOnlyList<RoleOperation> BuildStatementOperations(AccountingExtractedDocument statement, RoleAgentId roleAgentId, CorrelationId correlationId)
    {
        var statementSubjectId = AccountingSubjectIds.StatementSubjectId(statement.StructuredJson, statement.SourceArtifact);
        var statementRequestId = $"statement-metadata-{statementSubjectId}";
        var operations = new List<RoleOperation>
        {
            RoleBehaviorSupport.MetadataWrite(
                statementRequestId,
                correlationId,
                new MetadataWriteOperationPayload(
                    statementRequestId,
                    AccountingMetadataSubjects.AccountStatement,
                    statementSubjectId,
                    AccountingSchemaRefs.AccountStatementV3,
                    statement.StructuredJson,
                    "statement extraction",
                    ArtifactId: new ArtifactId(statement.SourceArtifact.ArtifactId.Value),
                    ArtifactRevisionId: statement.SourceArtifact.RevisionId is null ? null : new ArtifactRevisionId(statement.SourceArtifact.RevisionId.Value.Value),
                    CapabilityId: RoleCapabilityIds.ForRoleAgent(roleAgentId, "statement-metadata")))
        };

        using var document = JsonDocument.Parse(statement.StructuredJson);
        if (document.RootElement.TryGetProperty("transactions", out var transactions) && transactions.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var transaction in transactions.EnumerateArray())
            {
                // Each canonical transaction is already normalized; the per-transaction record is the
                // same shape plus its owning statement subject id.
                var txObject = JsonNode.Parse(transaction.GetRawText())!.AsObject();
                var txId = txObject["transaction_id"]?.GetValue<string>();
                var subjectId = AccountingSubjectIds.StatementTransactionSubjectId(statementSubjectId, index, txId);
                txObject["statement_subject_id"] = statementSubjectId;

                var transactionRequestId = $"statement-transaction-{subjectId}";
                operations.Add(RoleBehaviorSupport.MetadataWrite(
                    transactionRequestId,
                    correlationId,
                    new MetadataWriteOperationPayload(
                        transactionRequestId,
                        AccountingMetadataSubjects.StatementTransaction,
                        subjectId,
                        AccountingSchemaRefs.StatementTransactionV3,
                        txObject.ToJsonString(),
                        "statement transaction index",
                        ArtifactId: new ArtifactId(statement.SourceArtifact.ArtifactId.Value),
                        ArtifactRevisionId: statement.SourceArtifact.RevisionId is null ? null : new ArtifactRevisionId(statement.SourceArtifact.RevisionId.Value.Value),
                        CapabilityId: RoleCapabilityIds.ForRoleAgent(roleAgentId, "transaction-metadata"))));
                index += 1;
            }
        }

        return operations;
    }
}
