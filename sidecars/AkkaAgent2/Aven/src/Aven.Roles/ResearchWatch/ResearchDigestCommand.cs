namespace Aven.Roles.ResearchWatch;

public sealed record ResearchDigestCommand(
    ArtifactRef SourceArtifact,
    string SubjectId,
    string Topic,
    DateTimeOffset DueAt,
    string Summary);
