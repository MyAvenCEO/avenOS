namespace Aven.Toolkit.Metadata;

public record MetadataQueryResult(
    IReadOnlyList<MetadataRecord> Records,
    bool TimedOut,
    int AppliedLimit);
