using System.Text.Json;

namespace Aven.Api.Models;

public sealed record AccountingInvoiceView(
    string SubjectId,
    string? InvoiceNumber,
    string? VendorName,
    string? Currency,
    decimal? InvoiceTotal,
    decimal? TotalOutstanding,
    string? IssueDate,
    string? DueDate,
    string RawJson);

public sealed record AccountingStatementView(
    string StatementSubjectId,
    string? StatementId,
    string? Currency,
    string? PeriodStart,
    string? PeriodEnd,
    int TransactionCount,
    string RawJson);

public sealed record AccountingPaymentMatchView(
    string MatchId,
    string InvoiceSubjectId,
    string? StatementSubjectId,
    string? TransactionId,
    string? SupplierName,
    string? InvoiceNumber,
    decimal? InvoiceAmount,
    decimal? MatchedAmount,
    string? Currency,
    string Status,
    double Confidence,
    string Reason,
    string? MatchedDate,
    string? ReviewPromptId,
    DateTimeOffset CreatedAt);

public sealed record AccountingSupplierSpendView(string SupplierName, decimal Amount, string Currency);

public sealed record AccountingSupplierSpendPeriodView(string PeriodKey, decimal Amount, string Currency);

public sealed record AccountingSupplierSpendSummaryView(string SupplierName, string Period, IReadOnlyList<AccountingSupplierSpendPeriodView> Periods);

public sealed record AccountingQuestionResponse(bool Supported, string QueryKind, object Result, string? Message = null);

public static class AccountingViews
{
    public static AccountingInvoiceView ToInvoiceView(MetadataRecord record)
    {
        using var doc = JsonDocument.Parse(record.Json);
        var root = doc.RootElement;
        return new AccountingInvoiceView(
            record.Subject.Id,
            ReadString(root, "invoice_number"),
            ReadString(root, "vendor_name"),
            ReadString(root, "currency"),
            ReadDecimal(root, "invoice_total", "amount"),
            ReadDecimal(root, "total_outstanding", "amount"),
            ReadString(root, "issue_date"),
            ReadString(root, "due_date"),
            record.Json);
    }

    public static AccountingStatementView ToStatementView(MetadataRecord record)
    {
        using var doc = JsonDocument.Parse(record.Json);
        var root = doc.RootElement;
        var transactionCount = root.TryGetProperty("transactions", out var tx) && tx.ValueKind == JsonValueKind.Array ? tx.GetArrayLength() : 0;
        return new AccountingStatementView(
            record.Subject.Id,
            ReadString(root, "statement_id"),
            ReadString(root, "currency"),
            ReadString(root, "period_start"),
            ReadString(root, "period_end"),
            transactionCount,
            record.Json);
    }

    public static AccountingPaymentMatchView ToPaymentMatchView(MetadataRecord record)
    {
        using var doc = JsonDocument.Parse(record.Json);
        var root = doc.RootElement;
        return new AccountingPaymentMatchView(
            ReadString(root, "match_id") ?? record.Subject.Id,
            ReadString(root, "invoice_subject_id") ?? string.Empty,
            ReadString(root, "statement_subject_id"),
            ReadString(root, "transaction_id"),
            ReadString(root, "supplier_name"),
            ReadString(root, "invoice_number"),
            ReadDecimal(root, "invoice_amount", "amount"),
            ReadDecimal(root, "matched_amount", "amount"),
            ReadString(root, "currency"),
            ReadString(root, "status") ?? "unknown",
            ReadDouble(root, "confidence") ?? 0,
            ReadString(root, "reason") ?? string.Empty,
            ReadString(root, "matched_date"),
            ReadString(root, "review_prompt_id"),
            record.CreatedAt);
    }

