using System.Text;
using System.Text.Json;
using System.Diagnostics;
using Akka.Actor;
using Aven.Akka.Hosting;
using Aven.Contracts.Messaging;
using Aven.Contracts.Payloads;
using Aven.DurableDelivery.Actors;
using Aven.DurableDelivery.Contracts.Commands;
using Aven.DurableDelivery.Contracts.Enums;
using Aven.DurableDelivery.Contracts.State;
using Aven.Resources.Artifacts;
using Aven.Resources.Artifacts.Contracts;
using Aven.Resources.Artifacts.Gateways;
using Aven.Resources.Runtime.Gateways;
using Aven.Resources.Runtime.Inbox;
using ToolkitArtifactId = Aven.Toolkit.Core.Identifiers.ArtifactId;
using ToolkitArtifactQuery = Aven.Toolkit.Artifacts.ArtifactQuery;
using ToolkitBlobRef = Aven.Toolkit.Artifacts.BlobRef;
using ToolkitFileSystemArtifactBlobStore = Aven.Toolkit.Artifacts.FileSystemArtifactBlobStore;
using ToolkitArtifactBlobStore = Aven.Toolkit.Artifacts.Abstractions.IArtifactBlobStore;

namespace Aven.Tests.Resources;

public sealed class Phase08ArtifactResourceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"aven-phase08-{Guid.NewGuid():N}");
    private readonly string _sqlitePath;
    private readonly string _blobRoot;

    public Phase08ArtifactResourceTests()
    {
        Directory.CreateDirectory(_root);
        _sqlitePath = Path.Combine(_root, "artifacts.sqlite");
        _blobRoot = Path.Combine(_root, "blobs");
    }

    [Fact]
    public async Task BlobWrite_ReturnsSha256BlobRef()
    {
        var store = CreateBlobStore();
        var bytes = Encoding.UTF8.GetBytes("hello artifact");

        var blob = await store.PutAsync("text/plain", bytes);

        Assert.Equal("sha256", blob.Algorithm);
        Assert.Equal(bytes.Length, blob.SizeBytes);
        Assert.Equal(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant(), blob.Hash);
    }

    [Fact]
    public async Task BlobRead_AfterReopen_ReturnsOriginalBytes()
    {
        var bytes = Encoding.UTF8.GetBytes("reopen me");
        var blob = await CreateBlobStore().PutAsync("text/plain", bytes);

        var loaded = await CreateBlobStore().GetAsync(blob);

        Assert.Equal(bytes, loaded);
    }

    [Fact]
    public async Task IdenticalBytes_ProduceSameBlobRef()
    {
        var store = CreateBlobStore();
        var bytes = Encoding.UTF8.GetBytes("same bytes");

        var first = await store.PutAsync("text/plain", bytes);
        var second = await store.PutAsync("text/plain", bytes);

        Assert.Equal(first, second);
    }

    [Fact]
    public async Task ArtifactCreate_PersistsDescriptorAndCurrentRevision()
    {
        var artifactStore = CreateArtifactStore();
        var blob = await CreateBlobStore().PutAsync("application/json", Encoding.UTF8.GetBytes("{\"invoice\":1}"));

        var created = await artifactStore.CreateArtifactAsync("invoice.json", "application/json", "upload", blob, "initial", CancellationToken.None);
        var descriptor = await artifactStore.GetArtifactAsync(created.ArtifactId, CancellationToken.None);

        Assert.NotNull(descriptor);
        Assert.Equal(created.ArtifactId, descriptor!.ArtifactId);
        Assert.Equal(created.RevisionId, descriptor.CurrentRevisionId);
        Assert.Single(descriptor.Revisions);
    }

    [Fact]
    public async Task AppendRevision_UpdatesCurrentRevision_AndPreservesOldRevision()
    {
        var artifactStore = CreateArtifactStore();
        var blobStore = CreateBlobStore();
        var firstBlob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"v\":1}"));
        var secondBlob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"v\":2}"));

        var created = await artifactStore.CreateArtifactAsync("ledger.json", "application/json", "accounting.ledger", firstBlob, "v1", CancellationToken.None);
        var appended = await artifactStore.AppendRevisionAsync(created.ArtifactId, secondBlob, "v2", CancellationToken.None);
        var descriptor = await artifactStore.GetArtifactAsync(created.ArtifactId, CancellationToken.None);

        Assert.NotNull(descriptor);
        Assert.Equal(appended.RevisionId, descriptor!.CurrentRevisionId);
        Assert.Equal(2, descriptor.Revisions.Count);
        Assert.Equal(firstBlob, descriptor.Revisions[0].Blob);
        Assert.Equal(secondBlob, descriptor.Revisions[1].Blob);
    }

    [Fact]
    public async Task Query_ByFilenameContains_MimeType_AndSourceKind_Works()
    {
        var artifactStore = CreateArtifactStore();
        var blobStore = CreateBlobStore();

        var jsonBlob = await blobStore.PutAsync("application/json", Encoding.UTF8.GetBytes("{\"a\":1}"));
        var pdfBlob = await blobStore.PutAsync("application/pdf", Encoding.UTF8.GetBytes("%PDF-1.4"));
        await artifactStore.CreateArtifactAsync("invoice-100.json", "application/json", "accounting.invoice", jsonBlob, null, CancellationToken.None);
        await artifactStore.CreateArtifactAsync("statement-100.pdf", "application/pdf", "upload", pdfBlob, null, CancellationToken.None);

        Assert.Single(await artifactStore.QueryArtifactsAsync(new ToolkitArtifactQuery("invoice", null, null, null), CancellationToken.None));
        Assert.Single(await artifactStore.QueryArtifactsAsync(new ToolkitArtifactQuery(null, "application/pdf", null, null), CancellationToken.None));
        Assert.Single(await artifactStore.QueryArtifactsAsync(new ToolkitArtifactQuery(null, null, "accounting.invoice", null), CancellationToken.None));
    }

    [Fact]
    public async Task ArtifactAdapter_ReturnsArtifactRefStyleResult()
    {
        using var system = ActorSystem.Create($"phase08-adapter-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact", "local");
        resolver.Register(replyTo, recorder);
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-create-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("adapter"), authority)), "phase08-adapter");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "req-artifact",
            ArtifactId: null,
            Append: false,
            Filename: "invoice.json",
            MimeType: "application/json",
            SourceKind: "accounting.invoice",
            Content: "{\"ok\":true}",
            CapabilityId: "artifact-create-cap"));

        var offer = CreateDeliveryAttemptOffer("artifact.create", replyTo, payload);
        var result = await adapter.Ask<object>(offer, TimeSpan.FromSeconds(5));

        Assert.IsType<DeliveryAccepted>(result);
        var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        using var json = JsonDocument.Parse(resolved.Value.ValueJson);
        Assert.True(json.RootElement.TryGetProperty("artifactId", out _));
        Assert.True(json.RootElement.TryGetProperty("revisionId", out _));
        Assert.True(json.RootElement.TryGetProperty("filename", out _));
        Assert.True(json.RootElement.TryGetProperty("mimeType", out _));
        Assert.False(json.RootElement.TryGetProperty("storageRef", out _));
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ArtifactAdapter_CreateWithExplicitArtifactId_PreservesId_AndAppendTargetsSameArtifact()
    {
        using var system = ActorSystem.Create($"phase08-explicit-id-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-explicit-id-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-explicit-id", "local");
        resolver.Register(replyTo, recorder);
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "ledger-create-test-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));
        authority.UpsertGrant(CreateGrant(
            id: "ledger-append-cap-test",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.append"]));

        var artifactStore = CreateArtifactStore();
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(artifactStore, resolver, CreateBlobStore(), CreateInboxStore("explicit-id-adapter"), authority)), "phase08-explicit-id-adapter");

        var createPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "ledger-create",
            ArtifactId: new ArtifactId("resource-test-artifact"),
            Append: false,
            Filename: "ledger-r1.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\",\"status\":\"open\"}",
            CapabilityId: "ledger-create-test-cap"));

        var appendPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "ledger-append",
            ArtifactId: new ArtifactId("resource-test-artifact"),
            Append: true,
            Filename: "ledger-r2.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\",\"status\":\"paid\"}",
            CapabilityId: "ledger-append-cap-test"));

        var createResult = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, createPayload), TimeSpan.FromSeconds(5));
        var appendResult = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.append", replyTo, appendPayload), TimeSpan.FromSeconds(5));

        Assert.IsType<DeliveryAccepted>(createResult);
        Assert.IsType<DeliveryAccepted>(appendResult);

        var resolvedMessages = await WaitForMessagesAsync<OperationResolved>(recorder, 2, TimeSpan.FromSeconds(5));
        var created = Assert.Single(resolvedMessages, x => x.Key.RequestId.Value == "ledger-create");
        var appended = Assert.Single(resolvedMessages, x => x.Key.RequestId.Value == "ledger-append");

        using (var createdJson = JsonDocument.Parse(created.Value.ValueJson))
        {
            Assert.Equal("resource-test-artifact", createdJson.RootElement.GetProperty("artifactId").GetString());
        }

        using (var appendedJson = JsonDocument.Parse(appended.Value.ValueJson))
        {
            Assert.Equal("resource-test-artifact", appendedJson.RootElement.GetProperty("artifactId").GetString());
        }

        var descriptor = await artifactStore.GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact"), CancellationToken.None);
        Assert.NotNull(descriptor);
        Assert.Equal(2, descriptor!.Revisions.Count);
        using var appendJson = JsonDocument.Parse(appended.Value.ValueJson);
        Assert.Equal(appendJson.RootElement.GetProperty("revisionId").GetString(), descriptor.CurrentRevisionId.Value);
    }

    [Fact]
    public async Task ResourceOperationInbox_DuplicateSamePayload_IsIdempotentlyAccepted()
    {
        using var system = ActorSystem.Create($"phase08-duplicate-same-payload-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-duplicate-same-payload-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-duplicate-same-payload", "local");
        resolver.Register(replyTo, recorder);

        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-duplicate-same-payload-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var blobStore = new CountingBlobStore(CreateBlobStore());
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, blobStore, CreateInboxStore("duplicate-same-payload"), authority)), "phase08-duplicate-same-payload-adapter");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-duplicate-same-payload",
            ArtifactId: new ArtifactId("artifact-duplicate-same-payload"),
            Append: false,
            Filename: "artifact.json",
            MimeType: "application/json",
            SourceKind: "test.artifact",
            Content: "{\"value\":1}",
            CapabilityId: "artifact-duplicate-same-payload-cap"));

        var first = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, payload), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", first.AcceptanceKind);
        var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact-duplicate-same-payload", resolved.Key.RequestId.Value);

        var second = Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, payload), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_recorded", second.AcceptanceKind);

        await AssertEventually(async () => Assert.Equal(1, blobStore.PutCallCount));
        var messages = await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.Single(messages.OfType<OperationResolved>());
    }

    [Fact]
    public async Task ResourceOperationInbox_DifferentPayloadSameOperationKey_IsRejectedAsConflict()
    {
        using var system = ActorSystem.Create($"phase08-conflict-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-conflict-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-conflict", "local");
        resolver.Register(replyTo, recorder);

        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-conflict-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var blobStore = new CountingBlobStore(CreateBlobStore());
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, blobStore, CreateInboxStore("conflict"), authority)), "phase08-conflict-adapter");

        var firstPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-conflict",
            ArtifactId: new ArtifactId("artifact-conflict"),
            Append: false,
            Filename: "artifact.json",
            MimeType: "application/json",
            SourceKind: "test.artifact",
            Content: "{\"value\":1}",
            CapabilityId: "artifact-conflict-cap"));
        var secondPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-conflict",
            ArtifactId: new ArtifactId("artifact-conflict"),
            Append: false,
            Filename: "artifact.json",
            MimeType: "application/json",
            SourceKind: "test.artifact",
            Content: "{\"value\":2}",
            CapabilityId: "artifact-conflict-cap"));

        Assert.IsType<DeliveryAccepted>(await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, firstPayload), TimeSpan.FromSeconds(5)));
        _ = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, secondPayload), TimeSpan.FromSeconds(5)));
        Assert.Equal("resource_operation_conflict", rejected.Error.Code);
        await AssertEventually(async () => Assert.Equal(1, blobStore.PutCallCount));
    }

    [Fact]
    public async Task ResourceOperationInbox_RecoverPendingArtifactOperation_CompletesWithoutRedelivery()
    {
        using var system = ActorSystem.Create($"phase08-recover-pending-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-recover-pending-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-recover-pending", "local");
        resolver.Register(replyTo, recorder);

        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-recover-pending-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var inboxStore = CreateInboxStore("recover-pending");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-recover-pending",
            ArtifactId: new ArtifactId("artifact-recover-pending"),
            Append: false,
            Filename: "artifact.json",
            MimeType: "application/json",
            SourceKind: "test.artifact",
            Content: "{\"value\":1}",
            CapabilityId: "artifact-recover-pending-cap"));
        await inboxStore.RecordIntentAsync(new ResourceOperationInboxRecord(
            "local|role-agent/test|artifact-recover-pending|artifact.create",
            "role-agent/test",
            "local",
            "artifact-recover-pending",
            "artifact.create",
            "artifact",
            "resource/artifact",
            "local",
            replyTo.Value,
            replyTo.Protocol,
            "corr-recover-pending",
            payload,
            payload,
            ResourceOperationInboxStatus.Recorded,
            DateTimeOffset.UtcNow,
            null,
            null,
            null,
            null,
            0));

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), inboxStore, authority)), "phase08-recover-pending-adapter");
        adapter.Tell(new RecoverResourceOperations());

        var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact-recover-pending", resolved.Key.RequestId.Value);

        var messages = await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
        Assert.DoesNotContain(messages, static message => message is DeliveryAccepted);
    }

    [Fact]
    public async Task ResourceOperationInbox_UnresolvedOwnerOnRecovery_MarksFailed()
    {
        using var system = ActorSystem.Create($"phase08-recover-unresolved-owner-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var inboxStore = CreateInboxStore("recover-unresolved-owner");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-recover-unresolved-owner",
            ArtifactId: new ArtifactId("artifact-recover-unresolved-owner"),
            Append: false,
            Filename: "artifact.json",
            MimeType: "application/json",
            SourceKind: "test.artifact",
            Content: "{\"value\":1}",
            CapabilityId: null));
        const string operationKey = "local|role-agent/test|artifact-recover-unresolved-owner|artifact.create";
        await inboxStore.RecordIntentAsync(new ResourceOperationInboxRecord(
            operationKey,
            "role-agent/test",
            "local",
            "artifact-recover-unresolved-owner",
            "artifact.create",
            "artifact",
            "resource/artifact",
            "local",
            "tests/replies/missing-owner",
            "local",
            "corr-recover-unresolved-owner",
            payload,
            payload,
            ResourceOperationInboxStatus.Recorded,
            DateTimeOffset.UtcNow,
            null,
            null,
            null,
            null,
            0));

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), inboxStore, null)), "phase08-recover-unresolved-owner-adapter");
        adapter.Tell(new RecoverResourceOperations());

        await AssertEventually(async () =>
        {
            var updated = await inboxStore.GetAsync(operationKey, CancellationToken.None);
            Assert.NotNull(updated);
            Assert.Equal(ResourceOperationInboxStatus.Failed, updated!.Status);
            Assert.Equal("resource_owner_unresolved_after_recovery", updated.LastErrorCode);
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ArtifactAdapter_RejectsWriteWhenCapabilityIdIsMissing()
    {
        using var system = ActorSystem.Create($"phase08-capability-missing-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-capability-missing-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-capability-missing", "local");
        resolver.Register(replyTo, recorder);

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("capability-missing-adapter"), new InMemoryCapabilityAdmissionClient())), "phase08-capability-missing-adapter");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "ledger-create-no-capability",
            ArtifactId: new ArtifactId("resource-test-artifact-no-capability"),
            Append: false,
            Filename: "ledger.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\"}",
            CapabilityId: null));

        var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, payload), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("capability_required", rejected.Error.Code);
        Assert.Empty(await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1)));
        Assert.Null(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact-no-capability"), CancellationToken.None));
        Assert.Equal(0, CountBlobFiles());
    }

    [Fact]
    public async Task ArtifactAdapter_UsesEnvelopeCapabilityId_WhenPayloadCapabilityIdIsMissing()
    {
        using var system = ActorSystem.Create($"phase08-envelope-capability-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-envelope-capability-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-envelope-capability", "local");
        resolver.Register(replyTo, recorder);
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-envelope-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var inboxStore = CreateInboxStore("artifact-envelope-capability");
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), inboxStore, authority)), "phase08-envelope-capability-adapter");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "ledger-create-envelope-capability",
            ArtifactId: new ArtifactId("resource-test-artifact-envelope-capability"),
            Append: false,
            Filename: "ledger.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\"}",
            CapabilityId: null));

        var offer = CreateDeliveryAttemptOffer("artifact.create", replyTo, payload);
        var envelope = offer with
        {
            Envelope = offer.Envelope with { CapabilityId = new CapabilityId("artifact-envelope-cap") }
        };

        var result = await adapter.Ask<object>(envelope, TimeSpan.FromSeconds(5));

        Assert.IsType<DeliveryAccepted>(result);
        _ = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        Assert.NotNull(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact-envelope-capability"), CancellationToken.None));
        Assert.True(CountBlobFiles() > 0);

        var recorded = await inboxStore.GetAsync("local|role-agent/test|ledger-create-envelope-capability|artifact.create", CancellationToken.None);
        Assert.NotNull(recorded);
        Assert.Equal("artifact-envelope-cap", recorded!.ResolvedCapabilityId);
    }

    [Fact]
    public async Task ArtifactAdapter_RejectsWriteWhenPayloadAndEnvelopeCapabilityIdsMismatch()
    {
        using var system = ActorSystem.Create($"phase08-capability-id-mismatch-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-capability-id-mismatch-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-capability-id-mismatch", "local");
        resolver.Register(replyTo, recorder);
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-envelope-cap-mismatch",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("artifact-capability-id-mismatch"), authority)), "phase08-capability-id-mismatch-adapter");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "ledger-create-capability-id-mismatch",
            ArtifactId: new ArtifactId("resource-test-artifact-capability-id-mismatch"),
            Append: false,
            Filename: "ledger.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\"}",
            CapabilityId: "artifact-payload-cap-mismatch"));

        var originalOffer = CreateDeliveryAttemptOffer("artifact.create", replyTo, payload);
        var offer = originalOffer with
        {
            Envelope = originalOffer.Envelope with { CapabilityId = new CapabilityId("artifact-envelope-cap-mismatch") }
        };

        var rejected = Assert.IsType<DeliveryRejected>(await adapter.Ask<object>(offer, TimeSpan.FromSeconds(5)));
        Assert.Equal("capability_id_mismatch", rejected.Error.Code);
        Assert.Empty(await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public async Task ArtifactAdapter_RecoverPendingOperation_UsesPersistedResolvedCapabilityId()
    {
        using var system = ActorSystem.Create($"phase08-recover-envelope-capability-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-recover-envelope-capability-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-recover-envelope-capability", "local");
        resolver.Register(replyTo, recorder);

        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-envelope-cap-recovery",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var inboxStore = CreateInboxStore("recover-envelope-capability");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-recover-envelope-capability",
            ArtifactId: new ArtifactId("artifact-recover-envelope-capability"),
            Append: false,
            Filename: "artifact.json",
            MimeType: "application/json",
            SourceKind: "test.artifact",
            Content: "{\"value\":1}",
            CapabilityId: null));
        await inboxStore.RecordIntentAsync(new ResourceOperationInboxRecord(
            "local|role-agent/test|artifact-recover-envelope-capability|artifact.create",
            "role-agent/test",
            "local",
            "artifact-recover-envelope-capability",
            "artifact.create",
            "artifact",
            "resource/artifact",
            "local",
            replyTo.Value,
            replyTo.Protocol,
            "corr-recover-envelope-capability",
            payload,
            payload,
            ResourceOperationInboxStatus.Recorded,
            DateTimeOffset.UtcNow,
            null,
            null,
            null,
            null,
            0,
            "artifact-envelope-cap-recovery"));

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), inboxStore, authority)), "phase08-recover-envelope-capability-adapter");
        adapter.Tell(new RecoverResourceOperations());

        var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact-recover-envelope-capability", resolved.Key.RequestId.Value);
        Assert.NotNull(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("artifact-recover-envelope-capability"), CancellationToken.None));
    }

    [Fact]
    public async Task ArtifactAdapter_RejectsWriteWhenCapabilityGrantIsUnknown()
    {
        using var system = ActorSystem.Create($"phase08-capability-unknown-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-capability-unknown-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-capability-unknown", "local");
        resolver.Register(replyTo, recorder);
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("capability-unknown-adapter"), new InMemoryCapabilityAdmissionClient())), "phase08-capability-unknown-adapter");

        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "ledger-create-unknown-capability",
            ArtifactId: new ArtifactId("resource-test-artifact-unknown-capability"),
            Append: false,
            Filename: "ledger.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\"}",
            CapabilityId: "missing-capability"));

        var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, payload), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("capability_missing", rejected.Error.Code);
        Assert.Empty(await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1)));
        Assert.Null(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact-unknown-capability"), CancellationToken.None));
        Assert.Equal(0, CountBlobFiles());
    }

    [Fact]
    public async Task ArtifactAdapter_RejectsWriteWhenCapabilityHolderTargetOrMessageTypeMismatch()
    {
        using var system = ActorSystem.Create($"phase08-capability-mismatch-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-capability-mismatch-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-capability-mismatch", "local");
        resolver.Register(replyTo, recorder);
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "cap-wrong-holder",
            holder: new ActorAddress("another-agent", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));
        authority.UpsertGrant(CreateGrant(
            id: "cap-wrong-target",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/metadata", "local"),
            messageTypes: ["artifact.create"]));
        authority.UpsertGrant(CreateGrant(
            id: "cap-wrong-message",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.append"]));

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("capability-mismatch-adapter"), authority)), "phase08-capability-mismatch-adapter");

        async Task<DeliveryRejected> RunAsync(string capabilityId, string artifactId)
        {
            var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
                RequestId: $"req-{capabilityId}",
                ArtifactId: new ArtifactId(artifactId),
                Append: false,
                Filename: "ledger.json",
                MimeType: "application/json",
                SourceKind: "accounting.ledger",
                Content: "{\"recordId\":\"RESOURCE-TEST-1\"}",
                CapabilityId: capabilityId));

            return Assert.IsType<DeliveryRejected>(await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, payload), TimeSpan.FromSeconds(5)));
        }

        Assert.Equal("capability_wrong_holder", (await RunAsync("cap-wrong-holder", "artifact-wrong-holder")).Error.Code);
        Assert.Equal("capability_wrong_target", (await RunAsync("cap-wrong-target", "artifact-wrong-target")).Error.Code);
        Assert.Equal("capability_message_not_allowed", (await RunAsync("cap-wrong-message", "artifact-wrong-message")).Error.Code);
        Assert.Empty(await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1)));
        Assert.Null(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("artifact-wrong-holder"), CancellationToken.None));
        Assert.Null(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("artifact-wrong-target"), CancellationToken.None));
        Assert.Null(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("artifact-wrong-message"), CancellationToken.None));
        Assert.Equal(0, CountBlobFiles());
    }

    [Fact]
    public async Task ArtifactAdapter_RejectsWriteWhenReplyTargetIsUnresolved_WithoutBlobOrArtifactSideEffects()
    {
        using var system = ActorSystem.Create($"phase08-reply-unresolved-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-valid-unresolved-reply",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("reply-unresolved-adapter"), authority)), "phase08-reply-unresolved-adapter");

        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-reply-unresolved",
            ArtifactId: new ArtifactId("artifact-reply-unresolved"),
            Append: false,
            Filename: "ledger.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\"}",
            CapabilityId: "artifact-valid-unresolved-reply"));

        var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", new ActorAddress("tests/replies/artifact-unresolved", "local"), payload), TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<DeliveryRejected>(result);
        Assert.Equal("reply_target_unresolved", rejected.Error.Code);
        Assert.Null(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("artifact-reply-unresolved"), CancellationToken.None));
        Assert.Equal(0, CountBlobFiles());
    }

    [Fact]
    public async Task ArtifactAdapter_AppendMissingArtifactRejectsRetryable_WithoutBlobSideEffect()
    {
        using var system = ActorSystem.Create($"phase08-append-missing-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-append-missing-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-append-missing", "local");
        resolver.Register(replyTo, recorder);
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-append-missing-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.append"]));

        var artifactStore = CreateArtifactStore();
        var blobStore = new CountingBlobStore(CreateBlobStore());
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(artifactStore, resolver, blobStore, CreateInboxStore("append-missing-adapter"), authority)), "phase08-append-missing-adapter");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-append-missing",
            ArtifactId: new ArtifactId("resource-test-artifact"),
            Append: true,
            Filename: "ledger.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\",\"status\":\"paid\"}",
            CapabilityId: "artifact-append-missing-cap"));

        var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.append", replyTo, payload), TimeSpan.FromSeconds(5));

        var accepted = Assert.IsType<DeliveryAccepted>(result);
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);

        var failed = await WaitForMessageAsync<Aven.Contracts.Operations.OperationFailed>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact_missing_retryable", failed.Error.Code);
        Assert.True(failed.Error.Retryable);
        Assert.Null(await artifactStore.GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact"), CancellationToken.None));
        Assert.Equal(0, blobStore.PutCallCount);
        Assert.Equal(0, CountBlobFiles());
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ArtifactAdapter_DoesNotBlockMailboxWhileBlobWriteRuns()
    {
        using var system = ActorSystem.Create($"phase08-mailbox-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var firstRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-mailbox-first-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-mailbox", "local");
        resolver.Register(replyTo, firstRecorder);

        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-mailbox-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var blobStore = new BlockingBlobStore();
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, blobStore, CreateInboxStore("mailbox-adapter"), authority)), "phase08-mailbox-adapter");

        var firstPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-mailbox-first",
            ArtifactId: new ArtifactId("artifact-mailbox-first"),
            Append: false,
            Filename: "invoice.json",
            MimeType: "application/json",
            SourceKind: "accounting.invoice",
            Content: "{\"ok\":true}",
            CapabilityId: "artifact-mailbox-cap"));

        var firstTask = adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, firstPayload), TimeSpan.FromSeconds(10));

        await blobStore.WaitUntilFirstPutStartsAsync(TimeSpan.FromSeconds(3));

        var secondStopwatch = Stopwatch.StartNew();
        var secondResult = await adapter.Ask<object>(
            CreateDeliveryAttemptOffer("artifact.create", replyTo, "{not valid json"),
            TimeSpan.FromSeconds(2));
        secondStopwatch.Stop();

        var secondRejected = Assert.IsType<DeliveryRejected>(secondResult);
        Assert.Equal("invalid_artifact_payload", secondRejected.Error.Code);
        Assert.True(
            secondStopwatch.ElapsedMilliseconds < 250,
            $"Expected second ask to complete while first blob write was blocked, but it took {secondStopwatch.ElapsedMilliseconds}ms.");

        blobStore.ReleaseFirstPut();

        var firstAccepted = Assert.IsType<DeliveryAccepted>(await firstTask);
        Assert.Equal("resource_operation_recorded", firstAccepted.AcceptanceKind);

        var resolved = await WaitForMessageAsync<OperationResolved>(firstRecorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact-mailbox-first", resolved.Key.RequestId.Value);
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task ArtifactAdapter_BlobWriteFailure_ReturnsDeliveryRejectedWithoutCrashing()
    {
        using var system = ActorSystem.Create($"phase08-blob-failure-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-blob-failure-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-blob-failure", "local");
        resolver.Register(replyTo, recorder);

        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-blob-failure-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var blobStore = new FailOnceBlobStore(new InvalidOperationException("blob store failed"));
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, blobStore, CreateInboxStore("blob-failure-adapter"), authority)), "phase08-blob-failure-adapter");

        var failingPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-blob-failure-first",
            ArtifactId: new ArtifactId("artifact-blob-failure-first"),
            Append: false,
            Filename: "invoice.json",
            MimeType: "application/json",
            SourceKind: "accounting.invoice",
            Content: "{\"ok\":true}",
            CapabilityId: "artifact-blob-failure-cap"));

        var failedResult = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, failingPayload), TimeSpan.FromSeconds(5));

        var acceptedFailure = Assert.IsType<DeliveryAccepted>(failedResult);
        Assert.Equal("resource_operation_recorded", acceptedFailure.AcceptanceKind);
        var failed = await WaitForMessageAsync<Aven.Contracts.Operations.OperationFailed>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact_write_failed", failed.Error.Code);
        Assert.False(failed.Error.Retryable);

        var successPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-blob-failure-second",
            ArtifactId: new ArtifactId("artifact-blob-failure-second"),
            Append: false,
            Filename: "invoice-2.json",
            MimeType: "application/json",
            SourceKind: "accounting.invoice",
            Content: "{\"ok\":true,\"second\":true}",
            CapabilityId: "artifact-blob-failure-cap"));

        var successResult = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, successPayload), TimeSpan.FromSeconds(5));

        var accepted = Assert.IsType<DeliveryAccepted>(successResult);
        Assert.Equal("resource_operation_recorded", accepted.AcceptanceKind);
        await AssertEventually(async () => Assert.Equal(2, blobStore.PutCallCount));
        var resolved = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact-blob-failure-second", resolved.Key.RequestId.Value);
    }

    [Fact]
    public async Task ArtifactAppendDelivery_AcceptsDurableIntent_AndFailureDoesNotAutoReplayAfterCreateExists()
    {
        using var system = ActorSystem.Create($"phase08-append-race-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var artifactStore = CreateArtifactStore();
        var blobStore = CreateBlobStore();
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "ledger-create-race-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));
        authority.UpsertGrant(CreateGrant(
            id: "ledger-append-cap-race",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.append"]));

        var replyRecorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-append-race-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-append-race", "local");
        resolver.Register(replyTo, replyRecorder);

        var terminalProbe = system.ActorOf(Props.Create(() => new ResourceTerminalSignalProbeActor()), "phase08-append-race-terminal");
        var terminalAddress = new ActorAddress("tests/terminal/artifact-append-race", "local");
        resolver.Register(terminalAddress, terminalProbe);

        var recipientAddress = new ActorAddress("resource/artifact", "local");
        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(artifactStore, resolver, blobStore, CreateInboxStore("append-race-adapter"), authority)), "phase08-append-race-adapter");
        resolver.Register(recipientAddress, adapter);

        var appendPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-append-race",
            ArtifactId: new ArtifactId("resource-test-artifact"),
            Append: true,
            Filename: "ledger-r2.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\",\"status\":\"paid\"}",
            CapabilityId: "ledger-append-cap-race"));

        var appendEnvelope = new AvenEnvelope<string>(
            new CommandId("command-append-race"),
            new MessageId("message-append-race"),
            new ActorAddress("role-agent/test", "local"),
            recipientAddress,
            replyTo,
            new CorrelationId("corr-append-race"),
            "artifact.append",
            1,
            appendPayload,
            null,
            null,
            DateTimeOffset.UtcNow);

        var durableAppend = system.ActorOf(Props.Create(() =>
            new DurableDeliveryActor(
                "phase08-delivery-append-race",
                new DeliveryId("del-append-race"),
                appendEnvelope.Sender,
                appendEnvelope,
                PersistedCommandPayload.FromInlineJson(appendEnvelope.Payload).Hash,
                resolver,
                TimeSpan.FromMilliseconds(50),
                8,
                null,
                terminalAddress)), "phase08-delivery-append-race");

        durableAppend.Tell(new DeliveryStart(new DeliveryId("del-append-race")));

        await AssertEventually(async () =>
        {
            var state = await durableAppend.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Accepted, state.Status);
            Assert.True(state.Attempts >= 1);
        });

        var appendFailure = await WaitForMessageAsync<Aven.Contracts.Operations.OperationFailed>(replyRecorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact_missing_retryable", appendFailure.Error.Code);
        Assert.True(appendFailure.Error.Retryable);
        Assert.Null(await artifactStore.GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact"), CancellationToken.None));
        Assert.Equal(0, CountBlobFiles());

        var createPayload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "artifact-create-race",
            ArtifactId: new ArtifactId("resource-test-artifact"),
            Append: false,
            Filename: "ledger-r1.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\",\"status\":\"open\"}",
            CapabilityId: "ledger-create-race-cap"));

        var createResult = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, createPayload), TimeSpan.FromSeconds(5));
        Assert.IsType<DeliveryAccepted>(createResult);
        var createResolved = await WaitForMessageAsync<OperationResolved>(replyRecorder, TimeSpan.FromSeconds(5));
        Assert.Equal("artifact-create-race", createResolved.Key.RequestId.Value);

        await AssertEventually(async () =>
        {
            var state = await durableAppend.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(3));
            Assert.Equal(DeliveryStatus.Accepted, state.Status);
            Assert.True(state.Attempts >= 1);
        });

        var terminal = await terminalProbe.Ask<DeliveryTerminalSignal>(new GetResourceTerminalSignal(), TimeSpan.FromSeconds(3));
        Assert.Equal(new DeliveryId("del-append-race"), terminal.DeliveryId);
        Assert.Equal(DeliveryStatus.Accepted, terminal.State.Status);

        await AssertEventually(async () =>
        {
            var descriptor = await artifactStore.GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact"), CancellationToken.None);
            Assert.NotNull(descriptor);
            Assert.Single(descriptor!.Revisions);
            Assert.Equal(1, CountBlobFiles());
        });
    }

    [Fact]
    public async Task ArtifactAdapter_AdmitsWriteWhenCapabilityGrantIsValid()
    {
        using var system = ActorSystem.Create($"phase08-capability-valid-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var recorder = system.ActorOf(Props.Create(() => new RecordingActor()), "phase08-capability-valid-recorder");
        var replyTo = new ActorAddress("tests/replies/artifact-capability-valid", "local");
        resolver.Register(replyTo, recorder);
        var authority = new InMemoryCapabilityAdmissionClient();
        authority.UpsertGrant(CreateGrant(
            id: "artifact-valid-cap",
            holder: new ActorAddress("role-agent/test", "local"),
            target: new ActorAddress("resource/artifact", "local"),
            messageTypes: ["artifact.create"]));

        var adapter = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("capability-valid-adapter"), authority)), "phase08-capability-valid-adapter");
        var payload = JsonSerializer.Serialize(new ArtifactWriteOperationPayload(
            RequestId: "ledger-create-valid-capability",
            ArtifactId: new ArtifactId("resource-test-artifact-valid-capability"),
            Append: false,
            Filename: "ledger.json",
            MimeType: "application/json",
            SourceKind: "accounting.ledger",
            Content: "{\"recordId\":\"RESOURCE-TEST-1\"}",
            CapabilityId: "artifact-valid-cap"));

        var result = await adapter.Ask<object>(CreateDeliveryAttemptOffer("artifact.create", replyTo, payload), TimeSpan.FromSeconds(5));

        Assert.IsType<DeliveryAccepted>(result);
        _ = await WaitForMessageAsync<OperationResolved>(recorder, TimeSpan.FromSeconds(5));
        await AssertEventually(async () =>
        {
            Assert.NotNull(await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId("resource-test-artifact-valid-capability"), CancellationToken.None));
        });
    }

    [Fact]
    public async Task ArtifactGateway_ApiUpload_WritesRawBytesThroughGateway()
    {
        using var system = ActorSystem.Create($"phase08-api-upload-raw-bytes-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var gateway = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, CreateBlobStore(), CreateInboxStore("api-upload-raw-bytes"))), "phase08-api-upload-raw-bytes-gateway");
        var content = new byte[] { 0, 1, 2, 255 };

        var reply = await gateway.Ask<ArtifactGatewayUploadReply>(
            new ArtifactGatewayUploadCommand(
                new RequestId("api-upload-raw-bytes"),
                new ActorAddress("api/artifacts", "http"),
                new CorrelationId("corr-api-upload-raw-bytes"),
                "raw.bin",
                "application/octet-stream",
                "upload",
                content,
                null,
                null),
            TimeSpan.FromSeconds(5));

        var succeeded = Assert.IsType<ArtifactGatewayUploadSucceeded>(reply);
        var descriptor = await CreateArtifactStore().GetArtifactAsync(new ToolkitArtifactId(succeeded.Result.ArtifactId.Value), CancellationToken.None);
        Assert.NotNull(descriptor);
        var revision = Assert.Single(descriptor!.Revisions);
        var loaded = await CreateBlobStore().GetAsync(revision.Blob, CancellationToken.None);
        Assert.Equal(content, loaded);
    }

    [Fact]
    public async Task ArtifactGateway_ApiUpload_MissingCapabilityRejectsBeforeBlobWrite_WhenAdmissionIsConfigured()
    {
        using var system = ActorSystem.Create($"phase08-api-upload-missing-capability-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var blobStore = new CountingBlobStore(CreateBlobStore());
        var gateway = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, blobStore, CreateInboxStore("api-upload-missing-capability"), new InMemoryCapabilityAdmissionClient())), "phase08-api-upload-missing-capability-gateway");

        var reply = await gateway.Ask<ArtifactGatewayUploadReply>(
            new ArtifactGatewayUploadCommand(
                new RequestId("api-upload-missing-capability"),
                new ActorAddress("api/artifacts", "http"),
                new CorrelationId("corr-api-upload-missing-capability"),
                "raw.bin",
                "application/octet-stream",
                "upload",
                new byte[] { 0, 1, 2, 255 },
                null,
                null),
            TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<ArtifactGatewayUploadRejected>(reply);
        Assert.Equal("capability_required", rejected.Error.Code);
        Assert.Equal(0, blobStore.PutCallCount);
    }

    [Fact]
    public async Task ArtifactGateway_ApiUpload_CapabilityRejectedDoesNotWriteBlob()
    {
        using var system = ActorSystem.Create($"phase08-api-upload-capability-rejected-{Guid.NewGuid():N}");
        var resolver = new LocalActorAddressRegistry();
        var blobStore = new CountingBlobStore(CreateBlobStore());
        var authority = new InMemoryCapabilityAdmissionClient();
        var gateway = system.ActorOf(Props.Create(() => new ArtifactGatewayActor(CreateArtifactStore(), resolver, blobStore, CreateInboxStore("api-upload-capability-rejected"), authority)), "phase08-api-upload-capability-rejected-gateway");

        var reply = await gateway.Ask<ArtifactGatewayUploadReply>(
            new ArtifactGatewayUploadCommand(
                new RequestId("api-upload-capability-rejected"),
                new ActorAddress("api/artifacts", "http"),
                new CorrelationId("corr-api-upload-capability-rejected"),
                "raw.bin",
                "application/octet-stream",
                "upload",
                new byte[] { 0, 1, 2, 255 },
                null,
                new CapabilityId("missing-capability")),
            TimeSpan.FromSeconds(5));

        var rejected = Assert.IsType<ArtifactGatewayUploadRejected>(reply);
        Assert.Equal("capability_missing", rejected.Error.Code);
        Assert.Equal(0, blobStore.PutCallCount);
    }

    private static CapabilityGrant CreateGrant(string id, ActorAddress holder, ActorAddress target, params string[] messageTypes) =>
        new(
            new CapabilityId(id),
            holder,
            target,
            messageTypes.ToHashSet(StringComparer.Ordinal),
            new CapabilityConstraints(MaxUses: 10),
            false,
            null,
            DateTimeOffset.UtcNow.AddMinutes(10),
            null);

    private int CountBlobFiles() =>
        Directory.Exists(_blobRoot)
            ? Directory.EnumerateFiles(_blobRoot, "*", SearchOption.AllDirectories).Count()
            : 0;

    private ToolkitFileSystemArtifactBlobStore CreateBlobStore() => new(_blobRoot);

    private SqliteArtifactStore CreateArtifactStore() => new($"Data Source={_sqlitePath}");

    private static ResourceOperationInboxStore CreateInboxStore(string name) =>
        new($"Data Source={Path.Combine(Path.GetTempPath(), $"aven-phase08-inbox-{name}-{Guid.NewGuid():N}.sqlite")}");

    private static DeliveryAttemptOffer CreateDeliveryAttemptOffer(string messageType, ActorAddress replyTo, string payload) =>
        new(
            new DeliveryId($"delivery-{Guid.NewGuid():N}"),
            new AvenEnvelope<string>(
                new CommandId($"command-{Guid.NewGuid():N}"),
                new MessageId($"message-{Guid.NewGuid():N}"),
                new ActorAddress("role-agent/test", "local"),
                new ActorAddress("resource/artifact", "local"),
                replyTo,
                new CorrelationId($"corr-{Guid.NewGuid():N}"),
                messageType,
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            $"payload-{Guid.NewGuid():N}");

    private static async Task<TMessage> WaitForMessageAsync<TMessage>(IActorRef recorder, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var messages = await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
            var match = messages.OfType<TMessage>().FirstOrDefault();
            if (match is not null)
            {
                return match;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"Timed out waiting for {typeof(TMessage).Name}.");
    }

    private static async Task<IReadOnlyList<TMessage>> WaitForMessagesAsync<TMessage>(IActorRef recorder, int expectedCount, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var messages = await recorder.Ask<object[]>(new GetRecordedMessages(), TimeSpan.FromSeconds(1));
            var matches = messages.OfType<TMessage>().ToArray();
            if (matches.Length >= expectedCount)
            {
                return matches;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"Timed out waiting for {expectedCount} messages of type {typeof(TMessage).Name}.");
    }

    private static async Task AssertEventually(Func<Task> assertion, int attempts = 20, int delayMs = 100)
    {
        Exception? last = null;
        for (var i = 0; i < attempts; i++)
        {
            try
            {
                await assertion();
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                await Task.Delay(delayMs);
            }
        }

        throw last ?? new InvalidOperationException("Expected assertion to succeed eventually.");
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private sealed record GetRecordedMessages;

    private sealed record GetResourceTerminalSignal;

    private sealed class RecordingActor : ReceiveActor
    {
        private readonly List<object> _messages = new();

        public RecordingActor()
        {
            Receive<GetRecordedMessages>(_ => Sender.Tell(_messages.ToArray()));
            ReceiveAny(message => _messages.Add(message));
        }
    }

    private sealed class ResourceTerminalSignalProbeActor : ReceiveActor
    {
        private DeliveryTerminalSignal? _signal;

        public ResourceTerminalSignalProbeActor()
        {
            Receive<DeliveryTerminalSignal>(signal => _signal = signal);
            Receive<GetResourceTerminalSignal>(_ => Sender.Tell(_signal ?? throw new InvalidOperationException("No terminal signal captured yet.")));
        }
    }

    private sealed class CountingBlobStore(ToolkitArtifactBlobStore inner) : ToolkitArtifactBlobStore
    {
        public int PutCallCount { get; private set; }

        public async Task<ToolkitBlobRef> PutAsync(string mimeType, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken = default)
        {
            PutCallCount++;
            return await inner.PutAsync(mimeType, bytes, cancellationToken);
        }

        public Task<byte[]> GetAsync(ToolkitBlobRef blob, CancellationToken cancellationToken = default) =>
            inner.GetAsync(blob, cancellationToken);
    }

    private sealed class BlockingBlobStore : ToolkitArtifactBlobStore
    {
        private readonly TaskCompletionSource<bool> _firstPutStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _releaseFirstPut = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _putCallCount;

        public async Task<ToolkitBlobRef> PutAsync(string mimeType, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _putCallCount) == 1)
            {
                _firstPutStarted.TrySetResult(true);
                await _releaseFirstPut.Task.WaitAsync(cancellationToken);
            }

            return new ToolkitBlobRef("sha256", Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes.Span)).ToLowerInvariant(), bytes.Length);
        }

        public Task<byte[]> GetAsync(ToolkitBlobRef blob, CancellationToken cancellationToken = default) =>
            Task.FromResult(Array.Empty<byte>());

        public async Task WaitUntilFirstPutStartsAsync(TimeSpan timeout) =>
            await _firstPutStarted.Task.WaitAsync(timeout);

        public void ReleaseFirstPut() => _releaseFirstPut.TrySetResult(true);
    }

    private sealed class FailOnceBlobStore(Exception exception) : ToolkitArtifactBlobStore
    {
        private int _putCallCount;

        public int PutCallCount => _putCallCount;

        public Task<ToolkitBlobRef> PutAsync(string mimeType, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _putCallCount) == 1)
            {
                return Task.FromException<ToolkitBlobRef>(exception);
            }

            return Task.FromResult(new ToolkitBlobRef(
                "sha256",
                Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes.Span)).ToLowerInvariant(),
                bytes.Length));
        }

        public Task<byte[]> GetAsync(ToolkitBlobRef blob, CancellationToken cancellationToken = default) =>
            Task.FromResult(Array.Empty<byte>());
    }
}