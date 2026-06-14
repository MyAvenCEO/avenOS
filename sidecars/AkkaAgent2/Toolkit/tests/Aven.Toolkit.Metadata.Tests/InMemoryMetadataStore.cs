namespace Aven.Toolkit.Metadata.Tests;

internal sealed class InMemoryMetadataStore
{
    private readonly List<MetadataRecord> _records = new();

    public void Add(MetadataRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        _records.Add(record);
    }

    public MetadataQueryResult Query(MetadataQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);

        var appliedLimit = Math.Clamp(query.Limit, 1, 500);
        var timeout = query.Timeout ?? TimeSpan.FromSeconds(1);
        var deadline = DateTime.UtcNow + timeout;
        var results = new List<MetadataRecord>(appliedLimit);
        var subjectKinds = query.SubjectKinds?
            .Where(static x => !string.IsNullOrWhiteSpace(x))
            .ToHashSet(StringComparer.Ordinal);
        var subjectIds = query.SubjectIds?
            .Where(static x => !string.IsNullOrWhiteSpace(x))
            .ToHashSet(StringComparer.Ordinal);
        var schemaRefs = query.SchemaRefs?.ToHashSet();

        foreach (var record in _records)
        {
            if (DateTime.UtcNow > deadline)
            {
                return new MetadataQueryResult(results, true, appliedLimit);
            }

            if (query.SubjectKind is not null && !StringComparer.Ordinal.Equals(query.SubjectKind, record.Subject.Kind))
            {
                continue;
            }

            if (subjectKinds is { Count: > 0 } && !subjectKinds.Contains(record.Subject.Kind))
            {
                continue;
            }

            if (query.SubjectId is not null && !StringComparer.Ordinal.Equals(query.SubjectId, record.Subject.Id))
            {
                continue;
            }

            if (subjectIds is { Count: > 0 } && !subjectIds.Contains(record.Subject.Id))
            {
                continue;
            }

            if (query.SchemaRef is not null && query.SchemaRef != record.SchemaRef)
            {
                continue;
            }

            if (schemaRefs is { Count: > 0 } && !schemaRefs.Contains(record.SchemaRef))
            {
                continue;
            }

            results.Add(record);
            if (results.Count >= appliedLimit)
            {
                break;
            }
        }

        return new MetadataQueryResult(results, false, appliedLimit);
    }

    public IReadOnlyList<MetadataRecord> InspectAll() => _records.ToArray();
}