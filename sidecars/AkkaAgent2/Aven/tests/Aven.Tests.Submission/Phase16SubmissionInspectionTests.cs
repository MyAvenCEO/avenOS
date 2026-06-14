using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.ActorKernel.Addressing;
using Aven.Routing.Contracts.Commands;
using Aven.Submission.Actors;
using Aven.Submission.Models;
using Aven.Submission;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Tests.Submission;

public sealed class Phase16SubmissionInspectionTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase16-{Guid.NewGuid():N}.sqlite");
    private RoleRoutingClient? _router;

    [Fact]
    public async Task SameIdempotencyAndBody_ReturnsSameResult()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);

            var first = Assert.IsType<SubmitMessageAccepted>(submission.Submit(CreateInvoiceCommand("idem-same")));
            var second = Assert.IsType<SubmitMessageAccepted>(submission.Submit(CreateInvoiceCommand("idem-same")));

            Assert.False(first.Idempotent);
            Assert.True(second.Idempotent);
            Assert.Equal(first.RoutingAttemptId, second.RoutingAttemptId);
            Assert.Equal(first.Delivery.DeliveryId, second.Delivery.DeliveryId);
            Assert.Equal(first.Decision.Attempt.Status, second.Decision.Attempt.Status);
        });
    }

    [Fact]
    public async Task SameIdempotencyDifferentBody_ReturnsConflict()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);

            _ = Assert.IsType<SubmitMessageAccepted>(submission.Submit(CreateInvoiceCommand("idem-conflict")));
            var conflict = Assert.IsType<SubmitMessageConflict>(submission.Submit(CreateInvoiceCommand("idem-conflict", summary: "different invoice summary")));

            Assert.Equal("idempotency_conflict", conflict.Error.Code);
        });
    }

    [Fact]
    public async Task AcceptedCommand_HasDurableDeliveryRecord()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);

            var reply = submission.Submit(CreateInvoiceCommand("idem-delivery"));
            Assert.True(reply is SubmitMessageAccepted, reply is SubmitMessageRejected rejected ? $"Rejected: {rejected.Error.Code} - {rejected.Error.Message}" : $"Unexpected reply: {reply.GetType().Name}");
            var accepted = (SubmitMessageAccepted)reply;
            var inspection = submission.Inspect();

            Assert.True(inspection.Commands.TryGetValue("idem-delivery", out var record));
            Assert.NotNull(record);
            Assert.Equal(SubmittedMessageStatus.Accepted, record!.Status);
            Assert.NotNull(record.Delivery);
            Assert.Equal(DeliveryStatus.Accepted, record.Delivery!.Status);
            Assert.Equal(accepted.Delivery.DeliveryId, record.Delivery.DeliveryId);
            Assert.Equal("routing/role", record.Delivery.Recipient.Value);
        });
    }

    [Fact]
    public async Task SubmissionAndRouteInspection_StayConsistentForAcceptedCommand()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);
            var router = GetRouter();
            var accepted = Assert.IsType<SubmitMessageAccepted>(submission.Submit(CreateInvoiceCommand("idem-trace")));

            var submissionInspection = submission.Inspect();
            Assert.True(submissionInspection.Commands.TryGetValue("idem-trace", out var commandRecord));
            Assert.NotNull(commandRecord);
            Assert.Equal(accepted.RoutingAttemptId, commandRecord!.RoutingAttemptId);
            Assert.NotNull(commandRecord.Decision);
            Assert.Equal(RouteAttemptStatus.Routed, commandRecord.Decision!.Attempt.Status);
            Assert.NotNull(commandRecord.Delivery);
            Assert.Equal(DeliveryStatus.Accepted, commandRecord.Delivery!.Status);

            var routingAttempt = router.Inspect().Attempts[accepted.RoutingAttemptId];
            Assert.Equal(accepted.RoutingAttemptId, routingAttempt.RoutingAttemptId);
            Assert.Equal(RouteAttemptStatus.Routed, routingAttempt.Status);
            Assert.Contains(routingAttempt.AuditEntries, static entry =>
                string.Equals(entry.DecisionKind, "accepted", StringComparison.OrdinalIgnoreCase)
                || entry.DecisionSummary.Contains("accepted", StringComparison.OrdinalIgnoreCase));
        });
    }

    [Fact]
    public async Task MissingIdempotencyKey_IsRejected()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);
            var rejected = Assert.IsType<SubmitMessageRejected>(submission.Submit(CreateInvoiceCommand(string.Empty)));
            Assert.Equal("missing_idempotency_key", rejected.Error.Code);
        });
    }

    [Fact]
    public async Task ActorBackedSubmission_PersistsIdempotencyAcrossRestart()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);
            var firstReply = submission.Submit(CreateInvoiceCommand("idem-restart"));
            Assert.True(firstReply is SubmitMessageAccepted, firstReply is SubmitMessageRejected rejected ? $"Rejected: {rejected.Error.Code} - {rejected.Error.Message}" : $"Unexpected reply: {firstReply.GetType().Name}");
            var first = (SubmitMessageAccepted)firstReply;
            Assert.False(first.Idempotent);
        });

        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);
            var secondReply = submission.Submit(CreateInvoiceCommand("idem-restart"));
            Assert.True(secondReply is SubmitMessageAccepted, secondReply is SubmitMessageRejected rejected ? $"Rejected: {rejected.Error.Code} - {rejected.Error.Message}" : $"Unexpected reply: {secondReply.GetType().Name}");
            var second = (SubmitMessageAccepted)secondReply;

            Assert.True(second.Idempotent);
            var inspection = submission.Inspect();
            Assert.True(inspection.Commands.TryGetValue("idem-restart", out var record));
            Assert.NotNull(record);
            Assert.Equal(SubmittedMessageStatus.Accepted, record!.Status);
            Assert.NotNull(record.Decision);
            Assert.Equal(RouteAttemptStatus.Routed, record.Decision!.Attempt.Status);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_RoutingDeliveryRejected_TransitionsSubmissionToRejectedAndPersistsAcrossRestart()
    {
        const string persistenceId = "phase16/submission-routing-delivery-rejected";
        const string idempotencyKey = "idem-routing-delivery-rejected";

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var routingRecipient = system.ActorOf(
                Props.Create(() => new RejectingDeliveryRecipientActor(new ActorAddress("routing/role", "local"))),
                $"phase16-routing-rejected-{Guid.NewGuid():N}");
            resolver.Register(new ActorAddress("routing/role", "local"), routingRecipient);

            var actor = CreateSubmissionActor(system, persistenceId, CreateRouter(system), resolver);
            var rejected = Assert.IsType<SubmitMessageRejected>(await SubmitAsync(actor, CreateInvoiceCommand(idempotencyKey)));

            Assert.Equal("delivery_rejected", rejected.Error.Code);

            var inspection = await InspectAsync(actor);
            Assert.True(inspection.Commands.TryGetValue(idempotencyKey, out var record));
            Assert.NotNull(record);
            Assert.Equal(SubmittedMessageStatus.Rejected, record!.Status);
            Assert.NotNull(record.Delivery);
            Assert.Equal(DeliveryStatus.Rejected, record.Delivery!.Status);
            Assert.Equal("delivery_rejected", record.Error?.Code);
        });

        await WithSystem(async system =>
        {
            var actor = CreateSubmissionActor(system, persistenceId, CreateRouter(system), new LocalActorAddressRegistry());

            var inspection = await InspectAsync(actor);
            Assert.True(inspection.Commands.TryGetValue(idempotencyKey, out var record));
            Assert.NotNull(record);
            Assert.Equal(SubmittedMessageStatus.Rejected, record!.Status);
            Assert.NotNull(record.Delivery);
            Assert.Equal(DeliveryStatus.Rejected, record.Delivery!.Status);
            Assert.Equal("delivery_rejected", record.Error?.Code);

            var replay = Assert.IsType<SubmitMessageRejected>(await SubmitAsync(actor, CreateInvoiceCommand(idempotencyKey)));
            Assert.Equal("delivery_rejected", replay.Error.Code);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_NoCandidateAccepted_ReturnsClarificationAndPersistsAcceptedRecord()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);

            var clarification = Assert.IsType<SubmitMessageNeedsClarification>(submission.Submit(CreateCommand(
                "idem-no-candidate-accepts",
                "travel booking confirmation",
                "travel.itinerary")));

            Assert.Contains("could not determine", clarification.Decision.Question, StringComparison.OrdinalIgnoreCase);

            var inspection = submission.Inspect();
            Assert.True(inspection.Commands.TryGetValue("idem-no-candidate-accepts", out var record));
            Assert.NotNull(record);
            Assert.Equal(SubmittedMessageStatus.Accepted, record!.Status);
            Assert.Null(record.Delivery);
            var decision = Assert.IsType<RouteNeedsClarification>(record.Decision);
            Assert.Contains("could not determine", decision.Question, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_RouteNeedsClarification_ReturnsExplicitClarificationResponse()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system, forceBothAccept: true);

            var clarificationResponse = Assert.IsType<SubmitMessageNeedsClarification>(submission.Submit(CreateCommand(
                "idem-clarification",
                "mixed business document",
                "mixed.document")));

            Assert.False(clarificationResponse.Idempotent);
            var clarification = clarificationResponse.Decision;
            Assert.Equal(2, clarification.CandidateRoleAgentIds.Count);

            var inspection = submission.Inspect();
            Assert.True(inspection.Commands.TryGetValue("idem-clarification", out var record));
            Assert.NotNull(record);
            Assert.Equal(SubmittedMessageStatus.Accepted, record!.Status);
            Assert.Null(record.Delivery);
            var persistedClarification = Assert.IsType<RouteNeedsClarification>(record.Decision);
            Assert.Equal(2, persistedClarification.CandidateRoleAgentIds.Count);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_RouteNeedsClarification_IdempotentReplayReturnsExplicitClarificationResponse()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system, forceBothAccept: true);

            var first = Assert.IsType<SubmitMessageNeedsClarification>(submission.Submit(CreateCommand(
                "idem-clarification-replay",
                "mixed business document",
                "mixed.document")));

            var second = Assert.IsType<SubmitMessageNeedsClarification>(submission.Submit(CreateCommand(
                "idem-clarification-replay",
                "mixed business document",
                "mixed.document")));

            Assert.False(first.Idempotent);
            Assert.True(second.Idempotent);
            Assert.Equal(first.RoutingAttemptId, second.RoutingAttemptId);
            Assert.Equal(first.Decision.Question, second.Decision.Question);
            Assert.Equal(first.Decision.CandidateRoleAgentIds, second.Decision.CandidateRoleAgentIds);

            var inspection = submission.Inspect();
            Assert.True(inspection.Commands.TryGetValue("idem-clarification-replay", out var record));
            Assert.NotNull(record);
            Assert.Equal(SubmittedMessageStatus.Accepted, record!.Status);
            Assert.Null(record.Delivery);
            var persistedClarification = Assert.IsType<RouteNeedsClarification>(record.Decision);
            Assert.Equal(2, persistedClarification.CandidateRoleAgentIds.Count);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_RecoversClarificationFromRouterResolutionLookup_WhenSubmissionRecordIsMissing()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system, forceBothAccept: true);

            var first = Assert.IsType<SubmitMessageNeedsClarification>(submission.Submit(CreateCommand(
                "idem-clarification-routing-recovery",
                "mixed business document",
                "mixed.document")));

            Assert.False(first.Idempotent);
        });

        await WithSystem(async system =>
        {
            var router = CreateRouter(system, forceBothAccept: true);
            var resolver = new LocalActorAddressRegistry();
            var submission = CreateMessageSubmissionClient(system, resolver, router, new CanonicalJsonSerializer());

            var replay = Assert.IsType<SubmitMessageNeedsClarification>(submission.Submit(CreateCommand(
                "idem-clarification-routing-recovery",
                "mixed business document",
                "mixed.document")));

            Assert.True(replay.Idempotent);
            Assert.Equal(2, replay.Decision.CandidateRoleAgentIds.Count);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_RecoversAcceptedRouteFromRouterResolutionLookup_WhenSubmissionRecordIsMissing()
    {
        await WithSystem(async system =>
        {
            var submission = CreateSubmissionService(system);

            var first = Assert.IsType<SubmitMessageAccepted>(submission.Submit(CreateInvoiceCommand("idem-accepted-routing-recovery")));
            Assert.False(first.Idempotent);
            Assert.Equal(RouteAttemptStatus.Routed, first.Decision.Attempt.Status);
        });

        await WithSystem(async system =>
        {
            var router = CreateRouter(system);
            var resolver = new LocalActorAddressRegistry();
            var submission = CreateMessageSubmissionClient(system, resolver, router, new CanonicalJsonSerializer());

            var replay = Assert.IsType<SubmitMessageAccepted>(submission.Submit(CreateInvoiceCommand("idem-accepted-routing-recovery")));

            Assert.True(replay.Idempotent);
            Assert.Equal(RouteAttemptStatus.Routed, replay.Decision.Attempt.Status);
            Assert.NotNull(replay.Delivery);
            Assert.Equal(DeliveryStatus.Accepted, replay.Delivery.Status);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_RecoversRejectedRouteFromRouterResolutionLookup_WhenSubmissionRecordIsMissing()
    {
        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var submission = CreateMessageSubmissionClient(system, resolver, new RoleRoutingClient(system.ActorOf(Props.Create(() => new RejectedResolutionRouterActor()))), new CanonicalJsonSerializer());

            var first = Assert.IsType<SubmitMessageRejected>(submission.Submit(CreateInvoiceCommand("idem-rejected-routing-recovery")));

            Assert.Equal("route_rejected", first.Error.Code);
        });

        await WithSystem(async system =>
        {
            var router = new RoleRoutingClient(system.ActorOf(Props.Create(() => new RejectedResolutionRouterActor())));
            var resolver = new LocalActorAddressRegistry();
            var submission = CreateMessageSubmissionClient(system, resolver, router, new CanonicalJsonSerializer());

            var replay = Assert.IsType<SubmitMessageRejected>(submission.Submit(CreateInvoiceCommand("idem-rejected-routing-recovery")));

            Assert.Equal("route_rejected", replay.Error.Code);
        });
    }

    [Fact]
    public async Task MessageSubmissionActor_RouteResolutionMissingAttempt_ReturnsExplicitRejectedResponse()
    {
        const string persistenceId = "phase16/submission-missing-route-inspection";
        const string idempotencyKey = "idem-missing-route-inspection";

        await WithSystem(async system =>
        {
            var resolver = new LocalActorAddressRegistry();
            var routingRecipient = system.ActorOf(
                Props.Create(() => new AcceptingDeliveryRecipientActor(new ActorAddress("routing/role", "local"))),
                $"phase16-routing-accepted-no-inspection-{Guid.NewGuid():N}");
            resolver.Register(new ActorAddress("routing/role", "local"), routingRecipient);

            var emptyRouterActor = system.ActorOf(Props.Create(() => new EmptyInspectionRouterActor()), $"phase16-empty-router-{Guid.NewGuid():N}");

            var actor = CreateSubmissionActor(system, persistenceId, new RoleRoutingClient(emptyRouterActor), resolver);

            var rejected = Assert.IsType<SubmitMessageRejected>(await SubmitAsync(actor, CreateInvoiceCommand(idempotencyKey)));
            Assert.Equal("route_resolution_missing", rejected.Error.Code);

            await AssertEventually(async () =>
            {
                var inspection = await InspectAsync(actor);
                Assert.True(inspection.Commands.TryGetValue(idempotencyKey, out var record));
                Assert.NotNull(record);
                Assert.Equal(SubmittedMessageStatus.Rejected, record!.Status);
                Assert.Equal("route_resolution_missing", record.Error?.Code);
                Assert.NotNull(record.Delivery);
                Assert.Equal(DeliveryStatus.Rejected, record.Delivery!.Status);
            });
        });
    }

    [Fact]
    public void SubmittedMessageProjection_BuildDecision_HandlesRejectedAndClarificationWithoutInventingClaimIds()
    {
        var rejectedProjection = new SubmittedMessageProjection();
        rejectedProjection.Apply(CreateSubmittedEvent("idem-projection-rejected", "travel booking confirmation", "travel.itinerary"));
        rejectedProjection.Apply(new SubmissionRejected(
            "idem-projection-rejected",
            "hash-idem-projection-rejected",
            new RoutingAttemptId("route-idem-projection-rejected"),
            new OperationError("route_rejected", "Routing rejected.", false),
            DateTimeOffset.UtcNow));
        rejectedProjection.Apply(new RouteResolutionRecorded(
            "idem-projection-rejected",
            new RoutingAttemptId("route-idem-projection-rejected"),
            nameof(RouteRejected),
            null,
            null,
            null,
            Array.Empty<RoleAgentId>(),
            "Routing rejected."));

        var rejectedRecord = rejectedProjection.ToRecord();
        Assert.Equal(SubmittedMessageStatus.Rejected, rejectedRecord.Status);
        var rejectedDecision = Assert.IsType<RouteRejected>(rejectedRecord.Decision);
        Assert.Null(rejectedDecision.Attempt.SelectedRoleAgentId);
        Assert.Null(rejectedDecision.Attempt.SelectedClaimId);

        var clarificationProjection = new SubmittedMessageProjection();
        clarificationProjection.Apply(CreateSubmittedEvent("idem-projection-clarification", "mixed business document", "mixed.document"));
        clarificationProjection.Apply(new RouteResolutionRecorded(
            "idem-projection-clarification",
            new RoutingAttemptId("route-idem-projection-clarification"),
            nameof(RouteNeedsClarification),
            null,
            null,
            "Which role should handle this?",
            [new RoleAgentId("agent-accountant"), new RoleAgentId("agent-research")],
            null));

        var clarificationRecord = clarificationProjection.ToRecord();
        Assert.Equal(SubmittedMessageStatus.Accepted, clarificationRecord.Status);
        Assert.Null(clarificationRecord.Delivery);
        var clarificationDecision = Assert.IsType<RouteNeedsClarification>(clarificationRecord.Decision);
        Assert.Equal(2, clarificationDecision.CandidateRoleAgentIds.Count);
        Assert.Null(clarificationDecision.Attempt.SelectedRoleAgentId);
        Assert.Null(clarificationDecision.Attempt.SelectedClaimId);
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

    private MessageSubmissionClient CreateSubmissionService(ActorSystem system, bool forceBothAccept = false, bool rejectAcceptedCommit = false)
    {
        var resolver = new LocalActorAddressRegistry();
        _router = CreateRouter(system, forceBothAccept, rejectAcceptedCommit);
        return CreateMessageSubmissionClient(system, resolver, _router, new CanonicalJsonSerializer());
    }

    private static IActorRef CreateSubmissionActor(ActorSystem system, string persistenceId, RoleRoutingClient router, IActorAddressResolver resolver) =>
        system.ActorOf(
            Props.Create(() => new MessageSubmissionActor(persistenceId, router, new CanonicalJsonSerializer(), resolver)),
            persistenceId.Replace('/', '-'));

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

    private static Task<object> SubmitAsync(IActorRef actor, SubmitMessageRequest command) =>
        actor.Ask<object>(new SubmitMessageCommand(command), TimeSpan.FromSeconds(5));

    private static Task<SubmissionInspection> InspectAsync(IActorRef actor) =>
        actor.Ask<SubmissionInspection>(new InspectSubmissionsCommand(), TimeSpan.FromSeconds(5));

    private RoleRoutingClient GetRouter() => _router ?? throw new InvalidOperationException("Router has not been initialized.");

    private static RoleRoutingClient CreateRouter(ActorSystem system, bool forceBothAccept = false, bool rejectAcceptedCommit = false)
    {
        var accountantId = new RoleAgentId("agent-accountant");
        var researchId = new RoleAgentId("agent-research");
        var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
        var accountantProfile = CreateAccountantProfile(accountantId);
        var researchProfile = CreateResearchProfile(researchId);
        registry.Register(accountantProfile);
        registry.Register(researchProfile);

        var intakes = new Dictionary<RoleAgentId, WorkIntakeClient>
        {
            [accountantId] = CreateIntake(system, accountantProfile, forceBothAccept, rejectAcceptedCommit),
            [researchId] = CreateIntake(system, researchProfile, forceBothAccept, rejectAcceptedCommit)
        };

        var actor = system.ActorOf(
            Props.Create(() => new Aven.Routing.Actors.RoleRouterActor("phase16/routing", registry, agentId => intakes[agentId])),
            "phase16-routing");
        return new RoleRoutingClient(actor);
    }

    private static WorkIntakeClient CreateIntake(ActorSystem system, RoleAgentProfile profile, bool forceBothAccept, bool rejectAcceptedCommit = false)
    {
        var agentState = RoleAgentState.Create(profile.RoleAgentId, new RoleDescriptor(profile.RoleName, profile.DisplayName), profile.Objective);
        var resolver = new LocalActorAddressRegistry();
        var recipientAddress = new ActorAddress($"agent/{profile.RoleAgentId.Value}", "local");
        var recipient = rejectAcceptedCommit
            ? system.ActorOf(Props.Create(() => new RejectingDeliveryRecipientActor(recipientAddress)), $"phase16-{profile.RoleAgentId.Value}-rejecting-recipient")
            : system.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress)), $"phase16-{profile.RoleAgentId.Value}-recipient");
        resolver.Register(recipientAddress, recipient);
        return CreateWorkIntakeClient(
            system,
            $"phase16/intake/{profile.RoleAgentId.Value}",
            profile.RoleAgentId,
            () => agentState,
            decisionFactory: (offer, _) => Decide(profile, offer, forceBothAccept),
            resolver: resolver,
            agentGatewayAddress: recipientAddress);
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

    private static WorkOfferDecision Decide(RoleAgentProfile profile, WorkOffer offer, bool forceBothAccept)
    {
        if (forceBothAccept)
        {
            return Accept(profile.RoleAgentId, offer, profile.RoleName, $"{profile.RoleName}.ingest_document");
        }

        if (profile.RoleName.Equals("accountant", StringComparison.OrdinalIgnoreCase))
        {
            return offer.ProposedIntent.Contains("invoice", StringComparison.OrdinalIgnoreCase) ||
                   offer.ProposedIntent.Contains("account", StringComparison.OrdinalIgnoreCase)
                ? Accept(profile.RoleAgentId, offer, "accounting_documents", "accounting.ingest_document")
                : new WorkOfferRejectedDecision(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "out_of_scope", "Offer is outside accountant scope.", false, ["research"]);
        }

        return offer.ProposedIntent.Contains("research", StringComparison.OrdinalIgnoreCase)
            ? Accept(profile.RoleAgentId, offer, "research_documents", "research.ingest_document")
            : new WorkOfferRejectedDecision(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "out_of_scope", "Offer is outside research scope.", false, ["accountant"]);
    }

    private static WorkOfferAcceptedDecision Accept(RoleAgentId agentId, WorkOffer offer, string scope, string commandType) =>
        new(
            offer.RoutingAttemptId,
            offer.OfferId,
            agentId,
            new WorkClaimId($"claim-{offer.OfferId.Value}"),
            0.97m,
            scope,
            commandType,
            DateTimeOffset.UtcNow.AddMinutes(10),
            $"Matches {scope}.");

    private static RoleAgentProfile CreateAccountantProfile(RoleAgentId id) =>
        new(
            id,
            "accountant",
            "Accountant",
            "Handle invoices and statements",
            "Accounting documents",
            ["pdf", "image"],
            [new SchemaRef("schema://accounting/invoice@3")],
            "Routes invoices and statements",
            ["invoice", "account statement"],
            ["research paper"],
            "recent accounting summary",
            "monthly",
            "running");

    private static RoleAgentProfile CreateResearchProfile(RoleAgentId id) =>
        new(
            id,
            "research",
            "Research Watch",
            "Handle papers and research notes",
            "Research documents",
            ["pdf", "text"],
            [new SchemaRef("schema://research/paper@1")],
            "Routes papers and findings",
            ["research paper", "benchmark report"],
            ["invoice"],
            "recent research summary",
            "weekly",
            "running");

    private static SubmitMessageRequest CreateInvoiceCommand(string idempotencyKey, string summary = "invoice pdf from vendor") =>
        CreateCommand(idempotencyKey, summary, "accounting.invoice");

    private static SubmitMessageRequest CreateCommand(string idempotencyKey, string summary, string proposedIntent) =>
        new(
            idempotencyKey,
            $"incoming-{(string.IsNullOrWhiteSpace(idempotencyKey) ? "missing" : idempotencyKey)}",
            "pdf",
            Array.Empty<string>(),
            summary,
            proposedIntent,
            "router proposal",
            Array.Empty<SchemaRef>());

    private static MessageSubmitted CreateSubmittedEvent(string idempotencyKey, string summary, string proposedIntent) =>
        new(
            idempotencyKey,
            $"hash-{idempotencyKey}",
            $"incoming-{idempotencyKey}",
            "pdf",
            Array.Empty<string>(),
            summary,
            proposedIntent,
            "router proposal",
            Array.Empty<SchemaRef>(),
            new RoutingAttemptId($"route-{idempotencyKey}"),
            new DeliveryId($"delivery-{idempotencyKey}"),
            new CommandId($"cmd-{idempotencyKey}"),
            new MessageId($"msg-{idempotencyKey}"),
            DateTimeOffset.UtcNow);

    private async Task WithSystem(Func<ActorSystem, Task> action)
    {
        var config = ConfigurationFactory.ParseString($$"""
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

        var system = ActorSystem.Create($"aven-phase16-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            _router = null;
            await system.Terminate();
        }
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

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

    private sealed class RecordingRecipientActor : Aven.ActorKernel.Actors.InboxLedgerPersistentActor
    {
        private readonly ActorAddress _address;

        public RecordingRecipientActor(ActorAddress address)
            : base($"phase16-recipient-{address.Value.Replace('/', '-')}")
        {
            _address = address;
            Command<DeliveryAttemptOffer>(Handle);
        }

        private void Handle(DeliveryAttemptOffer offer)
        {
            var decision = Decide(offer.Envelope.CommandId, offer.PayloadHash);
            switch (decision.Kind)
            {
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Accepted:
                    {
                        var replyTo = Sender;
                        PersistAcceptance(
                            new Aven.ActorKernel.Messages.ProcessedCommandAccepted(offer.Envelope.CommandId, offer.PayloadHash, DateTimeOffset.UtcNow, "accepted"),
                            _ => replyTo.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted")));
                        break;
                    }
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Duplicate:
                    Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "duplicate"));
                    break;
                case Aven.ActorKernel.Ledgers.ProcessedCommandDecisionKind.Conflict:
                    Sender.Tell(new DeliveryRejected(offer.DeliveryId, offer.Envelope.CommandId, _address, new OperationError("payload_conflict", "Conflicting duplicate payload.", false)));
                    break;
            }
        }
    }

    private sealed class RejectingDeliveryRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;

        public RejectingDeliveryRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer =>
            {
                Sender.Tell(new DeliveryRejected(
                    offer.DeliveryId,
                    offer.Envelope.CommandId,
                    _address,
                    new OperationError("delivery_rejected", "Recipient rejected delivery.", false)));
            });
        }
    }

    private sealed class AcceptingDeliveryRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;

        public AcceptingDeliveryRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer =>
            {
                Sender.Tell(new DeliveryAccepted(
                    offer.DeliveryId,
                    offer.Envelope.CommandId,
                    _address,
                    "accepted"));
            });
        }
    }

    private sealed class EmptyInspectionRouterActor : ReceiveActor
    {
        public EmptyInspectionRouterActor()
        {
            Receive<GetRouteResolutionCommand>(_ => Sender.Tell((object?)null));
            Receive<InspectRouteAttempts>(_ => Sender.Tell(new RouteInspection(new Dictionary<RoutingAttemptId, RouteAttemptRecord>())));
        }
    }

    private sealed class RejectedResolutionRouterActor : ReceiveActor
    {
        public RejectedResolutionRouterActor()
        {
            Receive<GetRouteResolutionCommand>(command =>
            {
                var attempt = new RouteAttemptRecord(
                    command.AttemptId,
                    new RouteInput(
                        command.AttemptId,
                        $"incoming-{command.AttemptId.Value}",
                        "pdf",
                        Array.Empty<string>(),
                        "invoice pdf from vendor",
                        "accounting.invoice",
                        "router proposal",
                        Array.Empty<SchemaRef>(),
                        new CorrelationId($"corr-{command.AttemptId.Value}"),
                        new ActorAddress("submission/http", "local")),
                    RouteAttemptStatus.Rejected,
                    Array.Empty<RouteAuditEntry>(),
                    null,
                    null,
                    "Routing rejected.");

                Sender.Tell(new RouteRejected(attempt, "Routing rejected."));
            });
            Receive<InspectRouteAttempts>(_ => Sender.Tell(new RouteInspection(new Dictionary<RoutingAttemptId, RouteAttemptRecord>())));
        }
    }
}