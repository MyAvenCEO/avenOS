using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Aven.Roles.Accounting.Metadata;
using Aven.Roles.Accounting.Normalization;
using Aven.Roles.Accounting.Schemas;
using Aven.Roles.Support;

namespace Aven.Roles.Accounting.Matching;

internal static class AccountingMetadataMatchPlanner
{
    private const double DeterministicMatchThreshold = 0.75;
    private const double ReviewThreshold = 0.50;

    public static AccountingMatchPlan BuildPlan(
        MetadataQueryOperationResult queryResult,
        string triggerDocumentKind,
        string triggerSubjectId,
        RoleAgentId roleAgentId,
        CorrelationId correlationId,
        IReadOnlyList<AccountingPendingHumanReview> existingPendingReviews)
    {
        var invoices = queryResult.Records
            .Where(static record => string.Equals(record.SchemaRef, AccountingSchemaRefs.InvoiceV3.Value, StringComparison.Ordinal))
            .Select(ParseInvoice)
            .ToArray();
        var statements = queryResult.Records
            .Where(static record => string.Equals(record.SchemaRef, AccountingSchemaRefs.AccountStatementV3.Value, StringComparison.Ordinal))
            .Select(ParseStatement)
            .ToArray();
        var existingMatches = queryResult.Records
            .Where(static record => string.Equals(record.SchemaRef, AccountingSchemaRefs.PaymentMatchV3.Value, StringComparison.Ordinal))
            .Select(ParseExistingMatch)
            .ToArray();

        var operations = new List<RoleOperation>();
        var pendingReviews = new List<AccountingPendingHumanReview>();
        var outcomes = new List<string>();

        // A bank transaction can settle at most one invoice. Reserve transactions already consumed by a
        // paid match, and reserve each one we claim in this run, so two invoices cannot match the same line.
        var usedTransactionKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var match in existingMatches)
        {
            if (string.Equals(match.Status, "paid", StringComparison.OrdinalIgnoreCase) && match.TransactionId is not null)
            {
                usedTransactionKeys.Add(TransactionKey(match.StatementSubjectId, match.TransactionId));
            }
        }

