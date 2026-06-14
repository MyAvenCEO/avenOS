using Akka.Actor;
using Aven.ActorKernel;

namespace Aven.Resources.Llm.Actors;

public sealed class ProviderFileRegistryActor : AvenPersistentActor
{
    private sealed record ProviderFileUploadCompleted(string ProviderName, ArtifactSourceDescriptor Artifact, string Purpose, string TransportMode, IActorRef ReplyTo, ProviderFileDescriptor Descriptor);
    private sealed record ProviderFileUploadFailed(IActorRef ReplyTo, Exception Exception);

    private readonly Dictionary<string, ProviderFileDescriptor> _entries = new(StringComparer.Ordinal);
    private readonly IProviderFileUploader? _uploader;

    public ProviderFileRegistryActor(string persistenceId, IProviderFileUploader? uploader = null)
    {
        PersistenceId = persistenceId;
        _uploader = uploader;

        Command<ProviderFileUploadCompleted>(completed =>
        {
            var key = BuildCacheKey(completed.ProviderName, completed.Artifact.Blob, completed.Purpose, completed.TransportMode);
            if (_entries.TryGetValue(key, out var existing))
            {
                completed.ReplyTo.Tell(existing);
                return;
            }

            var evt = new ProviderFileRegisteredForArtifact(
                completed.Descriptor.ProviderFileKey,
                completed.Descriptor.ArtifactId,
                completed.Descriptor.Purpose,
                completed.Descriptor.TransportMode,
                key);
            PersistEvent(evt, MetadataFor<ProviderFileRegisteredForArtifact>(
                new ActorAddress("provider-file-registry", "local"),
                nameof(ProviderFileRegistryActor),
                new CorrelationId($"corr-{completed.Descriptor.ProviderFileKey.Value}"),
                evt), e =>
            {
                Apply(e);
                completed.ReplyTo.Tell(CreateDescriptor(e));
            });
        });
        Command<ProviderFileUploadFailed>(failed => failed.ReplyTo.Tell(new Status.Failure(failed.Exception)));

        Command<ProviderFileGetOrCreateCommand>(command =>
        {
            var key = BuildCacheKey(command.ProviderName, command.Artifact.Blob, command.Purpose, command.TransportMode);
            if (_entries.TryGetValue(key, out var existing))
            {
                Sender.Tell(existing);
                return;
            }

            if (_uploader is not null && RequiresRemoteUpload(command.TransportMode))
            {
                StartUploadAsync(command, Sender);
                return;
            }

            var descriptor = new ProviderFileDescriptor(
                    new ProviderFileKey($"{command.ProviderName}:{command.Artifact.Blob.Hash}:{command.Purpose}:{command.TransportMode}"),
                    new ArtifactId(command.Artifact.Artifact.ArtifactId.Value),
                    command.Purpose,
                    command.TransportMode);

            var replyTo = Sender;
            var evt = new ProviderFileRegisteredForArtifact(
                descriptor.ProviderFileKey,
                descriptor.ArtifactId,
                descriptor.Purpose,
                descriptor.TransportMode,
                key);
            PersistEvent(evt, MetadataFor<ProviderFileRegisteredForArtifact>(
                new ActorAddress("provider-file-registry", "local"),
                nameof(ProviderFileRegistryActor),
                new CorrelationId($"corr-{descriptor.ProviderFileKey.Value}"),
                evt), e =>
            {
                Apply(e);
                replyTo.Tell(CreateDescriptor(e));
            });
        });

        RecoverEvent<ProviderFileRegisteredForArtifact>(Apply);
    }

    public override string PersistenceId { get; }

    private void Apply(ProviderFileRegisteredForArtifact registered)
    {
        _entries[registered.CacheKey] = CreateDescriptor(registered);
    }

    private static ProviderFileDescriptor CreateDescriptor(ProviderFileRegisteredForArtifact registered) =>
        new(registered.ProviderFileKey, registered.ArtifactId, registered.Purpose, registered.TransportMode);

    private static string BuildCacheKey(string providerName, BlobRef blob, string purpose, string transportMode) =>
        string.Join("|", providerName, blob.Algorithm, blob.Hash, blob.SizeBytes, purpose, transportMode);

    private static bool RequiresRemoteUpload(string transportMode) =>
        string.Equals(transportMode, "openai.responses.file_id", StringComparison.OrdinalIgnoreCase);

    private void StartUploadAsync(ProviderFileGetOrCreateCommand command, IActorRef replyTo)
    {
        var self = Self;
        _ = _uploader!.UploadProviderFileAsync(command.Artifact, command.Purpose, command.TransportMode)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new ProviderFileUploadCompleted(command.ProviderName, command.Artifact, command.Purpose, command.TransportMode, replyTo, task.Result)
                    : new ProviderFileUploadFailed(replyTo, task.Exception?.GetBaseException() ?? new InvalidOperationException("Provider file upload failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => self.Tell(task.Result), TaskScheduler.Default);
    }
}
