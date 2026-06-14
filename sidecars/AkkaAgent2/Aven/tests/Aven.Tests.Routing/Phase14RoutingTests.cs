using Akka.Actor;
using Akka.Configuration;
using Aven.Akka.Hosting;
using Aven.Contracts.Messaging;
using Aven.Toolkit.Core.Serialization;
using Aven.WorkIntake.Contracts.Enums;

namespace Aven.Tests.Routing;

public sealed class Phase14RoutingTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase14-{Guid.NewGuid():N}.sqlite");
    private static readonly ActorSystem SharedIntakeSystem = ActorSystem.Create("aven-phase14-inline-intakes");

    [Fact]
    public async Task Invoice_RoutesToAccountantThroughIntake()
    {
        await WithSystem(async system =>
        {
            var accountantId = new RoleAgentId("agent-accountant");
            var researchId = new RoleAgentId("agent-research");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-invoice-{Guid.NewGuid():N}", deliveries,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("route-invoice", "invoice pdf from vendor", "accounting.invoice")));

            Assert.Equal(accountantId, result.RoleAgentId);
            Assert.Contains(result.Attempt.AuditEntries, static entry => entry.RoleAgentId.Value == "agent-accountant" && entry.DecisionKind == "accepted");

            await AssertEventually(() =>
            {
                Assert.Single(deliveries[accountantId]);
                Assert.Empty(deliveries[researchId]);
                return Task.CompletedTask;
            }, attempts: 80, delayMs: 25);
        });
    }

    [Fact]
    public async Task ResearchPaper_IsOfferedToAccountant_Rejected_ThenRoutedToResearchAgent()
    {
        await WithSystem(async system =>
        {
            var accountantId = new RoleAgentId("agent-accountant");
            var researchId = new RoleAgentId("agent-research");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-research-{Guid.NewGuid():N}", deliveries,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("route-research", "paper about transformers and benchmarks", "research.paper")));

            Assert.Equal(researchId, result.RoleAgentId);
            Assert.Collection(
                result.Attempt.AuditEntries,
                accountant =>
                {
                    Assert.Equal(accountantId, accountant.RoleAgentId);
                    Assert.Equal("rejected", accountant.DecisionKind);
                },
                research =>
                {
                    Assert.Equal(researchId, research.RoleAgentId);
                    Assert.Equal("accepted", research.DecisionKind);
                });

            await AssertEventually(() =>
            {
                Assert.Single(deliveries[researchId]);
                Assert.Empty(deliveries[accountantId]);
                return Task.CompletedTask;
            }, attempts: 80, delayMs: 25);
        });
    }

    [Fact]
    public async Task MultipleAccepts_CreateClarificationPrompt()
    {
        await WithSystem(_ =>
        {
            var accountantId = new RoleAgentId("agent-accountant");
            var researchId = new RoleAgentId("agent-research");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };

            var router = CreateActorBackedRouter(
                _,
                $"phase14/routing-ambiguous-{Guid.NewGuid():N}",
                deliveries,
                forceBothAccept: true,
                rejectAcceptedCommit: false,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput("route-ambiguous", "mixed business document", "mixed.document")));

            Assert.Contains("Multiple agents accepted", result.Question);
            Assert.Equal(2, result.CandidateRoleAgentIds.Count);
            Assert.Empty(deliveries[accountantId]);
            Assert.Empty(deliveries[researchId]);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task NoAccepts_AsksUserOrProposesSpawn()
    {
        await WithSystem(system =>
        {
            var accountantId = new RoleAgentId("agent-accountant");
            var researchId = new RoleAgentId("agent-research");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-none-{Guid.NewGuid():N}", deliveries,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput("route-none", "travel booking confirmation", "travel.itinerary")));

            Assert.Contains("could not determine", result.Question, StringComparison.OrdinalIgnoreCase);
            Assert.Empty(result.CandidateRoleAgentIds);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ExplicitInputType_IsUsedForIntakeMatching_WhenIncomingItemRefHasNoUsefulExtension()
    {
        await WithSystem(system =>
        {
            var pdfOnlyId = new RoleAgentId("agent-pdf-only");
            var textOnlyId = new RoleAgentId("agent-text-only");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [pdfOnlyId] = new(),
                [textOnlyId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-input-type-{Guid.NewGuid():N}", deliveries,
                CreatePdfOnlyProfile(pdfOnlyId),
                CreateTextOnlyProfile(textOnlyId));

            var route = new RouteInput(
                new RoutingAttemptId("route-input-type-explicit"),
                "blob:artifact-123",
                "application/pdf",
                Array.Empty<string>(),
                "invoice packet",
                "accounting.invoice",
                "router proposal",
                Array.Empty<SchemaRef>(),
                new CorrelationId("corr-route-input-type-explicit"),
                new ActorAddress("router/a", "local"));

            var result = Assert.IsType<RouteCommitted>(router.Route(route));
            Assert.Equal(pdfOnlyId, result.RoleAgentId);
            Assert.Contains(result.Attempt.AuditEntries, entry => entry.RoleAgentId == pdfOnlyId && entry.DecisionKind == "accepted");
            Assert.DoesNotContain(result.Attempt.AuditEntries, entry => entry.RoleAgentId == textOnlyId && entry.DecisionKind == "accepted");
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task RoutingAudit_IsInspectable()
    {
        await WithSystem(system =>
        {
            var accountantId = new RoleAgentId("agent-accountant");
            var researchId = new RoleAgentId("agent-research");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-audit-{Guid.NewGuid():N}", deliveries,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var decision = router.Route(CreateInput("route-audit", "paper about transformers and benchmarks", "research.paper"));
            var inspection = router.Inspect();

            Assert.True(inspection.Attempts.TryGetValue(decision.Attempt.RoutingAttemptId, out var attempt));
            Assert.Equal(decision.Attempt.Status, attempt!.Status);
            Assert.Equal(2, attempt.AuditEntries.Count);
            Assert.Contains(attempt.AuditEntries, static entry => entry.DecisionKind == "rejected");
            Assert.Contains(attempt.AuditEntries, static entry => entry.DecisionKind == "accepted");
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task Route_DoesNotBlockOnCommittedWorkDeliveryTerminal()
    {
        await WithSystem(async system =>
        {
            var agentId = new RoleAgentId("agent-route-nonblocking");
            var profile = CreateAccountantProfile(agentId);
            var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
            registry.Register(profile);

            var resolver = new LocalActorAddressRegistry();
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(
                Props.Create(() => new ControlledTerminalRecipientActor(recipientAddress)),
                $"phase14-controlled-recipient-{agentId.Value}-{Guid.NewGuid():N}");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor(profile.RoleName, profile.DisplayName), profile.Objective);
            var intake = CreateWorkIntakeClient(
                system,
                $"phase14/intake/{agentId.Value}/{Guid.NewGuid():N}",
                agentId,
                () => agentState,
                decisionFactory: (offer, _) => Accept(agentId, offer, "accounting_documents", "accounting.ingest_document"),
                resolver: resolver,
                agentGatewayAddress: recipientAddress);

            var actor = system.ActorOf(
                Props.Create(() => new Aven.Routing.Actors.RoleRouterActor(
                    $"phase14/routing-nonblocking-{Guid.NewGuid():N}",
                    registry,
                    _ => intake)),
                $"phase14-routing-nonblocking-{Guid.NewGuid():N}");
            var router = new RoleRoutingClient(actor);

            var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("route-nonblocking", "invoice pdf from vendor", "accounting.invoice")));
            Assert.Equal(agentId, result.RoleAgentId);

            var committingState = intake.State;
            Assert.Equal(WorkIntakeLifecycleStatus.Committing, committingState.Offers[result.Commit.OfferId].Status);

            await AssertEventually(async () =>
            {
                var pendingDeliveryCount = await recipient.Ask<int>(new InspectPendingAcceptedDeliveries(), TimeSpan.FromSeconds(1));
                Assert.True(pendingDeliveryCount > 0);
            });

            recipient.Tell(new ReleaseAcceptedDeliveries());

            await AssertEventually(() =>
            {
                var state = intake.State;
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, state.Offers[result.Commit.OfferId].Status);
                return Task.CompletedTask;
            });
        });
    }

    [Fact]
    public async Task ActorBackedRouteInspection_PersistsAttemptsAcrossRestart()
    {
        var accountantId = new RoleAgentId("agent-accountant");
        var researchId = new RoleAgentId("agent-research");
        var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
        {
            [accountantId] = new(),
            [researchId] = new()
        };

        await WithSystem(system =>
        {
            var router = CreateActorBackedRouter(system, "phase14/routing", deliveries,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("route-persist", "invoice pdf from vendor", "accounting.invoice")));
            Assert.Equal(accountantId, result.RoleAgentId);
            return Task.CompletedTask;
        });

        await WithSystem(system =>
        {
            var deliveriesAfterRestart = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };
            var router = CreateActorBackedRouter(system, "phase14/routing", deliveriesAfterRestart,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var inspection = router.Inspect();
            Assert.True(inspection.Attempts.TryGetValue(new RoutingAttemptId("route-persist"), out var attempt));
            Assert.NotNull(attempt);
            Assert.Equal(RouteAttemptStatus.Routed, attempt!.Status);
            Assert.Equal(accountantId, attempt.SelectedRoleAgentId);
            Assert.Contains(attempt.AuditEntries, static entry => entry.DecisionKind == "accepted");
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ActorBackedRouteInspection_PersistsClarificationAttemptsAcrossRestart()
    {
        var accountantId = new RoleAgentId("agent-accountant");
        var researchId = new RoleAgentId("agent-research");
        var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
        {
            [accountantId] = new(),
            [researchId] = new()
        };

        await WithSystem(system =>
        {
            var router = CreateActorBackedRouter(system, "phase14/routing-clarification", deliveries,
                forceBothAccept: true,
                rejectAcceptedCommit: false,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput("route-persist-clarification", "mixed business document", "mixed.document")));
            Assert.Contains("Multiple agents accepted", result.Question);
            Assert.Equal(2, result.CandidateRoleAgentIds.Count);
            return Task.CompletedTask;
        });

        await WithSystem(system =>
        {
            var deliveriesAfterRestart = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };
            var router = CreateActorBackedRouter(system, "phase14/routing-clarification", deliveriesAfterRestart,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var inspection = router.Inspect();
            Assert.True(inspection.Attempts.TryGetValue(new RoutingAttemptId("route-persist-clarification"), out var attempt));
            Assert.NotNull(attempt);
            Assert.Equal(RouteAttemptStatus.ClarificationRequired, attempt!.Status);
            Assert.Contains("Multiple agents accepted", attempt.ClarificationQuestion, StringComparison.Ordinal);
            Assert.Equal(2, attempt.ClarificationCandidateRoleAgentIds.Count);
            Assert.Contains(accountantId, attempt.ClarificationCandidateRoleAgentIds);
            Assert.Contains(researchId, attempt.ClarificationCandidateRoleAgentIds);
            var acceptedEntries = attempt.AuditEntries.Where(static entry => entry.DecisionKind == "accepted").ToArray();
            Assert.Equal(2, acceptedEntries.Length);
            Assert.Contains(acceptedEntries, entry => entry.RoleAgentId == accountantId);
            Assert.Contains(acceptedEntries, entry => entry.RoleAgentId == researchId);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ActorBackedRouteInspection_PersistsClarificationCandidateIdsAcrossRestart()
    {
        var accountantId = new RoleAgentId("agent-accountant-candidate-ids");
        var researchId = new RoleAgentId("agent-research-candidate-ids");
        var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
        {
            [accountantId] = new(),
            [researchId] = new()
        };

        await WithSystem(system =>
        {
            var router = CreateActorBackedRouter(system, "phase14/routing-clarification-candidate-ids", deliveries,
                forceBothAccept: true,
                rejectAcceptedCommit: false,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var result = Assert.IsType<RouteNeedsClarification>(router.Route(CreateInput("route-clarification-candidate-ids", "mixed business document", "mixed.document")));
            Assert.Equal(new[] { accountantId, researchId }, result.CandidateRoleAgentIds.OrderBy(x => x.Value).ToArray());
            return Task.CompletedTask;
        });

        await WithSystem(system =>
        {
            var deliveriesAfterRestart = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };
            var router = CreateActorBackedRouter(system, "phase14/routing-clarification-candidate-ids", deliveriesAfterRestart,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var attempt = router.GetAttempt(new RoutingAttemptId("route-clarification-candidate-ids"));
            Assert.NotNull(attempt);
            Assert.Equal(RouteAttemptStatus.ClarificationRequired, attempt!.Status);
            Assert.Equal(new[] { accountantId, researchId }, attempt.ClarificationCandidateRoleAgentIds.OrderBy(x => x.Value).ToArray());
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ActorBackedRouteInspection_PersistsCommittedAttempt_WhenDownstreamDeliveryRejectsLater()
    {
        var accountantId = new RoleAgentId("agent-accountant");
        var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
        {
            [accountantId] = new()
        };

        await WithSystem(system =>
        {
            var router = CreateActorBackedRouter(system, "phase14/routing-rejected", deliveries,
                forceBothAccept: false,
                rejectAcceptedCommit: true,
                CreateAccountantProfile(accountantId));

            var result = Assert.IsType<RouteCommitted>(router.Route(CreateInput("route-persist-rejected", "invoice pdf from vendor", "accounting.invoice")));
            Assert.Equal(accountantId, result.RoleAgentId);
            return Task.CompletedTask;
        });

        await WithSystem(system =>
        {
            var deliveriesAfterRestart = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new()
            };
            var router = CreateActorBackedRouter(system, "phase14/routing-rejected", deliveriesAfterRestart,
                CreateAccountantProfile(accountantId));

            var inspection = router.Inspect();
            Assert.True(inspection.Attempts.TryGetValue(new RoutingAttemptId("route-persist-rejected"), out var attempt));
            Assert.NotNull(attempt);
            Assert.Equal(RouteAttemptStatus.Routed, attempt!.Status);
            Assert.Equal(accountantId, attempt.SelectedRoleAgentId);
            Assert.Contains(attempt.AuditEntries, entry => entry.RoleAgentId == accountantId && entry.DecisionKind == "accepted");
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task RoleRoutingClient_GetAttempt_MatchesInspectionForRecordedAttempt()
    {
        await WithSystem(system =>
        {
            var accountantId = new RoleAgentId("agent-accountant-get-attempt");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-get-attempt-{Guid.NewGuid():N}", deliveries,
                CreateAccountantProfile(accountantId));

            var decision = Assert.IsType<RouteCommitted>(router.Route(CreateInput("route-get-attempt", "invoice pdf from vendor", "accounting.invoice")));
            var inspectionAttempt = router.Inspect().Attempts[decision.Attempt.RoutingAttemptId];
            var directAttempt = router.GetAttempt(decision.Attempt.RoutingAttemptId);

            Assert.NotNull(directAttempt);
            Assert.Equal(inspectionAttempt, directAttempt);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task RoleRouterActor_AcceptsDeliveryAttemptOffer_RecordsRoute_AndRepliesDeliveryAccepted()
    {
        await WithSystem(async system =>
        {
            var accountantId = new RoleAgentId("agent-accountant-delivery-accept");
            var deliveries = new List<OperationResolved>();
            var profile = CreateAccountantProfile(accountantId);
            var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
            registry.Register(profile);
            var intake = CreateIntake(profile, deliveries, forceBothAccept: false, rejectAcceptedCommit: false);
            var actor = system.ActorOf(
                Props.Create(() => new Aven.Routing.Actors.RoleRouterActor(
                    $"phase14/routing-delivery-accept-{Guid.NewGuid():N}",
                    registry,
                    _ => intake)),
                $"phase14-routing-delivery-accept-{Guid.NewGuid():N}");
            var serializer = new CanonicalJsonSerializer();
            var routeInput = CreateInput("route-delivery-accept", "invoice pdf from vendor", "accounting.invoice");

            var accepted = await actor.Ask<DeliveryAccepted>(CreateRouteDeliveryAttemptOffer(routeInput, serializer), TimeSpan.FromSeconds(5));

            Assert.Equal("routing_attempt_recorded", accepted.AcceptanceKind);

            var inspection = await actor.Ask<RouteInspection>(new Aven.Routing.Contracts.Commands.InspectRouteAttempts(), TimeSpan.FromSeconds(5));
            Assert.True(inspection.Attempts.TryGetValue(routeInput.RoutingAttemptId, out var attempt));
            Assert.NotNull(attempt);
            Assert.Equal(RouteAttemptStatus.Routed, attempt!.Status);
            Assert.Equal(accountantId, attempt.SelectedRoleAgentId);

            await AssertEventually(() =>
            {
                Assert.Single(deliveries);
                return Task.CompletedTask;
            });
        });
    }

    [Fact]
    public async Task RoleRouterActor_RejectsInvalidDeliveryPayload_WithoutRecordingAttempt()
    {
        await WithSystem(async system =>
        {
            var accountantId = new RoleAgentId("agent-accountant-invalid-delivery");
            var deliveries = new List<OperationResolved>();
            var profile = CreateAccountantProfile(accountantId);
            var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
            registry.Register(profile);
            var intake = CreateIntake(profile, deliveries, forceBothAccept: false, rejectAcceptedCommit: false);
            var actor = system.ActorOf(
                Props.Create(() => new Aven.Routing.Actors.RoleRouterActor(
                    $"phase14/routing-invalid-delivery-{Guid.NewGuid():N}",
                    registry,
                    _ => intake)),
                $"phase14-routing-invalid-delivery-{Guid.NewGuid():N}");
            var serializer = new CanonicalJsonSerializer();
            var routeInput = CreateInput("route-invalid-delivery", "invoice pdf from vendor", "accounting.invoice");

            var rejected = await actor.Ask<DeliveryRejected>(CreateRouteDeliveryAttemptOffer(routeInput, serializer, payloadOverride: "{"), TimeSpan.FromSeconds(5));

            Assert.Equal("invalid_route_payload", rejected.Error.Code);

            var inspection = await actor.Ask<RouteInspection>(new Aven.Routing.Contracts.Commands.InspectRouteAttempts(), TimeSpan.FromSeconds(5));
            Assert.Empty(inspection.Attempts);
            Assert.Empty(deliveries);
        });
    }

    [Fact]
    public async Task RoleRouterActor_DuplicateDeliveryAttemptOffer_IsAcceptedIdempotently_WithoutDoubleCommit()
    {
        await WithSystem(async system =>
        {
            var agentId = new RoleAgentId("agent-accountant-duplicate-delivery");
            var profile = CreateAccountantProfile(agentId);
            var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
            registry.Register(profile);

            var resolver = new LocalActorAddressRegistry();
            var recipientAddress = new ActorAddress($"agent/{agentId.Value}", "local");
            var recipient = system.ActorOf(
                Props.Create(() => new ControlledTerminalRecipientActor(recipientAddress)),
                $"phase14-duplicate-controlled-recipient-{agentId.Value}-{Guid.NewGuid():N}");
            resolver.Register(recipientAddress, recipient);

            var agentState = RoleAgentState.Create(agentId, new RoleDescriptor(profile.RoleName, profile.DisplayName), profile.Objective);
            var intake = CreateWorkIntakeClient(
                system,
                $"phase14/intake/{agentId.Value}/{Guid.NewGuid():N}",
                agentId,
                () => agentState,
                decisionFactory: (offer, _) => Accept(agentId, offer, "accounting_documents", "accounting.ingest_document"),
                resolver: resolver,
                agentGatewayAddress: recipientAddress);

            var actor = system.ActorOf(
                Props.Create(() => new Aven.Routing.Actors.RoleRouterActor(
                    $"phase14/routing-duplicate-delivery-{Guid.NewGuid():N}",
                    registry,
                    _ => intake)),
                $"phase14-routing-duplicate-delivery-{Guid.NewGuid():N}");
            var serializer = new CanonicalJsonSerializer();
            var routeInput = CreateInput("route-duplicate-delivery", "invoice pdf from vendor", "accounting.invoice");
            var offer = CreateRouteDeliveryAttemptOffer(routeInput, serializer);

            var firstAccepted = await actor.Ask<DeliveryAccepted>(offer, TimeSpan.FromSeconds(5));
            var secondAccepted = await actor.Ask<DeliveryAccepted>(offer, TimeSpan.FromSeconds(5));

            Assert.Equal("routing_attempt_recorded", firstAccepted.AcceptanceKind);
            Assert.Equal("duplicate_routing_attempt_recorded", secondAccepted.AcceptanceKind);

            await AssertEventually(async () =>
            {
                var pendingDeliveryCount = await recipient.Ask<int>(new InspectPendingAcceptedDeliveries(), TimeSpan.FromSeconds(1));
                Assert.Equal(1, pendingDeliveryCount);
            });

            var state = intake.State;
            Assert.Single(state.Offers);
            Assert.Equal(WorkIntakeLifecycleStatus.Committing, state.Offers.Values.Single().Status);

            var inspection = await actor.Ask<RouteInspection>(new Aven.Routing.Contracts.Commands.InspectRouteAttempts(), TimeSpan.FromSeconds(5));
            Assert.Single(inspection.Attempts);
            Assert.True(inspection.Attempts.ContainsKey(routeInput.RoutingAttemptId));

            recipient.Tell(new ReleaseAcceptedDeliveries());
            await AssertEventually(() =>
            {
                Assert.Equal(WorkIntakeLifecycleStatus.Committed, intake.State.Offers.Values.Single().Status);
                return Task.CompletedTask;
            });
        });
    }

    [Fact]
    public async Task DuplicateRouteCommand_AfterRouted_ReturnsIdempotentCommittedResolution()
    {
        await WithSystem(system =>
        {
            var accountantId = new RoleAgentId("agent-accountant-duplicate-route-routed");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-duplicate-route-routed-{Guid.NewGuid():N}", deliveries,
                CreateAccountantProfile(accountantId));

            var input = CreateInput("route-duplicate-routed", "invoice pdf from vendor", "accounting.invoice");
            var first = Assert.IsType<RouteCommitted>(router.Route(input));
            var second = Assert.IsType<RouteCommitted>(router.Route(input));

            Assert.Equal(accountantId, first.RoleAgentId);
            Assert.Equal(first.RoleAgentId, second.RoleAgentId);
            Assert.True(second.Commit.Idempotent);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task DuplicateRouteCommand_AfterClarification_ReturnsSameClarificationResolution()
    {
        await WithSystem(system =>
        {
            var accountantId = new RoleAgentId("agent-accountant-duplicate-route-clarification");
            var researchId = new RoleAgentId("agent-research-duplicate-route-clarification");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-duplicate-route-clarification-{Guid.NewGuid():N}", deliveries,
                forceBothAccept: true,
                rejectAcceptedCommit: false,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var input = CreateInput("route-duplicate-clarification", "mixed business document", "mixed.document");
            var first = Assert.IsType<RouteNeedsClarification>(router.Route(input));
            var second = Assert.IsType<RouteNeedsClarification>(router.Route(input));

            Assert.Equal(first.Question, second.Question);
            Assert.Equal(first.CandidateRoleAgentIds.OrderBy(x => x.Value), second.CandidateRoleAgentIds.OrderBy(x => x.Value));
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task DuplicateRouteCommand_AfterNoCandidateAccepted_ReturnsSameClarificationResolution()
    {
        await WithSystem(system =>
        {
            var accountantId = new RoleAgentId("agent-accountant-duplicate-route-rejected");
            var researchId = new RoleAgentId("agent-research-duplicate-route-rejected");
            var deliveries = new Dictionary<RoleAgentId, List<OperationResolved>>
            {
                [accountantId] = new(),
                [researchId] = new()
            };

            var router = CreateActorBackedRouter(system, $"phase14/routing-duplicate-route-rejected-{Guid.NewGuid():N}", deliveries,
                CreateAccountantProfile(accountantId),
                CreateResearchProfile(researchId));

            var input = CreateInput("route-duplicate-rejected", "travel booking confirmation", "travel.itinerary");
            var first = Assert.IsType<RouteNeedsClarification>(router.Route(input));
            var second = Assert.IsType<RouteNeedsClarification>(router.Route(input));

            Assert.Equal(first.Question, second.Question);
            Assert.Equal(RouteAttemptStatus.ClarificationRequired, second.Attempt.Status);
            Assert.Empty(second.CandidateRoleAgentIds);
            return Task.CompletedTask;
        });
    }

    private static RoleRoutingClient CreateActorBackedRouter(
        ActorSystem system,
        string persistenceId,
        Dictionary<RoleAgentId, List<OperationResolved>> deliveries,
        params RoleAgentProfile[] profiles)
        => CreateActorBackedRouter(system, persistenceId, deliveries, forceBothAccept: false, rejectAcceptedCommit: false, profiles);

    private static RoleRoutingClient CreateActorBackedRouter(
        ActorSystem system,
        string persistenceId,
        Dictionary<RoleAgentId, List<OperationResolved>> deliveries,
        bool forceBothAccept,
        bool rejectAcceptedCommit,
        params RoleAgentProfile[] profiles)
    {
        var registry = new Aven.RoleAgents.Registry.Clients.InMemoryRoleAgentRegistryClient();
        foreach (var profile in profiles)
        {
            registry.Register(profile);
        }

        var intakes = profiles.ToDictionary(
            static profile => profile.RoleAgentId,
            profile => CreateIntake(profile, deliveries[profile.RoleAgentId], forceBothAccept, rejectAcceptedCommit));

        var actor = system.ActorOf(
            Props.Create(() => new Aven.Routing.Actors.RoleRouterActor(persistenceId, registry, agentId => intakes[agentId])),
            persistenceId.Replace('/', '-'));
        return new RoleRoutingClient(actor);
    }

    private static WorkIntakeClient CreateIntake(RoleAgentProfile profile, List<OperationResolved> deliveries, bool forceBothAccept)
        => CreateIntake(profile, deliveries, forceBothAccept, rejectAcceptedCommit: false);

    private static WorkIntakeClient CreateIntake(RoleAgentProfile profile, List<OperationResolved> deliveries, bool forceBothAccept, bool rejectAcceptedCommit)
    {
        var agentState = RoleAgentState.Create(profile.RoleAgentId, new RoleDescriptor(profile.RoleName, profile.DisplayName), profile.Objective);
        var resolver = new LocalActorAddressRegistry();
        var recipientAddress = new ActorAddress($"agent/{profile.RoleAgentId.Value}", "local");
        var recipient = rejectAcceptedCommit
            ? SharedIntakeSystem.ActorOf(Props.Create(() => new RejectingRecipientActor(recipientAddress)), $"phase14-rejecting-recipient-{profile.RoleAgentId.Value}-{Guid.NewGuid():N}")
            : SharedIntakeSystem.ActorOf(Props.Create(() => new RecordingRecipientActor(recipientAddress, deliveries)), $"phase14-recipient-{profile.RoleAgentId.Value}-{Guid.NewGuid():N}");
        resolver.Register(recipientAddress, recipient);
        return CreateWorkIntakeClient(
            SharedIntakeSystem,
            $"phase14/intake/{profile.RoleAgentId.Value}/{Guid.NewGuid():N}",
            profile.RoleAgentId,
            () => agentState,
            (offer, _) => Decide(profile, offer, forceBothAccept),
            resolver,
            recipientAddress);
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
            return Accept(profile.RoleAgentId, offer, profile.RoleName, $"{profile.RoleName}.ingest");
        }

        if (profile.RoleName.Equals("accountant", StringComparison.OrdinalIgnoreCase))
        {
            return offer.ProposedIntent.Contains("account", StringComparison.OrdinalIgnoreCase) ||
                   offer.ProposedIntent.Contains("invoice", StringComparison.OrdinalIgnoreCase)
                ? Accept(profile.RoleAgentId, offer, "accounting_documents", "accounting.ingest_document")
                : new WorkOfferRejectedDecision(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "out_of_scope", "Offer is outside accountant scope.", false, ["research"]);
        }

        if (profile.RoleName.Equals("research", StringComparison.OrdinalIgnoreCase))
        {
            return offer.ProposedIntent.Contains("research", StringComparison.OrdinalIgnoreCase) ||
                   offer.ContentSummary.Contains("paper", StringComparison.OrdinalIgnoreCase)
                ? Accept(profile.RoleAgentId, offer, "research_documents", "research.ingest_document")
                : new WorkOfferRejectedDecision(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "out_of_scope", "Offer is outside research scope.", false, ["accountant"]);
        }

        return new WorkOfferNeedsClarification(offer.RoutingAttemptId, offer.OfferId, profile.RoleAgentId, "Can you clarify the target role?");
    }

    private static WorkOfferAcceptedDecision Accept(RoleAgentId agentId, WorkOffer offer, string scope, string commandType) =>
        new(
            offer.RoutingAttemptId,
            offer.OfferId,
            agentId,
            new WorkClaimId($"claim-{offer.OfferId.Value}"),
            0.95m,
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

    private static RoleAgentProfile CreatePdfOnlyProfile(RoleAgentId id) =>
        new(
            id,
            "accountant",
            "PDF Accountant",
            "Handle pdf invoices",
            "Accounting documents",
            ["pdf"],
            [new SchemaRef("schema://accounting/invoice@3")],
            "Routes invoice pdfs",
            ["invoice pdf"],
            ["plain text note"],
            "recent pdf summary",
            "monthly",
            "running");

    private static RoleAgentProfile CreateTextOnlyProfile(RoleAgentId id) =>
        new(
            id,
            "research",
            "Text Research",
            "Handle text notes",
            "Research documents",
            ["text"],
            [new SchemaRef("schema://research/paper@1")],
            "Routes text notes",
            ["research note"],
            ["invoice pdf"],
            "recent text summary",
            "weekly",
            "running");

    private static RouteInput CreateInput(string routeId, string summary, string proposedIntent) =>
        new(
            new RoutingAttemptId(routeId),
            $"incoming-{routeId}",
            "pdf",
            Array.Empty<string>(),
            summary,
            proposedIntent,
            "router proposal",
            Array.Empty<SchemaRef>(),
            new CorrelationId($"corr-{routeId}"),
            new ActorAddress("router/a", "local"));

    private static DeliveryAttemptOffer CreateRouteDeliveryAttemptOffer(RouteInput routeInput, CanonicalJsonSerializer serializer, string? payloadOverride = null)
    {
        var payload = payloadOverride ?? serializer.Serialize(routeInput);
        return new DeliveryAttemptOffer(
            new DeliveryId($"delivery-{routeInput.RoutingAttemptId.Value}"),
            new AvenEnvelope<string>(
                new CommandId($"cmd-{routeInput.RoutingAttemptId.Value}"),
                new MessageId($"msg-{routeInput.RoutingAttemptId.Value}"),
                new ActorAddress("api/messages", "http"),
                new ActorAddress("routing/role", "local"),
                new ActorAddress("submission/http", "local"),
                routeInput.CorrelationId,
                "submission.route_input",
                1,
                payload,
                null,
                null,
                DateTimeOffset.UtcNow),
            payloadOverride is null ? serializer.Hash(routeInput) : serializer.Hash(new { payload }));
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

        var system = ActorSystem.Create($"aven-phase14-{Guid.NewGuid():N}", config);
        try
        {
            await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private sealed class RecordingRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private readonly List<OperationResolved> _deliveries;

        public RecordingRecipientActor(ActorAddress address, List<OperationResolved> deliveries)
        {
            _address = address;
            _deliveries = deliveries;
            Receive<DeliveryAttemptOffer>(offer =>
            {
                var resolved = System.Text.Json.JsonSerializer.Deserialize<OperationResolved>(offer.Envelope.Payload)
                    ?? throw new InvalidOperationException("OperationResolved payload was empty.");
                _deliveries.Add(resolved);
                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, _address, "accepted"));
            });
        }
    }

    private sealed record ReleaseAcceptedDeliveries;
    private sealed record InspectPendingAcceptedDeliveries;

    private sealed class ControlledTerminalRecipientActor : ReceiveActor
    {
        private readonly ActorAddress _address;
        private readonly Dictionary<DeliveryId, (IActorRef ReplyTo, DeliveryAttemptOffer Offer)> _pending = new();

        public ControlledTerminalRecipientActor(ActorAddress address)
        {
            _address = address;
            Receive<DeliveryAttemptOffer>(offer => _pending[offer.DeliveryId] = (Sender, offer));
            Receive<InspectPendingAcceptedDeliveries>(_ => Sender.Tell(_pending.Count));
            Receive<ReleaseAcceptedDeliveries>(_ =>
            {
                foreach (var pending in _pending.Values.ToArray())
                {
                    pending.ReplyTo.Tell(new DeliveryAccepted(
                        pending.Offer.DeliveryId,
                        pending.Offer.Envelope.CommandId,
                        _address,
                        "accepted"));
                }

                _pending.Clear();
            });
        }
    }

    private sealed class RejectingRecipientActor : ReceiveActor
    {
        public RejectingRecipientActor(ActorAddress address)
        {
            Receive<DeliveryAttemptOffer>(offer =>
            {
                Sender.Tell(new DeliveryRejected(
                    offer.DeliveryId,
                    offer.Envelope.CommandId,
                    address,
                    new OperationError("delivery_rejected", "Recipient rejected delivery.", false)));
            });
        }
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
}