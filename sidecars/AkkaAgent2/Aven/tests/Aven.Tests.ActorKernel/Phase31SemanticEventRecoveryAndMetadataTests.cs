using Akka.Actor;
using Akka.Configuration;
using System.Text;
using Aven.RoleAgents;
using Aven.Akka.Hosting;
using Aven.Submission;
using Aven.Resources.Metadata;
using Aven.Resources.Llm;
using Aven.Toolkit.Core.Serialization;
using Aven.ActorKernel.Addressing;

namespace Aven.Tests.ActorKernel;

public sealed class Phase31SemanticEventRecoveryAndMetadataTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase31-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public async Task RepresentativeSemanticEvents_PublishCanonicalPayloadHashes()
    {
        await WithSystem(async system =>
        {
            var probe = system.ActorOf(Props.Create(() => new EnvelopeProbeActor()), "phase31-envelope-probe");
            var serializer = new CanonicalJsonSerializer();

            var deliveryResolver = new LocalActorAddressRegistry();
            var deliveryEnvelope = new AvenEnvelope<string>(
                new CommandId("cmd-phase31-delivery"),
                new MessageId("msg-phase31-delivery"),
                new ActorAddress("sender/a", "local"),
                new ActorAddress("recipient/missing", "local"),
                new ActorAddress("reply/a", "local"),
                new CorrelationId("corr-phase31-delivery"),
                "demo.message",
                1,
                "{\"hello\":\"delivery\"}",
                null,
                null,
                DateTimeOffset.UtcNow);
            var delivery = system.ActorOf(Props.Create(() => new DurableDeliveryActor(
                "phase31/delivery",
                new DeliveryId("delivery-phase31"),
                new ActorAddress("owner/a", "local"),
                deliveryEnvelope,
                PersistedCommandPayload.FromInlineJson(deliveryEnvelope.Payload).Hash,
                deliveryResolver)), "phase31-delivery");
            await delivery.Ask<DeliveryState>(new DeliveryInspect(), TimeSpan.FromSeconds(5));

            var phase31Registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
            var routingActor = system.ActorOf(
                Props.Create(() => new Aven.Routing.Actors.RoleRouterActor("phase31/routing-actor", phase31Registry, UnusedPhase31IntakeFactory)),
                "phase31-routing-actor");
            var routingAttemptId = new RoutingAttemptId("phase31-routing");
            var routingRecord = new RouteAttemptRecord(
                routingAttemptId,
                new RouteInput(
                    routingAttemptId,
                    "invoice.pdf",
                    "pdf",
                    Array.Empty<string>(),
                    "invoice summary",
                    "accounting.invoice",
                    "route invoices",
                    new[] { new SchemaRef("schema://accounting/invoice@3") },
                    new CorrelationId("corr-phase31-routing"),
                    new ActorAddress("reply/routing", "local")),
                RouteAttemptStatus.Routed,
                new[]
                {
                    new RouteAuditEntry(
                        new RoleAgentId("agent-accountant"),
                        "accountant",
                        new WorkOfferId("offer-phase31"),
                        "accepted",
                        "accepted invoice")
                },
                new RoleAgentId("agent-accountant"),
                new WorkClaimId("claim-phase31"),
                null);
            await routingActor.Ask<RouteAttemptRecord>(new RecordRouteAttemptCommand(routingRecord), TimeSpan.FromSeconds(5));

            var intakeResolver = new LocalActorAddressRegistry();
            var intakeGatewayAddress = new ActorAddress("agent/phase31-accountant", "local");
            var intakeRecipient = system.ActorOf(Props.Create(() => new NullRecipientActor(intakeGatewayAddress)), "phase31-intake-recipient");
            intakeResolver.Register(intakeGatewayAddress, intakeRecipient);
            var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
            var profile = new RoleAgentProfile(
                new RoleAgentId("agent-phase31-accountant"),
                "accountant",
                "Accountant",
                "Handle invoices",
                "Accounting",
                new[] { "pdf" },
                new[] { new SchemaRef("schema://accounting/invoice@3") },
                "Routes invoices",
                new[] { "invoice" },
                new[] { "research" },
                "summary",
                "monthly",
                "running");
            registry.Register(profile);
            var intake = CreateWorkIntakeClient(
                system,
                "phase31/intake/accountant",
                profile.RoleAgentId,
                () => RoleAgentState.Create(profile.RoleAgentId, new RoleDescriptor(profile.RoleName, profile.DisplayName), profile.Objective),
                decisionFactory: (offer, _) => new WorkOfferAcceptedDecision(
                    offer.RoutingAttemptId,
                    offer.OfferId,
                    profile.RoleAgentId,
                    new WorkClaimId($"claim-{offer.OfferId.Value}"),
                    0.99m,
                    "accounting",
                    "accounting.ingest_document",
                    DateTimeOffset.UtcNow.AddMinutes(10),
                    "accepted"),
                resolver: intakeResolver,
                agentGatewayAddress: intakeGatewayAddress);
            var submissionRouterActor = system.ActorOf(
                Props.Create(() => new Aven.Routing.Actors.RoleRouterActor("phase31/submission-routing", registry, _ => intake)),
                "phase31-submission-routing");
            var submissionRouter = new RoleRoutingClient(submissionRouterActor);
            var submissionResolver = new LocalActorAddressRegistry();
            var submission = CreateMessageSubmissionClient(system, submissionResolver, submissionRouter, serializer);
            _ = submission.Submit(new SubmitMessageRequest(
                "idem-phase31",
                "invoice-phase31.pdf",
                "pdf",
                Array.Empty<string>(),
                "invoice summary",
                "accounting.invoice",
                "route to accountant",
                new[] { new SchemaRef("schema://accounting/invoice@3") }));

            var agent = system.ActorOf(Props.Create(() => new RoleAgentActor(
                "phase31/agent",
                new RoleAgentId("agent-phase31"),
                new RoleDescriptor("accountant", "Accountant"),
                "Handle invoices")), "phase31-agent");
            await agent.Ask<StartRoleAgentAccepted>(new StartRoleAgent(), TimeSpan.FromSeconds(5));

            var schedule = system.ActorOf(Props.Create(() => new ScheduledWorkActor(
                "phase31/schedule",
                "schedule-phase31",
                new OperationKey(new ActorAddress("schedule/owner", "local"), new RequestId("phase31-schedule"), "schedule.fire"),
                new CorrelationId("corr-phase31-schedule"),
                DateTimeOffset.UtcNow.AddMinutes(-1),
                null,
                MissedRunPolicy.RunImmediately,
                "{\"task\":\"digest\"}")), "phase31-schedule");
            await schedule.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(5));

            var llmRequest = new LlmRequest(
                new OperationKey(new ActorAddress("caller/a", "local"), new RequestId("phase31-llm"), "llm.generate"),
                new CorrelationId("corr-phase31-llm"),
                new ActorAddress("resource/llm", "local"),
                new ActorAddress("reply/llm", "local"),
                new LlmModelCapabilities("fake-model", true, true, true, true, true, false),
                new LlmInputBlock[] { new TextInputBlock("hello llm") },
                null,
                Array.Empty<ProviderFileDescriptor>(),
                new LlmReasoningOptions(),
                new LlmBudgetLimits(1m, 100, 50),
                new LlmSafetySettings());
            InMemoryLlmProvider.Configure("phase31-llm", new InMemoryLlmResponsePlan(InMemoryLlmScenarioKind.TextSuccess, Text: "ok"));
            var llm = system.ActorOf(Props.Create(() => new LlmRequestWorkerActor("phase31/llm", llmRequest, new InMemoryLlmProvider())), "phase31-llm");
            await llm.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(5));

            var metadataProvider = new MetadataStoreClient(system, "phase31/metadata", ValidateMetadata);
            _ = metadataProvider.Create(new MetadataCreateRequest(
                new OperationKey(new ActorAddress("agent/accountant", "local"), new RequestId("phase31-meta"), "metadata.create"),
                new CorrelationId("corr-phase31-meta"),
                new MetadataSubject(
                    "artifact-revision",
                    "invoice-phase31",
                    new Aven.Toolkit.Core.Identifiers.ArtifactId("artifact-phase31"),
                    new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId("revision-phase31")),
                new SchemaRef("schema://accounting/invoice@3"),
                "{\"invoiceNumber\":\"INV-31\"}",
                "phase31"));

            await Task.Delay(300);
            var envelopes = await probe.Ask<object[]>(new GetEnvelopes(), TimeSpan.FromSeconds(5));

            AssertPayloadHash(envelopes, serializer, "DeliveryInitialized");
            AssertPayloadHash(envelopes, serializer, "MessageSubmitted");
            AssertPayloadHash(envelopes, serializer, "RouteAttemptStarted");
            AssertPayloadHash(envelopes, serializer, "RoleAgentStarted");
            AssertPayloadHash(envelopes, serializer, "ScheduleOccurrenceRecorded");
            AssertPayloadHash(envelopes, serializer, "LlmRequestSucceeded");
            AssertPayloadHash(envelopes, serializer, "MetadataRecordCreated");
        });
    }

    [Fact]
    public async Task ActorBackedMetadataStoreClient_RecoversSemanticStateAcrossRestart()
    {
        await WithSystem(async system =>
        {
            var gateway = new MetadataStoreClient(system, "phase31/metadata-recovery", ValidateMetadata);
            var reply = gateway.Create(new MetadataCreateRequest(
                new OperationKey(new ActorAddress("agent/accountant", "local"), new RequestId("phase31-meta-recovery"), "metadata.create"),
                new CorrelationId("corr-phase31-meta-recovery"),
                new MetadataSubject(
                    "artifact-revision",
                    "invoice-recovery",
                    new Aven.Toolkit.Core.Identifiers.ArtifactId("artifact-recovery"),
                    new Aven.Toolkit.Core.Identifiers.ArtifactRevisionId("revision-recovery")),
                new SchemaRef("schema://accounting/invoice@3"),
                "{\"invoiceNumber\":\"INV-REC\"}",
                "phase31-recovery"));

            Assert.IsType<MetadataCreateSucceeded>(reply);
        });

        await WithSystem(async system =>
        {
            var gateway = new MetadataStoreClient(system, "phase31/metadata-recovery", ValidateMetadata);
            var records = gateway.InspectAll();
            var record = Assert.Single(records);
            Assert.Equal("invoice-recovery", record.Subject.Id);
            Assert.Equal("INV-REC", System.Text.Json.JsonDocument.Parse(record.Json).RootElement.GetProperty("invoiceNumber").GetString());
        });
    }

    [Fact]
    public async Task ActorBackedCapabilityAdmissionClient_RecoversSemanticStateAcrossRestart()
    {
        var grant = new CapabilityGrant(
            new CapabilityId("phase31-cap"),
            new ActorAddress("holder/a", "local"),
            new ActorAddress("target/a", "local"),
            new HashSet<string>(StringComparer.Ordinal) { "artifact.create" },
            new CapabilityConstraints(MaxUses: 2),
            false,
            null,
            DateTimeOffset.UtcNow.AddMinutes(10),
            null);

        await WithSystem(async system =>
        {
            var authority = CreateCapabilityAdmissionClient(system, "phase31/capability");
            authority.UpsertGrant(grant);
            var first = authority.Admit(new CapabilityAdmissionRequest(
                grant.Id,
                new OperationKey(grant.Holder, new RequestId("phase31-cap-1"), "artifact.create"),
                grant.Target,
                "artifact.create",
                DateTimeOffset.UtcNow));
            Assert.IsType<CapabilityAdmitted>(first);
        });

        await WithSystem(async system =>
        {
            var authority = CreateCapabilityAdmissionClient(system, "phase31/capability");
            var second = authority.Admit(new CapabilityAdmissionRequest(
                grant.Id,
                new OperationKey(grant.Holder, new RequestId("phase31-cap-2"), "artifact.create"),
                grant.Target,
                "artifact.create",
                DateTimeOffset.UtcNow));
            Assert.IsType<CapabilityAdmitted>(second);
        });
    }

    private static WorkIntakeClient CreateWorkIntakeClient(
        ActorSystem system,
        string persistenceId,
        RoleAgentId agentId,
        Func<RoleAgentState> agentStateProvider,
        Func<WorkOffer, RoleAgentState, WorkOfferDecision>? decisionFactory = null,
        Aven.ActorKernel.Addressing.IActorAddressResolver? resolver = null,
        ActorAddress? agentGatewayAddress = null)
    {
        var actor = WorkIntakeHost.Start(system, persistenceId, agentId, agentStateProvider, decisionFactory, resolver, agentGatewayAddress);
        return new WorkIntakeClient(actor);
    }

    private static MessageSubmissionClient CreateMessageSubmissionClient(
        ActorSystem system,
        IActorAddressRegistry resolver,
        RoleRoutingClient router,
        CanonicalJsonSerializer serializer,
        string persistenceId = "message-submission")
    {
        var actor = MessageSubmissionHost.Start(system, persistenceId, resolver, router, serializer, persistenceId.Replace('/', '-'));
        return new MessageSubmissionClient(actor);
    }

    private static CapabilityAdmissionClient CreateCapabilityAdmissionClient(ActorSystem system, string persistenceId)
    {
        var actor = CapabilityAdmissionHost.Start(system, persistenceId, persistenceId.Replace('/', '-'));
        return new CapabilityAdmissionClient(actor);
    }

    [Fact]
    public async Task ScheduleRegistryActor_RecoversSemanticStateAcrossRestart()
    {
        var registration = new ScheduledRoleWorkRegistration(
            "schedule-31",
            "request-31",
            "agent-31",
            "local",
            "research.run_digest",
            "{\"paperId\":\"P-31\"}",
            new CorrelationId("corr-phase31-schedule"),
            DateTimeOffset.UtcNow.AddHours(1),
            "Research Watch",
            MissedRunPolicy.RunImmediately.ToString(),
            TimeSpan.FromDays(7).ToString());

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new ScheduleRegistryActor("phase31/schedule-registry")), "phase31-schedule-registry-a");
            var reply = await actor.Ask<ScheduledRoleWorkRegistration>(new ScheduleRegistryUpsert(registration), TimeSpan.FromSeconds(5));
            Assert.Equal(registration.ScheduleId, reply.ScheduleId);
        });

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new ScheduleRegistryActor("phase31/schedule-registry")), "phase31-schedule-registry-b");
            var reply = await actor.Ask<ScheduledRoleWorkRegistration?>(new ScheduleRegistryGet(registration.ScheduleId), TimeSpan.FromSeconds(5));
            Assert.NotNull(reply);
            Assert.Equal(registration.TargetOperationType, reply!.TargetOperationType);
            Assert.Equal(registration.CommandPayloadJson, reply.CommandPayloadJson);
        });
    }

    [Fact]
    public async Task LlmSuccess_WithParentReconstructedRequest_RecoversDurableOutputAfterRestart()
    {
        var response = new LlmResponse(
            "rich-provider",
            "rich-model",
            "answer text",
            "{\"answer\":42}",
            [new LlmToolCall("lookup_invoice", "{\"invoiceId\":\"INV-42\"}")],
            null,
            null,
            "reasoning summary",
            ["artifact://source#p=1"],
            new LlmUsage(11, 7, 18, 0.123m),
            "tool_calls_complete",
            [new LlmProviderDegradation("minor_context_trim", "Context was trimmed to fit provider limits.")],
            new SchemaRef("schema://answers/rich@1"),
            true);
        var schemaRef = response.SchemaRef ?? throw new InvalidOperationException("Rich response must carry a schema ref for this recovery test.");
        var request = CreateRichLlmRequest("phase31-rich-llm-recovery", schemaRef);

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new LlmRequestWorkerActor("phase31/rich-llm-recovery", request, new StaticLlmProvider(response))), "phase31-rich-llm-a");
            var reply = Assert.IsType<LlmRequestSucceededReply>(await actor.Ask<object>(new LlmProcessRequest(), TimeSpan.FromSeconds(5)));

            AssertRichResponse(response, reply.Response);
        });

        await WithSystem(async system =>
        {
            // Parent-reconstructed worker recovery contract: LlmRequestRegistered is a summary/trace event.
            // The parent/gateway must recreate the worker with the same LlmRequest constructor argument.
            var actor = system.ActorOf(Props.Create(() => new LlmRequestWorkerActor("phase31/rich-llm-recovery", request, new StaticLlmProvider(response))), "phase31-rich-llm-b");
            var state = await actor.Ask<LlmRequestState>(new LlmInspect(), TimeSpan.FromSeconds(5));

            Assert.Equal(LlmRequestStatus.Succeeded, state.Status);
            Assert.Equal(request.Key, state.Request.Key);
            Assert.Equal(request.Input.Count, state.Request.Input.Count);
            Assert.NotNull(state.Response);
            AssertRichResponse(response, state.Response!);
        });
    }

    [Fact]
    public async Task LlmRequestRegistered_PublishesRequestSummariesWithoutRawConstructorPayloads()
    {
        await WithSystem(async system =>
        {
            var probe = system.ActorOf(Props.Create(() => new EnvelopeProbeActor()), "phase31-llm-registration-probe");
            var schemaRef = new SchemaRef("schema://answers/request-summary@1");
            var request = CreateRichLlmRequest("phase31-llm-registration", schemaRef);
            var actor = system.ActorOf(Props.Create(() => new LlmRequestWorkerActor("phase31/llm-registration", request, new StaticLlmProvider(CreateMinimalRichResponse(schemaRef)))), "phase31-llm-registration");

            await actor.Ask<LlmRequestState>(new LlmInspect(), TimeSpan.FromSeconds(5));
            await Task.Delay(100);

            var envelopes = await probe.Ask<object[]>(new GetEnvelopes(), TimeSpan.FromSeconds(5));
            var registered = Assert.IsType<LlmRequestRegistered>(ReadData(FindEnvelope(envelopes, nameof(LlmRequestRegistered))));

            Assert.Equal(request.Key, registered.Key);
            Assert.Equal(request.CorrelationId, registered.CorrelationId);
            Assert.Equal(request.Adapter, registered.Adapter);
            Assert.Equal(request.ReplyTo, registered.ReplyTo);
            Assert.Equal("static", registered.Provider);
            Assert.Equal(request.Model.ModelName, registered.Model);
            Assert.Contains(registered.InputBlocks, block => block.Kind == LlmBlockKind.Text && block.PayloadHash is not null && block.Role == "user");
            Assert.Contains(registered.InputBlocks, block => block.Kind == LlmBlockKind.DocumentArtifact && block.ArtifactId == new ArtifactId("artifact-request-summary") && block.PayloadHash is not null);
            Assert.Contains(registered.InputBlocks, block => block.Kind == LlmBlockKind.ProviderFile && block.ProviderFileKey == new ProviderFileKey("provider-file-1"));
            Assert.Contains(registered.InputBlocks, block => block.Kind == LlmBlockKind.ToolDefinition && block.Name == "lookup_invoice" && block.PayloadHash is not null);
            Assert.NotNull(registered.StructuredOutput);
            Assert.Equal(schemaRef, registered.StructuredOutput!.SchemaRef);
            Assert.False(string.IsNullOrWhiteSpace(registered.StructuredOutput.SchemaHash));
            Assert.Equal([new ProviderFileKey("provider-file-1")], registered.ProviderFiles);
            Assert.True(registered.Reasoning.EnableReasoningSummary);
            Assert.Equal(2.5m, registered.Budget.MaxCost);
            Assert.False(registered.Safety.AllowPromptOnlyFallback);
            Assert.Equal(new CapabilityId("cap-llm-request-summary"), registered.CapabilityId);
        });
    }

    [Fact]
    public async Task ScheduleOccurrenceRecorded_PublishesCommandPayloadHashAndSize()
    {
        await WithSystem(async system =>
        {
            var probe = system.ActorOf(Props.Create(() => new EnvelopeProbeActor()), "phase31-schedule-payload-probe");
            var schedule = system.ActorOf(Props.Create(() => new ScheduledWorkActor(
                "phase31/schedule-payload-proof",
                "schedule-payload-proof",
                new OperationKey(new ActorAddress("schedule/owner", "local"), new RequestId("phase31-schedule-payload"), "schedule.fire"),
                new CorrelationId("corr-phase31-schedule-payload"),
                DateTimeOffset.UtcNow.AddMinutes(-1),
                null,
                MissedRunPolicy.RunImmediately,
                "{\"task\":\"digest\",\"id\":42}")), "phase31-schedule-payload-proof");

            await schedule.Ask<object>(new CheckScheduleDue(DateTimeOffset.UtcNow), TimeSpan.FromSeconds(5));
            var envelopes = await probe.Ask<object[]>(new GetEnvelopes(), TimeSpan.FromSeconds(5));
            var recorded = Assert.IsType<ScheduleOccurrenceRecorded>(ReadData(FindEnvelope(envelopes, nameof(ScheduleOccurrenceRecorded))));

            var expectedHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(recorded.WorkItem.PayloadJson))).ToLowerInvariant();
            Assert.Equal(expectedHash, recorded.PayloadHash);
            Assert.Equal(Encoding.UTF8.GetByteCount(recorded.WorkItem.PayloadJson), recorded.PayloadSizeBytes);
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        return Task.CompletedTask;
    }

    private async Task WithSystem(Func<ActorSystem, Task> action)
    {
        var system = ActorSystem.Create($"aven-phase31-{Guid.NewGuid():N}", CreateConfig());
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private Config CreateConfig() => ConfigurationFactory.ParseString($$"""
        akka {
          loglevel = WARNING
          stdout-loglevel = WARNING
          persistence {
            journal.plugin = "akka.persistence.journal.sqlite"
            snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
            journal.sqlite {
              class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
              plugin-dispatcher = "akka.actor.default-dispatcher"
              connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
              auto-initialize = on
            }
            snapshot-store.sqlite {
              class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
              plugin-dispatcher = "akka.actor.default-dispatcher"
              connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
              auto-initialize = on
            }
          }
        }
        """);

    private static MetadataValidationResult ValidateMetadata(SchemaRef schemaRef, string json) =>
        schemaRef.Value == "schema://accounting/invoice@3" && json.Contains("invoiceNumber", StringComparison.Ordinal)
            ? MetadataValidationResult.Success
            : MetadataValidationResult.Failure("invalid");

    private static void AssertPayloadHash(IEnumerable<object> envelopes, CanonicalJsonSerializer serializer, string eventType)
    {
        var envelope = envelopes.FirstOrDefault(candidate => ReadMeta(candidate).EventType == eventType);
        Assert.NotNull(envelope);
        var meta = ReadMeta(envelope!);
        var data = ReadData(envelope!);
        Assert.Equal(serializer.Hash(data), meta.PayloadHash);
        Assert.False(string.IsNullOrWhiteSpace(meta.ActorKind));
        Assert.NotEqual(default, meta.OccurredAt);
    }

    private static EventMetadata ReadMeta(object envelope) =>
        (EventMetadata)envelope.GetType().GetProperty(nameof(AvenEventEnvelope<IAvenEvent>.Meta))!.GetValue(envelope)!;

    private static object ReadData(object envelope) =>
        envelope.GetType().GetProperty(nameof(AvenEventEnvelope<IAvenEvent>.Data))!.GetValue(envelope)!;

    private static object FindEnvelope(IEnumerable<object> envelopes, string eventType)
    {
        var envelope = envelopes.FirstOrDefault(candidate => ReadMeta(candidate).EventType == eventType);
        Assert.NotNull(envelope);
        return envelope!;
    }

    private static LlmRequest CreateRichLlmRequest(string requestId, SchemaRef? schemaRef) => new(
        new OperationKey(new ActorAddress("caller/rich", "local"), new RequestId(requestId), "llm.generate"),
        new CorrelationId($"corr-{requestId}"),
        new ActorAddress("resource/llm", "local"),
        new ActorAddress("reply/llm", "local"),
        new LlmModelCapabilities("rich-model", true, true, true, true, true, false),
        new LlmInputBlock[]
        {
            new TextInputBlock("large prompt text that must be summarized by hash only", "user"),
            new ArtifactInputBlock(LlmBlockKind.DocumentArtifact, new ArtifactId("artifact-request-summary"), "application/pdf", "data:application/pdf;base64,JVBERi0x"),
            new ProviderFileInputBlock(new ProviderFileKey("provider-file-1"), "assistants", "provider_file"),
            new ToolDefinitionInputBlock("lookup_invoice", "Lookup an invoice", "{\"type\":\"object\"}")
        },
        schemaRef is null ? null : new StructuredOutputContract(schemaRef.Value, "{\"type\":\"object\"}", true),
        [new ProviderFileDescriptor(new ProviderFileKey("provider-file-1"), new ArtifactId("artifact-request-summary"), "assistants", "provider_file")],
        new LlmReasoningOptions(true, "medium"),
        new LlmBudgetLimits(2.5m, 2000, 800),
        new LlmSafetySettings(false, true),
        new CapabilityId("cap-llm-request-summary"));

    private static LlmResponse CreateMinimalRichResponse(SchemaRef schemaRef) => new(
        "static",
        "rich-model",
        "ok",
        "{}",
        Array.Empty<LlmToolCall>(),
        null,
        null,
        "summary",
        Array.Empty<string>(),
        new LlmUsage(1, 1, 2, 0.01m),
        "stop",
        Array.Empty<LlmProviderDegradation>(),
        schemaRef,
        true);

    private static void AssertRichResponse(LlmResponse expected, LlmResponse actual)
    {
        Assert.Equal(expected.Provider, actual.Provider);
        Assert.Equal(expected.Model, actual.Model);
        Assert.Equal(expected.Text, actual.Text);
        Assert.Equal(expected.StructuredJson, actual.StructuredJson);
        Assert.Equal(expected.ToolCalls, actual.ToolCalls);
        Assert.Equal(expected.Refusal, actual.Refusal);
        Assert.Equal(expected.SafetyBlock, actual.SafetyBlock);
        Assert.Equal(expected.ReasoningSummary, actual.ReasoningSummary);
        Assert.Equal(expected.Citations, actual.Citations);
        Assert.Equal(expected.Usage, actual.Usage);
        Assert.Equal(expected.FinishReason, actual.FinishReason);
        Assert.Equal(expected.Degradations, actual.Degradations);
        Assert.Equal(expected.SchemaRef, actual.SchemaRef);
        Assert.Equal(expected.StructuredOutputValidated, actual.StructuredOutputValidated);
    }

    private static WorkIntakeClient UnusedPhase31IntakeFactory(RoleAgentId _) =>
        throw new InvalidOperationException("Intake factory should not be used in this test.");

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private sealed record GetEnvelopes;

    private sealed class EnvelopeProbeActor : ReceiveActor
    {
        private readonly List<object> _envelopes = new();

        public EnvelopeProbeActor()
        {
            Receive<GetEnvelopes>(_ => Sender.Tell(_envelopes.ToArray()));
            Receive<object>(message =>
            {
                if (message.GetType().IsGenericType
                    && message.GetType().GetGenericTypeDefinition() == typeof(AvenEventEnvelope<>))
                {
                    _envelopes.Add(message);
                }
            });
        }

        protected override void PreStart() => Context.System.EventStream.Subscribe(Self, typeof(object));
        protected override void PostStop() => Context.System.EventStream.Unsubscribe(Self);
    }

    private sealed class NullRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;

        public NullRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer => Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted")));
        }
    }

    private sealed class StaticLlmProvider(LlmResponse response) : ILlmProvider
    {
        public string Name => "static";

        public LlmProviderHealth GetHealth() => new(Name, true, true, "ok", "Static test provider is available.", response.Model);

        public Task<LlmResponse> ExecuteAsync(LlmRequest request, CancellationToken cancellationToken = default) => Task.FromResult(response);
    }
}