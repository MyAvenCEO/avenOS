namespace Aven.Api.Runtime;

public sealed record SchemaSummaryView(
    string SchemaRef,
    string FamilyRef,
    int Version,
    string Label,
    int JsonBytes);

public sealed record SchemaDetailView(
    string SchemaRef,
    string FamilyRef,
    int Version,
    string Description,
    DateTimeOffset? RegisteredAt,
    string JsonSchema);

public sealed record SchemaValidationView(
    string SchemaRef,
    bool Valid,
    IReadOnlyList<string> Errors,
    string Json);

public sealed record ArtifactContentView(
    string Filename,
    string MimeType,
    byte[] Bytes);

public sealed record ActorTreeSnapshotView(
    DateTimeOffset CapturedAt,
    ActorTreeNodeView Root);

public sealed record ActorTreeNodeView(
    string Id,
    string Label,
    string Kind,
    string Status,
    IReadOnlyList<ActorTreeNodeView> Children);
