using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aven.Roles.Accounting.Normalization;

/// <summary>
/// Deterministic post-extraction step that turns a raw LLM "extraction" document into a canonical
/// <c>@3</c> accounting document: money becomes <see cref="AccountingMoney"/> ({ amount, currency,
/// minor_units }), dates become ISO-8601, currency becomes ISO-4217, and any value/arithmetic
/// problems are recorded as structured issues. The original extraction is preserved verbatim under
/// <c>source_document</c>; the LLM's figures are never silently rewritten.
/// </summary>
public static class AccountingValueNormalizer
{
    private const int MinorUnitTolerance = 1;

    public static string NormalizeInvoice(string rawJson, string sourceSchema)
    {
        using var document = JsonDocument.Parse(rawJson);
        var root = document.RootElement;
        var issues = new JsonArray();

        var currency = ResolveCurrency(ReadString(root, "header", "currency"), issues, "header.currency");

        var subtotal = ReadAmount(root, issues, "totals.subtotal", "totals", "subtotal");
        var taxTotal = ReadAmount(root, issues, "totals.tax_total", "totals", "tax_total");
        var invoiceTotal = ReadAmount(root, issues, "totals.invoice_total", "totals", "invoice_total");
        var totalOutstanding = ReadAmount(root, issues, "total_outstanding", "total_outstanding");

        ValidateInvoiceTotals(subtotal, taxTotal, invoiceTotal, currency, issues);
        ValidateTaxBreakdown(root, currency, issues);

        var canonical = new JsonObject
        {
            ["vendor_name"] = ReadString(root, "vendor", "name"),
            ["invoice_number"] = ReadString(root, "header", "invoice_number"),
            ["issue_date"] = NormalizeDate(ReadString(root, "header", "issue_date"), issues, "header.issue_date"),
            ["due_date"] = NormalizeDate(ReadString(root, "header", "due_date"), issues, "header.due_date"),
            ["currency"] = currency,
            ["subtotal"] = MoneyNode(subtotal, currency),
            ["tax_total"] = MoneyNode(taxTotal, currency),
            ["invoice_total"] = MoneyNode(invoiceTotal, currency),
            ["total_outstanding"] = MoneyNode(totalOutstanding, currency),
            ["normalization"] = NormalizationBlock(sourceSchema, issues),
            ["source_document"] = JsonNode.Parse(rawJson)
        };

        return canonical.ToJsonString();
    }

    public static string NormalizeStatement(string rawJson, string sourceSchema)
    {
        using var document = JsonDocument.Parse(rawJson);
        var root = document.RootElement;
        var issues = new JsonArray();

        var currency = ResolveCurrency(ReadString(root, "currency"), issues, "currency");
        var openingBalance = ReadAmount(root, issues, "opening_balance", "opening_balance");
        var closingBalance = ReadAmount(root, issues, "closing_balance", "closing_balance");

        var transactions = new JsonArray();
        if (root.TryGetProperty("transactions", out var txArray) && txArray.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var tx in txArray.EnumerateArray())
            {
                transactions.Add(NormalizeTransaction(tx, index, currency, issues));
                index += 1;
            }
        }

        var canonical = new JsonObject
        {
            ["institution_name"] = ReadString(root, "institution", "name"),
            ["account_iban"] = ReadString(root, "account_overview", "iban") ?? ReadString(root, "account_overview", "account_number"),
            ["currency"] = currency,
            ["period_start"] = NormalizeDate(ReadString(root, "period_start"), issues, "period_start"),
            ["period_end"] = NormalizeDate(ReadString(root, "period_end"), issues, "period_end"),
            ["opening_balance"] = MoneyNode(openingBalance, currency),
            ["closing_balance"] = MoneyNode(closingBalance, currency),
            ["transaction_count"] = transactions.Count,
            ["transactions"] = transactions,
            ["normalization"] = NormalizationBlock(sourceSchema, issues),
            ["source_document"] = JsonNode.Parse(rawJson)
        };