    public static IReadOnlyList<AccountingSupplierSpendView> AggregateSupplierSpend(
        IReadOnlyList<AccountingInvoiceView> invoices,
        IReadOnlyList<AccountingPaymentMatchView> matches,
        string? statusFilter)
    {
        var latestMatches = LatestMatchesByInvoice(matches);
        var paidAmounts = latestMatches.Values
            .Where(match => statusFilter is null || string.Equals(match.Status, statusFilter, StringComparison.OrdinalIgnoreCase))
            .Where(match => !string.IsNullOrWhiteSpace(match.SupplierName) || invoices.Any(invoice => string.Equals(invoice.SubjectId, match.InvoiceSubjectId, StringComparison.Ordinal)))
            .Select(match =>
            {
                var invoice = invoices.FirstOrDefault(x => string.Equals(x.SubjectId, match.InvoiceSubjectId, StringComparison.Ordinal));
                var supplier = match.SupplierName ?? invoice?.VendorName ?? "Unknown supplier";
                var amount = match.MatchedAmount ?? match.InvoiceAmount ?? invoice?.InvoiceTotal ?? 0m;
                var currency = match.Currency ?? invoice?.Currency ?? "UNKNOWN";
                return new { supplier, amount, currency };
            })
            .GroupBy(x => (Supplier: x.supplier, Currency: x.currency))
            .ToDictionary(g => g.Key, g => g.Sum(x => x.amount));

        var invoiceSuppliers = invoices
            .Select(invoice => (Supplier: invoice.VendorName ?? "Unknown supplier", Currency: invoice.Currency ?? "UNKNOWN"))
            .Distinct()
            .ToArray();

        return invoiceSuppliers
            .Select(x => new AccountingSupplierSpendView(x.Supplier, paidAmounts.TryGetValue((x.Supplier, x.Currency), out var amount) ? amount : 0m, x.Currency))
            .OrderBy(static x => x.SupplierName, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static AccountingSupplierSpendSummaryView BuildSupplierSpendSummary(
        IReadOnlyList<AccountingInvoiceView> invoices,
        IReadOnlyList<AccountingPaymentMatchView> matches,
        string supplierIdOrName,
        string? period)
    {
        var normalizedPeriod = string.IsNullOrWhiteSpace(period) ? "month" : period.ToLowerInvariant();
        var latestMatches = LatestMatchesByInvoice(matches);
        var filtered = latestMatches.Values
            .Where(match => string.Equals(match.Status, "paid", StringComparison.OrdinalIgnoreCase))
            .Select(match => new { Match = match, Invoice = invoices.FirstOrDefault(x => string.Equals(x.SubjectId, match.InvoiceSubjectId, StringComparison.Ordinal)) })
            .Where(x => string.Equals(x.Match.SupplierName ?? x.Invoice?.VendorName, supplierIdOrName, StringComparison.OrdinalIgnoreCase)
                     || string.Equals(x.Invoice?.SubjectId, supplierIdOrName, StringComparison.OrdinalIgnoreCase))
            .Select(x => new
            {
                PeriodKey = BuildPeriodKey(x.Match.MatchedDate, normalizedPeriod),
                Amount = x.Match.MatchedAmount ?? x.Match.InvoiceAmount ?? x.Invoice?.InvoiceTotal ?? 0m,
                Currency = x.Match.Currency ?? x.Invoice?.Currency ?? "UNKNOWN"
            })
            .GroupBy(x => new { x.PeriodKey, x.Currency })
            .OrderBy(g => g.Key.PeriodKey, StringComparer.Ordinal)
            .Select(g => new AccountingSupplierSpendPeriodView(g.Key.PeriodKey, g.Sum(x => x.Amount), g.Key.Currency))
            .ToArray();

        return new AccountingSupplierSpendSummaryView(supplierIdOrName, normalizedPeriod, filtered);
    }

    public static AccountingQuestionResponse AnswerQuestion(IReadOnlyList<AccountingInvoiceView> invoices, IReadOnlyList<AccountingPaymentMatchView> matches, string query)
    {
        var normalized = query.Trim().ToLowerInvariant();
        var latestMatches = LatestMatchesByInvoice(matches);
        if (normalized.Contains("who are my suppliers"))
        {
            return new AccountingQuestionResponse(true, "suppliers", invoices
                .Select(static x => x.VendorName)
                .Where(static x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(static x => x, StringComparer.OrdinalIgnoreCase)
                .ToArray());
        }

        foreach (var period in new[] { "month", "quarter", "semester", "year" })
        {
            if (normalized.Contains($"how much did i pay per supplier per {period}"))
            {
                var spend = AggregateSupplierSpend(invoices, latestMatches.Values.ToArray(), "paid");
                return new AccountingQuestionResponse(true, $"supplier_spend_{period}", spend);
            }
        }

        if (normalized.Contains("which invoices are unpaid"))
        {
            return new AccountingQuestionResponse(true, "unpaid_invoices", latestMatches.Values.Where(static x => string.Equals(x.Status, "unpaid", StringComparison.OrdinalIgnoreCase)).ToArray());
        }

        if (normalized.Contains("which invoices are paid"))
        {
            return new AccountingQuestionResponse(true, "paid_invoices", latestMatches.Values.Where(static x => string.Equals(x.Status, "paid", StringComparison.OrdinalIgnoreCase)).ToArray());
        }

        if (normalized.Contains("which invoices are unknown"))
        {
            return new AccountingQuestionResponse(true, "unknown_invoices", latestMatches.Values.Where(static x => string.Equals(x.Status, "unknown", StringComparison.OrdinalIgnoreCase)).ToArray());
        }

        if (normalized.Contains("which invoices need review") || normalized.Contains("which invoices are uncertain"))
        {
            return new AccountingQuestionResponse(true, "needs_review_invoices", latestMatches.Values.Where(static x => string.Equals(x.Status, "needs_review", StringComparison.OrdinalIgnoreCase)).ToArray());
        }

        return new AccountingQuestionResponse(false, "unsupported", Array.Empty<object>(), "Unsupported accounting question. Supported patterns: suppliers, paid spend by period, paid/unpaid/unknown/needs_review invoices.");
    }

    private static Dictionary<string, AccountingPaymentMatchView> LatestMatchesByInvoice(IReadOnlyList<AccountingPaymentMatchView> matches) =>
        matches
            .GroupBy(static x => x.InvoiceSubjectId, StringComparer.Ordinal)
            .ToDictionary(
                static g => g.Key,
                static g => g.OrderByDescending(static x => x.CreatedAt).First(),
                StringComparer.Ordinal);

    private static string BuildPeriodKey(string? isoDate, string period)
    {
        if (!DateOnly.TryParse(isoDate, out var date))
        {
            return "unknown";
        }

        return period switch
        {
            "quarter" => $"{date.Year}-Q{((date.Month - 1) / 3) + 1}",
            "semester" => $"{date.Year}-S{(date.Month <= 6 ? 1 : 2)}",
            "year" => date.Year.ToString(),
            _ => $"{date.Year}-{date.Month:00}"
        };
    }

    private static string? ReadString(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }

        return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
    }

    private static decimal? ReadDecimal(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }

        return current.ValueKind == JsonValueKind.Number ? current.GetDecimal() : null;
    }

    private static double? ReadDouble(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }

        return current.ValueKind == JsonValueKind.Number ? current.GetDouble() : null;
    }
}
