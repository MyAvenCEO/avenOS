using System.Security.Cryptography;
using System.Text;
using Akka.Actor;
using Aven.Resources.Artifacts.Gateways;
using Aven.Resources.Runtime.Gateways;
using Microsoft.Data.Sqlite;
using ArtifactWriteOperationPayload = Aven.Resources.Artifacts.Contracts.ArtifactWriteOperationPayload;
using ArtifactWriteOperationResult = Aven.Resources.Artifacts.Contracts.ArtifactWriteOperationResult;
using ToolkitArtifactDescriptor = Aven.Toolkit.Artifacts.ArtifactDescriptor;

namespace Aven.Resources.Artifacts.Workers;

internal sealed class ArtifactWriteWorkerActor : ReceiveActor
{
    private static readonly TimeSpan AppendExistingArtifactRetryDelay = TimeSpan.FromMilliseconds(50);
    private const int AppendExistingArtifactRetryAttempts = 10;

    public sealed record ExecuteStarted(ResourceGatewayRail<ArtifactWriteOperationPayload>.Started Started);
    public sealed record ExecuteRecovered(ResourceGatewayRail<ArtifactWriteOperationPayload>.Recovered Recovered);
    public sealed record ExecuteUpload(ArtifactGatewayUploadCommand Command, IActorRef ReplyTo);

    public sealed record StartedCompleted(ResourceGatewayRail<ArtifactWriteOperationPayload>.Started Started, ArtifactWriteOperationResult Result);
    public sealed record StartedErrored(ResourceGatewayRail<ArtifactWriteOperationPayload>.Started Started, Exception Exception);
    public sealed record RecoveredCompleted(ResourceGatewayRail<ArtifactWriteOperationPayload>.Recovered Recovered, ArtifactWriteOperationResult Result);
    public sealed record RecoveredErrored(ResourceGatewayRail<ArtifactWriteOperationPayload>.Recovered Recovered, Exception Exception);
    public sealed record UploadCompleted(IActorRef ReplyTo, ArtifactWriteOperationResult Result);
    public sealed record UploadErrored(IActorRef ReplyTo, Exception Exception);

    private readonly IArtifactStore _artifactStore;
    private readonly IArtifactBlobStore _blobStore;
    private readonly IActorRef _gateway;

    public ArtifactWriteWorkerActor(IArtifactStore artifactStore, IArtifactBlobStore blobStore, IActorRef gateway)
    {
        _artifactStore = artifactStore;
        _blobStore = blobStore;
        _gateway = gateway;

        Receive<ExecuteStarted>(message => ExecuteStartedAsync(message.Started));
        Receive<ExecuteRecovered>(message => ExecuteRecoveredAsync(message.Recovered));
        Receive<ExecuteUpload>(message => ExecuteUploadAsync(message.Command, message.ReplyTo));
    }

