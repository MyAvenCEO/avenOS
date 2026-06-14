using System.Text.Json;
using Aven.Roles.Accounting.Normalization;

namespace Aven.Tests.RoleAgents;

public sealed class AccountingValueNormalizerTests
{
    private const string InvoiceSource = "schema://accounting/invoice-extraction@1";
    private const string StatementSource = "schema://accounting/account-statement-extraction@1";

    [Fact]
    public void NormalizeInvoice_ConvertsMoneyToCanonicalMinorUnits_AndIsoFields()
    {
        var raw = """
        {
          "header": { "invoice_number": "INV-1", "issue_date": "26.02.2026", "due_date": "2026-03-03", "currency": "EUR" },
          "vendor": { "name": "Hetzner Online GmbH" },
          "totals": { "subtotal": 48.40, "tax_total": 9.20, "invoice_total": 57.60 },
          "total_outstanding": 57.60
        }
        """;

        using var doc = JsonDocument.Parse(AccountingValueNormalizer.NormalizeInvoice(raw, InvoiceSource));
        var root = doc.RootElement;

        Assert.Equal("Hetzner Online GmbH", root.GetProperty("vendor_name").GetString());
        Assert.Equal("INV-1", root.GetProperty("invoice_number").GetString());
        Assert.Equal("EUR", root.GetProperty("currency").GetString());
        // German date normalized to ISO.
        Assert.Equal("2026-02-26", root.GetProperty("issue_date").GetString());

        var total = root.GetProperty("invoice_total");
        Assert.Equal(57.60m, total.GetProperty("amount").GetDecimal());
        Assert.Equal("EUR", total.GetProperty("currency").GetString());
        Assert.Equal(5760, total.GetProperty("minor_units").GetInt64());

        // Raw extraction is preserved for audit; no spurious issues for a self-consistent invoice.
        Assert.True(root.TryGetProperty("source_document", out _));
        Assert.Empty(root.GetProperty("normalization").GetProperty("issues").EnumerateArray());
    }

    [Fact]
    public void NormalizeInvoice_FlagsTotalMismatch_WithoutRewritingFigures()
    {
        var raw = """
        {
          "header": { "invoice_number": "INV-2", "currency": "USD" },
          "vendor": { "name": "Acme" },
          "totals": { "subtotal": 10.00, "tax_total": 2.00, "invoice_total": 99.00 }
        }
        """;

        using var doc = JsonDocument.Parse(AccountingValueNormalizer.NormalizeInvoice(raw, InvoiceSource));
        var root = doc.RootElement;

        // The LLM's figure is preserved, not corrected.
        Assert.Equal(99.00m, root.GetProperty("invoice_total").GetProperty("amount").GetDecimal());
        var codes = root.GetProperty("normalization").GetProperty("issues").EnumerateArray()
            .Select(i => i.GetProperty("code").GetString()).ToArray();
        Assert.Contains("total_mismatch", codes);
    }

    [Fact]
    public void NormalizeInvoice_ParsesMessyStringMoney_AndDefaultsUnknownCurrency()
    {
        var raw = """
        {
          "header": { "invoice_number": "INV-3", "currency": "euro" },
          "vendor": { "name": "Messy" },
          "totals": { "invoice_total": "1.234,56 €" }
        }
        """;

        using var doc = JsonDocument.Parse(AccountingValueNormalizer.NormalizeInvoice(raw, InvoiceSource));
        var root = doc.RootElement;

        var total = root.GetProperty("invoice_total");
        Assert.Equal(1234.56m, total.GetProperty("amount").GetDecimal());
        Assert.Equal(123456, total.GetProperty("minor_units").GetInt64());
        // "euro" is not a valid ISO code -> defaulted, with an issue recorded.
        Assert.Equal("UNKNOWN", root.GetProperty("currency").GetString());
        var codes = root.GetProperty("normalization").GetProperty("issues").EnumerateArray()
            .Select(i => i.GetProperty("code").GetString()).ToArray();
        Assert.Contains("currency_defaulted", codes);
    }

    [Fact]
    public void NormalizeInvoice_HonorsZeroDecimalCurrencyScale()
    {
        var raw = """
        { "header": { "invoice_number": "JP-1", "currency": "JPY" }, "vendor": { "name": "Tokyo" }, "totals": { "invoice_total": 1500 } }
        """;

        using var doc = JsonDocument.Parse(AccountingValueNormalizer.NormalizeInvoice(raw, InvoiceSource));
        var total = doc.RootElement.GetProperty("invoice_total");
        Assert.Equal(1500, total.GetProperty("minor_units").GetInt64());
    }

    [Fact]
    public void NormalizeStatement_NormalizesTransactionMoneyAndDirection()
    {
        var raw = """
        {
          "institution": { "name": "FINOM PAYMENTS B.V." },
          "account_overview": { "iban": "DE03100180000494779244" },
          "currency": "EUR",
          "period_start": "2026-01-01",
          "period_end": "2026-01-31",
          "opening_balance": 100.00,
          "closing_balance": 57.00,
          "transactions": [
            { "transaction_id": "tx-1", "booking_date": "2026-01-05", "amount": -43.00, "description": "Hetzner" }
          ]
        }
        """;

        using var doc = JsonDocument.Parse(AccountingValueNormalizer.NormalizeStatement(raw, StatementSource));
        var root = doc.RootElement;

        Assert.Equal("FINOM PAYMENTS B.V.", root.GetProperty("institution_name").GetString());
        Assert.Equal("DE03100180000494779244", root.GetProperty("account_iban").GetString());
        Assert.Equal(1, root.GetProperty("transaction_count").GetInt64());

        var tx = root.GetProperty("transactions")[0];
        Assert.Equal("debit", tx.GetProperty("direction").GetString());
        var amount = tx.GetProperty("amount");
        Assert.Equal(-43.00m, amount.GetProperty("amount").GetDecimal());
        Assert.Equal(-4300, amount.GetProperty("minor_units").GetInt64());
        Assert.Equal("EUR", amount.GetProperty("currency").GetString());
    }
}
