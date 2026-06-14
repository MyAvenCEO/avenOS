using System.Globalization;

namespace Aven.Roles.Accounting.Normalization;

/// <summary>Normalizes free-form date strings to ISO-8601 <c>yyyy-MM-dd</c>.</summary>
internal static class AccountingDateNormalizer
{
    private static readonly string[] ExplicitFormats =
    [
        "yyyy-MM-dd", "yyyy/MM/dd", "dd.MM.yyyy", "d.M.yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "dd-MM-yyyy", "yyyyMMdd"
    ];

    /// <summary>
    /// Returns the ISO date for a parseable input, null when the input was empty/absent, and sets
    /// <paramref name="unparseable"/> when a non-empty value could not be interpreted as a date.
    /// </summary>
    public static string? Normalize(string? raw, out bool unparseable)
    {
        unparseable = false;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var trimmed = raw.Trim();
        if (DateOnly.TryParseExact(trimmed, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var iso))
        {
            return iso.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if (DateOnly.TryParseExact(trimmed, ExplicitFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var explicitDate))
        {
            return explicitDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if (DateOnly.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            return parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        unparseable = true;
        return null;
    }
}