        foreach (var invoice in invoices)
        {
            if (existingMatches.Any(match => string.Equals(match.InvoiceSubjectId, invoice.SubjectId, StringComparison.Ordinal) && string.Equals(match.Status, "paid", StringComparison.OrdinalIgnoreCase)))
            {
                outcomes.Add("paid");
                continue;
            }

            var bestCandidate = FindBestCandidate(invoice, statements, usedTransactionKeys);
            if (bestCandidate is not null && bestCandidate.Score >= DeterministicMatchThreshold)
            {
                usedTransactionKeys.Add(TransactionKey(bestCandidate.StatementSubjectId, bestCandidate.TransactionId));
                var paymentJson = BuildPaymentMatchJson(
                    AccountingSubjectIds.PaymentMatchSubjectId(invoice.SubjectId, bestCandidate.TransactionSubjectId),
                    invoice.SubjectId,
                    bestCandidate.StatementSubjectId,
                    bestCandidate.TransactionId,
                    bestCandidate.TransactionIndex,
                    invoice.SupplierName,
                    invoice.InvoiceNumber,
                    invoice.Amount,
                    bestCandidate.MatchedAmount,
                    invoice.Currency ?? bestCandidate.Currency,
                    "paid",
                    Math.Min(1.0, bestCandidate.Score),
                    $"Transaction {bestCandidate.TransactionId} matched invoice {invoice.InvoiceNumber} deterministically.",
                    bestCandidate.MatchedOn,
                    bestCandidate.MatchedDate,
                    null);

                TryAddPaymentMatchWrite(invoice.SourceArtifactId, invoice.SourceArtifactRevisionId, paymentJson, existingMatches, roleAgentId, correlationId, operations);
                outcomes.Add("paid");
                continue;
            }

            if (bestCandidate is not null && bestCandidate.Score >= ReviewThreshold)
            {
                usedTransactionKeys.Add(TransactionKey(bestCandidate.StatementSubjectId, bestCandidate.TransactionId));
                var promptRequestId = $"payment-match-review-{ShortHash(invoice.SubjectId, bestCandidate.TransactionSubjectId)}";
                var reviewJson = BuildPaymentMatchJson(
                    AccountingSubjectIds.PaymentMatchSubjectId(invoice.SubjectId, bestCandidate.TransactionSubjectId),
                    invoice.SubjectId,
                    bestCandidate.StatementSubjectId,
                    bestCandidate.TransactionId,
                    bestCandidate.TransactionIndex,
                    invoice.SupplierName,
                    invoice.InvoiceNumber,
                    invoice.Amount,
                    bestCandidate.MatchedAmount,
                    invoice.Currency ?? bestCandidate.Currency,
                    "needs_review",
                    Math.Min(1.0, bestCandidate.Score),
                    $"Transaction {bestCandidate.TransactionId} may match invoice {invoice.InvoiceNumber} but requires human review.",
                    bestCandidate.MatchedOn,
                    bestCandidate.MatchedDate,
                    promptRequestId);
                var approvedJson = BuildPaymentMatchJson(
                    AccountingSubjectIds.PaymentMatchSubjectId(invoice.SubjectId, bestCandidate.TransactionSubjectId),
                    invoice.SubjectId,
                    bestCandidate.StatementSubjectId,
                    bestCandidate.TransactionId,
                    bestCandidate.TransactionIndex,
                    invoice.SupplierName,
                    invoice.InvoiceNumber,
                    invoice.Amount,
                    bestCandidate.MatchedAmount,
                    invoice.Currency ?? bestCandidate.Currency,
                    "paid",
                    Math.Min(1.0, bestCandidate.Score),
                    $"Human approved transaction {bestCandidate.TransactionId} for invoice {invoice.InvoiceNumber}.",
                    bestCandidate.MatchedOn,
                    bestCandidate.MatchedDate,
                    promptRequestId);
                var rejectedStatus = HasCoverage(invoice, statements) ? "unpaid" : "unknown";
                var rejectedJson = BuildPaymentMatchJson(
                    AccountingSubjectIds.PaymentMatchSubjectId(invoice.SubjectId, null),
                    invoice.SubjectId,
                    null,
                    null,
                    null,
                    invoice.SupplierName,
                    invoice.InvoiceNumber,
                    invoice.Amount,
                    null,
                    invoice.Currency,
                    rejectedStatus,
                    0.2,
                    rejectedStatus == "unpaid"
                        ? $"Human rejected candidate transaction {bestCandidate.TransactionId}; statement coverage indicates invoice {invoice.InvoiceNumber} remains unpaid."
                        : $"Human rejected candidate transaction {bestCandidate.TransactionId}; insufficient statement coverage remains for invoice {invoice.InvoiceNumber}.",
                    Array.Empty<string>(),
                    null,
                    promptRequestId);

                var pendingReview = new AccountingPendingHumanReview(promptRequestId, AccountingSubjectIds.PaymentMatchSubjectId(invoice.SubjectId, bestCandidate.TransactionSubjectId), approvedJson, rejectedJson);
                var alreadyPending = existingPendingReviews.Any(review => string.Equals(review.PromptRequestId, promptRequestId, StringComparison.Ordinal))
                    || pendingReviews.Any(review => string.Equals(review.PromptRequestId, promptRequestId, StringComparison.Ordinal));
                var reviewExists = existingMatches.Any(match => string.Equals(match.Json, reviewJson, StringComparison.Ordinal));
                if (!alreadyPending && !reviewExists)
                {
                    TryAddPaymentMatchWrite(invoice.SourceArtifactId, invoice.SourceArtifactRevisionId, reviewJson, existingMatches, roleAgentId, correlationId, operations);
                    operations.Add(RoleBehaviorSupport.HumanPrompt(
                        promptRequestId,
                        correlationId,
                        new HumanPromptOperationPayload(
                            promptRequestId,
                            BuildHumanReviewPrompt(invoice, bestCandidate),
                            RoleCapabilityIds.ForRoleAgent(roleAgentId, "human-review"))));
                    pendingReviews.Add(pendingReview);
                }

                outcomes.Add("needs_review");
                continue;
            }

            var fallbackStatus = HasCoverage(invoice, statements) ? "unpaid" : "unknown";
            if (string.Equals(triggerDocumentKind, "invoice", StringComparison.Ordinal)
                && !string.Equals(fallbackStatus, "unpaid", StringComparison.Ordinal))
            {
                continue;
            }

            var fallbackJson = BuildPaymentMatchJson(
                AccountingSubjectIds.PaymentMatchSubjectId(invoice.SubjectId, null),
                invoice.SubjectId,
                null,
                null,
                null,
                invoice.SupplierName,
                invoice.InvoiceNumber,
                invoice.Amount,
                null,
                invoice.Currency,
                fallbackStatus,
                0.2,
                fallbackStatus == "unpaid"
                    ? $"No matching transaction found and statement coverage extends past the invoice due date for {invoice.InvoiceNumber}."
                    : $"No matching transaction found and statement coverage is insufficient for invoice {invoice.InvoiceNumber}.",
                Array.Empty<string>(),
                null,
                null);
            TryAddPaymentMatchWrite(invoice.SourceArtifactId, invoice.SourceArtifactRevisionId, fallbackJson, existingMatches, roleAgentId, correlationId, operations);
            outcomes.Add(fallbackStatus);
        }

