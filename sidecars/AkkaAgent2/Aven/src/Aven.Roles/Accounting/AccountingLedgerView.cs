namespace Aven.Roles.Accounting;

public sealed record AccountingLedgerView(
    IReadOnlyList<string> OpenInvoices,
    IReadOnlyList<string> PaidInvoices,
    IReadOnlyList<string> UncertainMatches,
    string Status);