    private void ExecuteStartedAsync(ResourceGatewayRail<ArtifactWriteOperationPayload>.Started started)
    {
        var gateway = _gateway;
        var self = Self;
        _ = ExecuteArtifactWriteAsync(started.Key, started.Payload)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new StartedCompleted(started, task.Result)
                    : new StartedErrored(started, task.Exception?.GetBaseException() ?? new InvalidOperationException("Artifact write worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void ExecuteRecoveredAsync(ResourceGatewayRail<ArtifactWriteOperationPayload>.Recovered recovered)
    {
        var gateway = _gateway;
        var self = Self;
        _ = ExecuteArtifactWriteAsync(recovered.Key, recovered.Payload)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new RecoveredCompleted(recovered, task.Result)
                    : new RecoveredErrored(recovered, task.Exception?.GetBaseException() ?? new InvalidOperationException("Artifact write worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void ExecuteUploadAsync(ArtifactGatewayUploadCommand command, IActorRef replyTo)
    {
        var gateway = _gateway;
        var self = Self;
        _ = ExecuteArtifactUploadAsync(command)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new UploadCompleted(replyTo, task.Result)
                    : new UploadErrored(replyTo, task.Exception?.GetBaseException() ?? new InvalidOperationException("Artifact upload worker failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private async Task<ArtifactWriteOperationResult> ExecuteArtifactWriteAsync(OperationKey key, ArtifactWriteOperationPayload plan)
    {
        if (plan.Append)
        {
            var appendArtifactId = plan.ArtifactId ?? throw new InvalidOperationException("artifactId is required when append=true.");
            var existingArtifact = await WaitForExistingArtifactAsync(appendArtifactId, CancellationToken.None);
            if (existingArtifact is null)
            {
                throw new ArtifactWriteRejectedException(new OperationError("artifact_missing_retryable", $"Artifact '{appendArtifactId.Value}' was not found.", true));
            }
        }

        var contentBytes = Encoding.UTF8.GetBytes(plan.Content);
        var blob = await _blobStore.PutAsync(plan.MimeType, contentBytes, CancellationToken.None);

        ArtifactRef artifactRef;
        if (plan.Append)
        {
            artifactRef = await _artifactStore.AppendRevisionAsync(
                new Aven.Toolkit.Core.Identifiers.ArtifactId((plan.ArtifactId ?? throw new InvalidOperationException("artifactId is required when append=true.")).Value),
                blob,
                plan.Description,
                CancellationToken.None);
        }
        else
        {
            var createArtifactId = plan.ArtifactId is null
                ? CreateDeterministicArtifactId(key)
                : new Aven.Toolkit.Core.Identifiers.ArtifactId(plan.ArtifactId.Value.Value);

            try
            {
                artifactRef = await _artifactStore.CreateArtifactAsync(
                    plan.Filename,
                    plan.MimeType,
                    plan.SourceKind,
                    blob,
                    plan.Description,
                    CancellationToken.None,
                    createArtifactId);
            }
            catch (SqliteException ex) when (IsUniqueArtifactIdViolation(ex))
            {
                artifactRef = await RecoverExistingArtifactWriteAsync(createArtifactId, plan, blob);
            }
        }

        var descriptor = await _artifactStore.GetArtifactAsync(artifactRef.ArtifactId, CancellationToken.None)
            ?? throw new InvalidOperationException($"Artifact '{artifactRef.ArtifactId.Value}' was not found after write.");
        var revisionId = artifactRef.RevisionId ?? descriptor.CurrentRevisionId;

        return new ArtifactWriteOperationResult(
            new ArtifactId(artifactRef.ArtifactId.Value),
            new ArtifactRevisionId(revisionId.Value),
            descriptor.Filename,
            descriptor.MimeType,
            blob.Hash,
            blob.SizeBytes);
    }

    private async Task<ArtifactWriteOperationResult> ExecuteArtifactUploadAsync(ArtifactGatewayUploadCommand command)
    {
        var blob = await _blobStore.PutAsync(command.MimeType, command.Content, CancellationToken.None);
        var artifactRef = await _artifactStore.CreateArtifactAsync(
            command.Filename,
            command.MimeType,
            command.SourceKind,
            blob,
            command.Description,
            CancellationToken.None);

        return new ArtifactWriteOperationResult(
            new ArtifactId(artifactRef.ArtifactId.Value),
            new ArtifactRevisionId((artifactRef.RevisionId ?? throw new InvalidOperationException("Artifact upload did not produce a revision id.")).Value),
            command.Filename,
            command.MimeType,
            blob.Hash,
            blob.SizeBytes);
    }

    private async Task<ArtifactRef> RecoverExistingArtifactWriteAsync(
        Aven.Toolkit.Core.Identifiers.ArtifactId artifactId,
        ArtifactWriteOperationPayload plan,
        BlobRef blob)
    {
        var descriptor = await _artifactStore.GetArtifactAsync(artifactId, CancellationToken.None);
        if (descriptor is null)
        {
            throw new InvalidOperationException($"Artifact '{artifactId.Value}' conflicted during create but could not be loaded.");
        }

        var currentRevision = descriptor.Revisions.LastOrDefault();
        if (currentRevision is null)
        {
            throw new InvalidOperationException($"Artifact '{artifactId.Value}' exists without revisions.");
        }

        var matchesExisting = StringComparer.Ordinal.Equals(descriptor.Filename, plan.Filename)
            && StringComparer.Ordinal.Equals(descriptor.MimeType, plan.MimeType)
            && StringComparer.Ordinal.Equals(descriptor.SourceKind, plan.SourceKind)
            && StringComparer.Ordinal.Equals(currentRevision.Blob.Algorithm, blob.Algorithm)
            && StringComparer.Ordinal.Equals(currentRevision.Blob.Hash, blob.Hash)
            && currentRevision.Blob.SizeBytes == blob.SizeBytes;

        if (!matchesExisting)
        {
            throw new ArtifactWriteRejectedException(new OperationError(
                "artifact_conflict",
                $"Artifact '{artifactId.Value}' already exists with different content.",
                false));
        }

        return new ArtifactRef(artifactId, descriptor.CurrentRevisionId);
    }

    private static Aven.Toolkit.Core.Identifiers.ArtifactId CreateDeterministicArtifactId(OperationKey key)
    {
        var raw = $"{key.Caller.Protocol}|{key.Caller.Value}|{key.RequestId.Value}|{key.OperationType}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
        return new Aven.Toolkit.Core.Identifiers.ArtifactId($"artifact-{hash[..24]}");
    }

    private static bool IsUniqueArtifactIdViolation(SqliteException ex)
        => ex.SqliteErrorCode == 19
           && ex.Message.Contains("UNIQUE constraint failed: artifacts.artifact_id", StringComparison.Ordinal);

    private async Task<ToolkitArtifactDescriptor?> WaitForExistingArtifactAsync(ArtifactId artifactId, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < AppendExistingArtifactRetryAttempts; attempt++)
        {
            var existingArtifact = await _artifactStore.GetArtifactAsync(new Aven.Toolkit.Core.Identifiers.ArtifactId(artifactId.Value), cancellationToken);
            if (existingArtifact is not null)
            {
                return existingArtifact;
            }

            if (attempt < AppendExistingArtifactRetryAttempts - 1)
            {
                await Task.Delay(AppendExistingArtifactRetryDelay, cancellationToken);
            }
        }

        return null;
    }

    public sealed class ArtifactWriteRejectedException(OperationError error) : Exception(error.Message)
    {
        public OperationError Error { get; } = error;
    }
}
