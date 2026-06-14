using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Aven.Roles.Accounting.Normalization;

/// <summary>
/// Canonical money representation shared by every accounting <c>@3</c> schema:
/// an exact decimal <see cref="Amount"/>, an ISO-4217 <see cref="Currency"/>, and the
/// integer <see cref="MinorUnits"/> used for exact, currency-aware comparison and summation.
/// </summary>
public sealed record AccountingMoney(decimal Amount, string Currency, long MinorUnits)
{
    /// <summary>Builds a canonical money value, rounding to the currency's minor-unit scale (banker's rounding).</summary>
    public static AccountingMoney FromAmount(decimal amount, string currency)
    {
        var normalizedCurrency = AccountingCurrencies.NormalizeOrUnknown(currency);
        var exponent = AccountingCurrencies.MinorUnitExponent(normalizedCurrency);
        var roundedAmount = decimal.Round(amount, exponent, MidpointRounding.ToEven);
        var minorUnits = (long)decimal.Round(roundedAmount * Pow10(exponent), 0, MidpointRounding.ToEven);
        return new AccountingMoney(roundedAmount, normalizedCurrency, minorUnits);
    }

    /// <summary>Serializable shape stored in metadata: <c>{ amount, currency, minor_units }</c>.</summary>
    public object ToJsonModel() => new
    {
        amount = Amount,
        currency = Currency,
        minor_units = MinorUnits
    };

    private static decimal Pow10(int exponent)
    {
        var result = 1m;
        for (var i = 0; i < exponent; i++)
        {
            result *= 10m;
        }

        return result;
    }
}

/// <summary>ISO-4217 helpers: minor-unit scale per currency and lenient currency/amount parsing.</summary>
internal static class AccountingCurrencies
{
    public const string Unknown = "UNKNOWN";

    // Currencies whose minor-unit exponent differs from the default of 2.
    private static readonly IReadOnlyDictionary<string, int> NonDefaultExponents = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["JPY"] = 0, ["KRW"] = 0, ["CLP"] = 0, ["VND"] = 0, ["ISK"] = 0, ["HUF"] = 0, ["UGX"] = 0, ["XOF"] = 0, ["XAF"] = 0,
        ["BHD"] = 3, ["KWD"] = 3, ["OMR"] = 3, ["TND"] = 3, ["IQD"] = 3, ["JOD"] = 3, ["LYD"] = 3
    };

    private static readonly IReadOnlyDictionary<string, string> SymbolToCode = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["€"] = "EUR", ["$"] = "USD", ["£"] = "GBP", ["¥"] = "JPY", ["₣"] = "CHF", ["₹"] = "INR"
    };

    public static int MinorUnitExponent(string currency) =>
        NonDefaultExponents.TryGetValue(currency, out var exponent) ? exponent : 2;

    /// <summary>Normalizes a raw currency token to an ISO-4217 alpha code, or null when it cannot be resolved.</summary>
    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var trimmed = raw.Trim();
        if (SymbolToCode.TryGetValue(trimmed, out var mapped))
        {
            return mapped;
        }

        var upper = trimmed.ToUpperInvariant();
        return upper.Length == 3 && upper.All(static ch => ch is >= 'A' and <= 'Z') ? upper : null;
    }

    public static string NormalizeOrUnknown(string? raw) => Normalize(raw) ?? Unknown;

    /// <summary>
    /// Reads a money amount from a JSON value, tolerating both numbers and free-text such as
    /// "57,60 €", "$1,234.56", or "(12.00)". Returns false when no amount can be recovered.
    /// </summary>
    public static bool TryParseAmount(JsonElement element, out decimal amount)
    {
        amount = 0m;
        switch (element.ValueKind)
        {
            case JsonValueKind.Number:
                return element.TryGetDecimal(out amount);
            case JsonValueKind.String:
                return TryParseAmountText(element.GetString(), out amount);
            default:
                return false;
        }
    }

    private static bool TryParseAmountText(string? text, out decimal amount)
    {
        amount = 0m;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var negative = text.Contains('(') && text.Contains(')') || text.TrimStart().StartsWith('-');
        var builder = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (char.IsDigit(ch) || ch is '.' or ',')
            {
                builder.Append(ch);
            }
        }

        var digits = builder.ToString();
        if (digits.Length == 0)
        {
            return false;
        }

        var lastDot = digits.LastIndexOf('.');
        var lastComma = digits.LastIndexOf(',');
        // The right-most separator is the decimal point; the other is a grouping separator.
        char decimalSeparator;
        if (lastDot >= 0 && lastComma >= 0)
        {
            decimalSeparator = lastDot > lastComma ? '.' : ',';
        }
        else if (lastComma >= 0)
        {
            // A lone comma is decimal unless it looks like a thousands group ("1,234").
            decimalSeparator = digits.Length - lastComma - 1 == 3 && lastComma == digits.IndexOf(',') ? '.' : ',';
        }
        else
        {
            decimalSeparator = '.';
        }

        var groupingSeparator = decimalSeparator == '.' ? ',' : '.';
        var canonical = digits.Replace(groupingSeparator.ToString(), string.Empty).Replace(decimalSeparator, '.');
        if (!decimal.TryParse(canonical, NumberStyles.Number, CultureInfo.InvariantCulture, out amount))
        {
            return false;
        }

        if (negative && amount > 0)
        {
            amount = -amount;
        }

        return true;
    }
}