        return canonical.ToJsonString();
    }

    private static JsonObject NormalizeTransaction(JsonElement tx, int index, string statementCurrency, JsonArray issues)
    {
        var field = $"transactions[{index}]";
        var txCurrency = AccountingCurrencies.Normalize(ReadString(tx, "currency")) ?? statementCurrency;
        var amount = ReadAmount(tx, issues, $"{field}.amount", "amount");
        var direction = ReadString(tx, "direction") is { } d && (d == "debit" || d == "credit")
            ? d
            : amount is < 0 ? "debit" : "credit";

        return new JsonObject
        {
            ["transaction_id"] = ReadString(tx, "transaction_id") ?? $"tx-{index}",
            ["transaction_index"] = index,
            ["booking_date"] = NormalizeDate(ReadString(tx, "booking_date"), issues, $"{field}.booking_date"),
            ["booking_date_as_printed"] = ReadString(tx, "booking_date_as_printed"),
            ["value_date"] = NormalizeDate(ReadString(tx, "value_date"), issues, $"{field}.value_date"),
            ["description"] = ReadString(tx, "description"),
            ["counterparty_name"] = ReadString(tx, "counterparty_name"),
            ["title"] = ReadString(tx, "title"),
            ["amount"] = MoneyNode(amount, txCurrency),
            ["direction"] = direction,
            ["original_amount"] = MoneyNode(ReadAmount(tx, issues, $"{field}.original_amount", "original_amount"), AccountingCurrencies.Normalize(ReadString(tx, "original_currency")) ?? txCurrency),
            ["original_currency"] = AccountingCurrencies.Normalize(ReadString(tx, "original_currency")),
            ["exchange_rate"] = ReadString(tx, "exchange_rate"),
            ["balance_after"] = MoneyNode(ReadAmount(tx, issues, $"{field}.balance_after", "balance_after"), statementCurrency)
        };
    }

    private static void ValidateInvoiceTotals(decimal? subtotal, decimal? taxTotal, decimal? invoiceTotal, string currency, JsonArray issues)
    {
        if (subtotal is null || taxTotal is null || invoiceTotal is null)
        {
            return;
        }

        var expected = AccountingMoney.FromAmount(subtotal.Value + taxTotal.Value, currency).MinorUnits;
        var actual = AccountingMoney.FromAmount(invoiceTotal.Value, currency).MinorUnits;
        if (Math.Abs(expected - actual) > MinorUnitTolerance)
        {
            AddIssue(issues, "total_mismatch", "totals.invoice_total", "warning",
                $"subtotal + tax_total ({subtotal + taxTotal}) does not equal invoice_total ({invoiceTotal}).");
        }
    }

    private static void ValidateTaxBreakdown(JsonElement root, string currency, JsonArray issues)
    {
        if (!TryGetByPath(root, out var breakdown, "totals", "tax_breakdown") || breakdown.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var index = 0;
        foreach (var row in breakdown.EnumerateArray())
        {
            var net = ReadAmountOrNull(row, "net_subtotal");
            var tax = ReadAmountOrNull(row, "tax_amount");
            var gross = ReadAmountOrNull(row, "gross_subtotal");
            if (net is not null && tax is not null && gross is not null)
            {
                var expected = AccountingMoney.FromAmount(net.Value + tax.Value, currency).MinorUnits;
                var actual = AccountingMoney.FromAmount(gross.Value, currency).MinorUnits;
                if (Math.Abs(expected - actual) > MinorUnitTolerance)
                {
                    AddIssue(issues, "tax_breakdown_inconsistent", $"totals.tax_breakdown[{index}]", "warning",
                        $"net_subtotal + tax_amount ({net + tax}) does not equal gross_subtotal ({gross}).");
                }
            }

            index += 1;
        }
    }

    private static string ResolveCurrency(string? raw, JsonArray issues, string field)
    {
        var normalized = AccountingCurrencies.Normalize(raw);
        if (normalized is not null)
        {
            return normalized;
        }

        if (!string.IsNullOrWhiteSpace(raw))
        {
            AddIssue(issues, "currency_defaulted", field, "warning", $"Could not normalize currency '{raw}'; defaulted to {AccountingCurrencies.Unknown}.");
        }

        return AccountingCurrencies.Unknown;
    }

    private static string? NormalizeDate(string? raw, JsonArray issues, string field)
    {
        var iso = AccountingDateNormalizer.Normalize(raw, out var unparseable);
        if (unparseable)
        {
            AddIssue(issues, "date_unparseable", field, "warning", $"Could not parse date '{raw}'.");
        }

        return iso;
    }

    private static decimal? ReadAmount(JsonElement parent, JsonArray issues, string field, params string[] path)
    {
        if (!TryGetByPath(parent, out var element, path) || element.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (AccountingCurrencies.TryParseAmount(element, out var amount))
        {
            return amount;
        }

        AddIssue(issues, "money_unparseable", field, "warning", "Money value could not be parsed.");
        return null;
    }

    private static decimal? ReadAmountOrNull(JsonElement parent, params string[] path) =>
        TryGetByPath(parent, out var element, path) && AccountingCurrencies.TryParseAmount(element, out var amount)
            ? amount
            : null;

    private static JsonObject? MoneyNode(decimal? amount, string currency)
    {
        if (amount is null)
        {
            return null;
        }

        var money = AccountingMoney.FromAmount(amount.Value, currency);
        return new JsonObject
        {
            ["amount"] = JsonValue.Create(money.Amount),
            ["currency"] = money.Currency,
            ["minor_units"] = JsonValue.Create(money.MinorUnits)
        };
    }

    private static JsonObject NormalizationBlock(string sourceSchema, JsonArray issues) => new()
    {
        ["source_schema"] = sourceSchema,
        ["issues"] = issues
    };

    private static void AddIssue(JsonArray issues, string code, string field, string severity, string message) =>
        issues.Add(new JsonObject
        {
            ["code"] = code,
            ["field"] = field,
            ["severity"] = severity,
            ["message"] = message
        });

    private static bool TryGetByPath(JsonElement element, out JsonElement result, params string[] path)
    {
        var current = element;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
            {
                result = default;
                return false;
            }
        }

        result = current;
        return true;
    }

    private static string? ReadString(JsonElement element, params string[] path) =>
        TryGetByPath(element, out var current, path) && current.ValueKind == JsonValueKind.String
            ? current.GetString()
            : null;
}
