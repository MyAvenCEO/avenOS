using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Aven.Roles.Accounting.Metadata;

internal static class AccountingSubjectIds
{
    public static string InvoiceSubjectId(string json, ArtifactRef sourceArtifact)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var vendorName = ReadString(root, "vendor_name") ?? "unknown-vendor";
        var invoiceNumber = ReadString(root, "invoice_number") ?? "unknown-invoice";
        var issueDate = ReadString(root, "issue_date") ?? "unknown-date";
        return $"invoice:{Slug(vendorName)}:{Slug(invoiceNumber)}:{ShortHash(vendorName, invoiceNumber, issueDate, sourceArtifact.ArtifactId.Value, sourceArtifact.RevisionId?.Value)}";
    }

    public static string StatementSubjectId(string json, ArtifactRef sourceArtifact)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var institution = ReadString(root, "institution_name") ?? "unknown-institution";
        var account = ReadString(root, "account_iban") ?? "unknown-account";
        var periodStart = ReadString(root, "period_start") ?? "unknown-start";
        var periodEnd = ReadString(root, "period_end") ?? "unknown-end";
        return $"statement:{Slug(institution)}:{ShortHash(institution, account, periodStart, periodEnd, sourceArtifact.ArtifactId.Value, sourceArtifact.RevisionId?.Value)}";
    }

    public static string StatementTransactionSubjectId(string statementSubjectId, int transactionIndex, string? transactionId)
    {
        if (string.IsNullOrWhiteSpace(transactionId))
        {
            return $"{statementSubjectId}:tx:{transactionIndex}";
        }

        return $"{statementSubjectId}:tx:{transactionIndex}:{ShortHash(transactionId)}";
    }

    public static string PaymentMatchSubjectId(string invoiceSubjectId, string? transactionSubjectId) =>
        $"match:{invoiceSubjectId}:{transactionSubjectId ?? "unpaid"}";

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

    private static string Slug(string value)
    {
        var chars = value.ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray();
        return string.Join(string.Empty, new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries)).Trim();
    }

    private static string ShortHash(params string?[] parts)
    {
        using var sha = SHA256.Create();
        var bytes = Encoding.UTF8.GetBytes(string.Join("|", parts.Select(static x => x ?? string.Empty)));
        return Convert.ToHexString(sha.ComputeHash(bytes))[..12].ToLowerInvariant();
    }
}
