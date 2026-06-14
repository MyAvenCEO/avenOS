namespace Aven.Resources.Llm.Contracts.Commands;

public sealed record ProviderFileGetOrCreateCommand(string ProviderName, ArtifactSourceDescriptor Artifact, string Purpose, string TransportMode);