        var lastResult = outcomes.Contains("needs_review", StringComparer.Ordinal)
            ? "needs_review"
            : outcomes.Contains("paid", StringComparer.Ordinal)
                ? "paid"
                : outcomes.Contains("unpaid", StringComparer.Ordinal)
                    ? "unpaid"
                    : outcomes.Contains("unknown", StringComparer.Ordinal)
                        ? "unknown"
                        : triggerDocumentKind == "invoice"
                            ? "invoice_recorded"
                            : "statement_recorded";

        return new AccountingMatchPlan(operations, pendingReviews, lastResult);
    }

    private static void TryAddPaymentMatchWrite(
        string? artifactId,
        string? artifactRevisionId,
        string paymentJson,
        IReadOnlyList<ExistingPaymentMatch> existingMatches,
        RoleAgentId roleAgentId,
        CorrelationId correlationId,
        List<RoleOperation> operations)
    {
        if (existingMatches.Any(match => string.Equals(match.Json, paymentJson, StringComparison.Ordinal)))
        {
            return;
        }

        var requestId = $"payment-match-write-{ShortHash(paymentJson)}";
        var matchId = ReadString(JsonDocument.Parse(paymentJson).RootElement, "match_id") ?? requestId;
        operations.Add(RoleBehaviorSupport.MetadataWrite(
            requestId,
            correlationId,
            new MetadataWriteOperationPayload(
                requestId,
                AccountingMetadataSubjects.PaymentMatch,
                matchId,
                AccountingSchemaRefs.PaymentMatchV3,
                paymentJson,
                "accounting metadata match refresh",
                ArtifactId: string.IsNullOrWhiteSpace(artifactId) ? null : new ArtifactId(artifactId),
                ArtifactRevisionId: string.IsNullOrWhiteSpace(artifactRevisionId) ? null : new ArtifactRevisionId(artifactRevisionId),
                CapabilityId: RoleCapabilityIds.ForRoleAgent(roleAgentId, "payment-match-metadata"))));
    }

    private static BestCandidate? FindBestCandidate(InvoiceSnapshot invoice, IReadOnlyList<StatementSnapshot> statements, ISet<string> usedTransactionKeys)
    {
        BestCandidate? best = null;
        foreach (var statement in statements)
        {
            foreach (var transaction in statement.Transactions)
            {
                if (usedTransactionKeys.Contains(TransactionKey(statement.SubjectId, transaction.TransactionId)))
                {
                    continue;
                }

                var score = 0.0;
                var matchedOn = new List<string>();

                // A transaction can be matched on its booked leg (statement currency) or, for foreign-currency
                // payments, on its original leg (e.g. a USD invoice settled as EUR) — whichever shares the
                // invoice's currency. The booked EUR figure of a USD invoice will never equal the invoice, so
                // ignoring the original leg is what caused FX invoices to be missed.
                var bookedMatchesCurrency = SameCurrency(invoice.Currency, transaction.Currency);
                var originalMatchesCurrency = SameCurrency(invoice.Currency, transaction.OriginalCurrency);
                if (bookedMatchesCurrency || originalMatchesCurrency)
                {
                    score += 0.2;
                    matchedOn.Add("currency");
                }

                // Exact, currency-aware match on integer minor units (no floating-point/decimal-scale ambiguity).
                var amountMatchesBooked = bookedMatchesCurrency && transaction.MatchedAmountMinor is not null && invoice.AmountMinor is not null && transaction.MatchedAmountMinor.Value == invoice.AmountMinor.Value;
                var amountMatchesOriginal = originalMatchesCurrency && transaction.OriginalAmountMinor is not null && invoice.AmountMinor is not null && transaction.OriginalAmountMinor.Value == invoice.AmountMinor.Value;
                if (amountMatchesBooked || amountMatchesOriginal)
                {
                    score += 0.4;
                    matchedOn.Add("amount");
                }

                // Record the leg that actually matched, so the payment-match reflects the invoice's own
                // currency and amount (the original USD leg for an FX payment).
                var settlementAmount = amountMatchesOriginal ? transaction.OriginalAmount : transaction.MatchedAmount;
                var settlementCurrency = amountMatchesOriginal ? transaction.OriginalCurrency : transaction.Currency;

                if (!string.IsNullOrWhiteSpace(invoice.InvoiceNumber) && (transaction.Description?.Contains(invoice.InvoiceNumber, StringComparison.OrdinalIgnoreCase) ?? false))
                {
                    score += 0.8;
                    matchedOn.Add("invoice_number");
                }

                if (!string.IsNullOrWhiteSpace(invoice.SupplierName)
                    && ((transaction.CounterpartyName?.Contains(invoice.SupplierName, StringComparison.OrdinalIgnoreCase) ?? false)
                        || (transaction.Description?.Contains(invoice.SupplierName, StringComparison.OrdinalIgnoreCase) ?? false)))
                {
                    score += 0.1;
                    matchedOn.Add("supplier_name");
                }

                if (best is null || score > best.Score)
                {
                    best = new BestCandidate(
                        statement.SubjectId,
                        statement.StatementId,
                        transaction.TransactionId,
                        transaction.TransactionIndex,
                        AccountingSubjectIds.StatementTransactionSubjectId(statement.SubjectId, transaction.TransactionIndex, transaction.TransactionId),
                        settlementAmount,
                        settlementCurrency,
                        transaction.BookingDate ?? transaction.ValueDate,
                        matchedOn.ToArray(),
                        score,
                        transaction.Description,
                        transaction.CounterpartyName);
                }
            }
        }

        return best;
    }

    private static bool HasCoverage(InvoiceSnapshot invoice, IReadOnlyList<StatementSnapshot> statements)
    {
        var comparisonDate = invoice.DueDate ?? invoice.IssueDate;
        if (comparisonDate is null)
        {
            return false;
        }

        return statements.Any(statement => statement.PeriodEnd is not null && statement.PeriodEnd.Value >= comparisonDate.Value);
    }

    private static string BuildPaymentMatchJson(
        string matchId,
        string invoiceSubjectId,
        string? statementSubjectId,
        string? transactionId,
        int? transactionIndex,
        string? supplierName,
        string? invoiceNumber,
        decimal? invoiceAmount,
        decimal? matchedAmount,
        string? currency,
        string status,
        double confidence,
        string reason,
        IReadOnlyList<string> matchedOn,
        string? matchedDate,
        string? reviewPromptId)
    {
        return JsonSerializer.Serialize(new
        {
            match_id = matchId,
            invoice_subject_id = invoiceSubjectId,
            statement_subject_id = statementSubjectId,
            transaction_id = transactionId,
            transaction_index = transactionIndex,
            supplier_name = supplierName,
            invoice_number = invoiceNumber,
            invoice_amount = MoneyModel(invoiceAmount, currency),
            matched_amount = MoneyModel(matchedAmount, currency),
            currency = currency,
            status = status,
            confidence = confidence,
            reason = reason,
            matched_on = matchedOn,
            matched_date = matchedDate,
            review_prompt_id = reviewPromptId
        });
    }

    private static InvoiceSnapshot ParseInvoice(MetadataRecordSnapshot record)
    {
        using var document = JsonDocument.Parse(record.Json);
        var root = document.RootElement;
        return new InvoiceSnapshot(
            record.SubjectId,
            record.ArtifactId,
            record.ArtifactRevisionId,
            ReadString(root, "invoice_number") ?? record.SubjectId,
            ReadString(root, "vendor_name"),
            ReadString(root, "currency"),
            ReadDecimal(root, "total_outstanding", "amount") ?? ReadDecimal(root, "invoice_total", "amount"),
            ReadLong(root, "total_outstanding", "minor_units") ?? ReadLong(root, "invoice_total", "minor_units"),
            ParseDate(ReadString(root, "issue_date")),
            ParseDate(ReadString(root, "due_date")));
    }

    private static StatementSnapshot ParseStatement(MetadataRecordSnapshot record)
    {
        using var document = JsonDocument.Parse(record.Json);
        var root = document.RootElement;
        var statementCurrency = ReadString(root, "currency");
        var transactions = new List<TransactionSnapshot>();
        if (root.TryGetProperty("transactions", out var txs) && txs.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var tx in txs.EnumerateArray())
            {
                transactions.Add(new TransactionSnapshot(
                    ReadString(tx, "transaction_id") ?? $"tx-{index}",
                    index,
                    ReadDecimal(tx, "amount", "amount") is { } amount ? Math.Abs(amount) : (decimal?)null,
                    ReadLong(tx, "amount", "minor_units") is { } minor ? Math.Abs(minor) : (long?)null,
                    ReadString(tx, "amount", "currency") ?? statementCurrency,
                    // Foreign-currency payments are booked in the statement currency but also carry the
                    // original amount/currency (e.g. a USD invoice settled as EUR). Matching must consider both.
                    ReadDecimal(tx, "original_amount", "amount") is { } original ? Math.Abs(original) : (decimal?)null,
                    ReadLong(tx, "original_amount", "minor_units") is { } originalMinor ? Math.Abs(originalMinor) : (long?)null,
                    ReadString(tx, "original_amount", "currency") ?? ReadString(tx, "original_currency"),
                    ReadString(tx, "description"),
                    ReadString(tx, "counterparty_name"),
                    ReadString(tx, "booking_date"),
                    ReadString(tx, "value_date")));
                index += 1;
            }
        }

        return new StatementSnapshot(
            record.SubjectId,
            record.SubjectId,
            ParseDate(ReadString(root, "period_end")),
            transactions);
    }

    private static ExistingPaymentMatch ParseExistingMatch(MetadataRecordSnapshot record)
    {
        using var document = JsonDocument.Parse(record.Json);
        var root = document.RootElement;
        return new ExistingPaymentMatch(
            ReadString(root, "match_id") ?? record.SubjectId,
            ReadString(root, "invoice_subject_id") ?? string.Empty,
            ReadString(root, "statement_subject_id"),
            ReadString(root, "transaction_id"),
            ReadString(root, "status") ?? "unknown",
            record.Json,
            record.CreatedAt);
    }

    private static object? MoneyModel(decimal? amount, string? currency) =>
        amount is null || string.IsNullOrWhiteSpace(currency)
            ? null
            : AccountingMoney.FromAmount(amount.Value, currency).ToJsonModel();

    private static bool SameCurrency(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static DateOnly? ParseDate(string? value)
        => DateOnly.TryParse(value, out var date) ? date : null;

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

    private static long? ReadLong(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                return null;
            }
        }

        return current.ValueKind == JsonValueKind.Number && current.TryGetInt64(out var value) ? value : null;
    }

    private static string TransactionKey(string? statementSubjectId, string? transactionId) =>
        $"{statementSubjectId}|{transactionId}";

    private static string ShortHash(params string?[] parts)
    {
        using var sha = SHA256.Create();
        var bytes = Encoding.UTF8.GetBytes(string.Join("|", parts.Select(static part => part ?? string.Empty)));
        return Convert.ToHexString(sha.ComputeHash(bytes))[..12].ToLowerInvariant();
    }

    private static string BuildHumanReviewPrompt(InvoiceSnapshot invoice, BestCandidate bestCandidate)
    {
        var invoiceRef = invoice.InvoiceNumber ?? invoice.SubjectId;
        var supplier = invoice.SupplierName ?? "Unknown supplier";
        var amount = invoice.Amount?.ToString() ?? "unknown";
        var currency = invoice.Currency ?? bestCandidate.Currency ?? string.Empty;
        var transactionAmount = bestCandidate.MatchedAmount?.ToString() ?? "unknown";
        var transactionCurrency = bestCandidate.Currency ?? currency;
        var matchedOn = bestCandidate.MatchedOn.Count == 0 ? "none" : string.Join(", ", bestCandidate.MatchedOn);
        return $"Should invoice {invoiceRef} be marked as paid? Supplier: {supplier}. Invoice amount: {amount} {currency}. Candidate transaction: {bestCandidate.TransactionId} on {bestCandidate.MatchedDate ?? "unknown date"} for {transactionAmount} {transactionCurrency}. Confidence: {bestCandidate.Score:0.00}. Matched on: {matchedOn}.";
    }

    private sealed record InvoiceSnapshot(
        string SubjectId,
        string? SourceArtifactId,
        string? SourceArtifactRevisionId,
        string InvoiceNumber,
        string? SupplierName,
        string? Currency,
        decimal? Amount,
        long? AmountMinor,
        DateOnly? IssueDate,
        DateOnly? DueDate);

    private sealed record StatementSnapshot(
        string SubjectId,
        string StatementId,
        DateOnly? PeriodEnd,
        IReadOnlyList<TransactionSnapshot> Transactions);

    private sealed record TransactionSnapshot(
        string TransactionId,
        int TransactionIndex,
        decimal? MatchedAmount,
        long? MatchedAmountMinor,
        string? Currency,
        decimal? OriginalAmount,
        long? OriginalAmountMinor,
        string? OriginalCurrency,
        string? Description,
        string? CounterpartyName,
        string? BookingDate,
        string? ValueDate);

    private sealed record BestCandidate(
        string StatementSubjectId,
        string StatementId,
        string TransactionId,
        int TransactionIndex,
        string TransactionSubjectId,
        decimal? MatchedAmount,
        string? Currency,
        string? MatchedDate,
        IReadOnlyList<string> MatchedOn,
        double Score,
        string? Description,
        string? Counterparty);

    private sealed record ExistingPaymentMatch(
        string MatchId,
        string InvoiceSubjectId,
        string? StatementSubjectId,
        string? TransactionId,
        string Status,
        string Json,
        DateTimeOffset CreatedAt);
}
