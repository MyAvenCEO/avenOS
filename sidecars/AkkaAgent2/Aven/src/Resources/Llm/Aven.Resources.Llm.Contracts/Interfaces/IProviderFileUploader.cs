namespace Aven.Resources.Llm.Contracts.Interfaces;

public interface IProviderFileUploader
{
    Task<ProviderFileDescriptor> UploadProviderFileAsync(ArtifactSourceDescriptor artifact, string purpose, string transportMode, CancellationToken cancellationToken = default);
    ProviderFileDescriptor UploadProviderFile(ArtifactSourceDescriptor artifact, string purpose, string transportMode);
}
