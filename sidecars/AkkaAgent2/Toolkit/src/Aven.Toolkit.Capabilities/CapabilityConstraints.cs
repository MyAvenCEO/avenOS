namespace Aven.Toolkit.Capabilities;

public record CapabilityConstraints(
    int? MaxUses = null,
    decimal? BudgetLimit = null,
    IReadOnlyDictionary<string, string>? Metadata = null)
{
    public virtual bool Equals(CapabilityConstraints? other)
    {
        if (ReferenceEquals(this, other))
        {
            return true;
        }

        if (other is null || EqualityContract != other.EqualityContract)
        {
            return false;
        }

        return MaxUses == other.MaxUses
            && BudgetLimit == other.BudgetLimit
            && MetadataEquals(Metadata, other.Metadata);
    }

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(EqualityContract);
        hash.Add(MaxUses);
        hash.Add(BudgetLimit);

        if (Metadata is not null)
        {
            foreach (var pair in Metadata.OrderBy(static pair => pair.Key, StringComparer.Ordinal))
            {
                hash.Add(pair.Key, StringComparer.Ordinal);
                hash.Add(pair.Value, StringComparer.Ordinal);
            }
        }

        return hash.ToHashCode();
    }

    private static bool MetadataEquals(IReadOnlyDictionary<string, string>? left, IReadOnlyDictionary<string, string>? right)
    {
        if (ReferenceEquals(left, right))
        {
            return true;
        }

        if (left is null || right is null || left.Count != right.Count)
        {
            return false;
        }

        foreach (var pair in left)
        {
            if (!right.TryGetValue(pair.Key, out var value)
                || !string.Equals(pair.Value, value, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }
}
