namespace Aven.Roles.Accounting;

public sealed record AccountingWorkflowComputation(
    string InvoiceNumber,
    string StatementId,
    string TransactionId,
    string MatchId,
    string PaymentMatchJson,
    string WorkflowExplanation,
    bool RequiresHumanReview,
    AccountingLedgerView FinalLedgerView,
    string InvoiceStructuredJson,
    string StatementStructuredJson,
    string InvoiceSubjectId,
    string StatementSubjectId,
    string? TransactionSubjectId);
