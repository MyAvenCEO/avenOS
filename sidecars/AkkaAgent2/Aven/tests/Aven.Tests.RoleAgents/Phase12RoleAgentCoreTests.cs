using System.Text.Json;
using System.Runtime.CompilerServices;
using Aven.Contracts.Protocol;
using Aven.Roles.Accounting.Schemas;
using Akka.Actor;
using Akka.Configuration;
using Aven.RoleAgents;
using Aven.Akka.Hosting;
using Aven.Resources.Human.Actors;
using OperationCancelledReply = Aven.Contracts.Operations.OperationCancelled;
using OperationFailedReply = Aven.Contracts.Operations.OperationFailed;
using OperationTimedOutReply = Aven.Contracts.Operations.OperationTimedOut;

namespace Aven.Tests.RoleAgents;

public sealed class Phase12RoleAgentCoreTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase12-{Guid.NewGuid():N}.sqlite");

    [Fact]
    public async Task Committed_Input_Opens_WorkItem_And_Starts_Run()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-committed-open");
            var accepted = await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-open"), TimeSpan.FromSeconds(3));
            Assert.Equal("agent_input_recorded", accepted.AcceptanceKind);

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Single(state.OpenWorkItems);
            Assert.Single(state.ActiveRuns);
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);

            await AssertEventually(async () =>
            {
                var workItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), WorkItemStatus.Open, null, CancellationToken.None);
                Assert.Single(workItems);
                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), workItems[0].WorkItemId, RunStatus.Running, null, CancellationToken.None);
                Assert.Single(runs);
            });
        });
    }

    [Fact]
    public async Task One_Active_Run_Per_WorkItem_Is_Enforced()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-run-guard");
            var offer = CreateCommittedOffer("claim-guard");

            await actor.Ask<DeliveryAccepted>(offer, TimeSpan.FromSeconds(3));
            var duplicate = await actor.Ask<DeliveryAccepted>(offer, TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));

            Assert.Equal("duplicate_committed_input", duplicate.AcceptanceKind);
            Assert.Single(state.OpenWorkItems);
            Assert.Single(state.ActiveRuns);
        });
    }

    [Fact]
    public async Task DuplicateCommittedInput_AfterWorkItemClosed_IsIgnoredWithoutReopeningWork()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-duplicate-after-close", ledger);
            var offer = CreateCommittedOffer("claim-duplicate-after-close");

            await actor.Ask<DeliveryAccepted>(offer, TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var llm = Assert.Single(state.PendingOperations.Values);

            state = await actor.Ask<RoleAgentState>(Resolved(llm, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            foreach (var pending in state.PendingOperations.Values.OrderBy(x => x.ContractId).ToArray())
            {
                var replyJson = pending.ContractId == "schedule.create"
                    ? "{\"scheduleId\":\"schedule-contract-LEASE-2027\"}"
                    : "{\"recordId\":\"record-1\"}";
                state = await actor.Ask<RoleAgentState>(Resolved(pending, replyJson), TimeSpan.FromSeconds(3));
            }

            Assert.Equal(RoleAgentStatus.Idle, state.Status);
            Assert.Empty(state.OpenWorkItems);
            Assert.Empty(state.ActiveRuns);
            var duplicate = await actor.Ask<DeliveryAccepted>(offer, TimeSpan.FromSeconds(3));
            var afterDuplicate = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));

            Assert.Equal("duplicate_committed_input", duplicate.AcceptanceKind);
            Assert.Equal(RoleAgentStatus.Idle, afterDuplicate.Status);
            Assert.Empty(afterDuplicate.OpenWorkItems);
            Assert.Empty(afterDuplicate.ActiveRuns);
            Assert.Empty(afterDuplicate.PendingOperations);
            await AssertEventually(async () =>
            {
                var closedWorkItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), WorkItemStatus.Closed, null, CancellationToken.None);
                Assert.Single(closedWorkItems);
                Assert.Equal("work-claim-duplicate-after-close", closedWorkItems[0].WorkItemId.Value);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), closedWorkItems[0].WorkItemId, null, null, CancellationToken.None);
                Assert.Single(runs);
            });
        });
    }

    [Fact]
    public async Task Requested_Role_Operation_Creates_OperationRequested_Ledger_Entry()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-requested");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-requested"), TimeSpan.FromSeconds(3));

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal("llm.generate", pending.ContractId);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Requested, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.Equal("llm.generate", operation.ContractId);
                Assert.Equal("llm", operation.TargetKind);
            });
        });
    }

    [Fact]
    public async Task Successful_Operation_Reply_Completes_Operation()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-completed");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-completed"), TimeSpan.FromSeconds(3));
            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(initial.PendingOperations.Values);

            var next = await actor.Ask<RoleAgentState>(Resolved(pending, ContractExtractionJson()), TimeSpan.FromSeconds(3));

            Assert.DoesNotContain(next.PendingOperations.Values, x => x.OperationId == pending.OperationId);
            Assert.NotEmpty(next.PendingOperations);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Completed, null, CancellationToken.None);
                Assert.Contains(operations, x => x.OperationId == pending.OperationId);
            });
        });
    }

    [Fact]
    public async Task Failed_Operation_Reply_Records_Retryable_Failure()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-failed");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-failed"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);

            var afterFailure = await actor.Ask<RoleAgentState>(Failed(pending, "llm_failed", "provider timeout", retryable: true), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Blocked, afterFailure.Status);
            Assert.Empty(afterFailure.PendingOperations);
            Assert.Empty(afterFailure.ActiveRuns);
            Assert.Single(afterFailure.OpenWorkItems);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var op = Assert.Single(operations);
                Assert.True(op.Retryable);
                Assert.Equal("provider timeout", op.FailureReason);
            });
        });
    }

    [Fact]
    public async Task Operation_DeliveryTerminalFailure_RecordsFailureAndBlocksRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-delivery-terminal-failed");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-delivery-terminal-failed"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);
            var deliveryId = new DeliveryId($"delivery-{pending.OperationId.Value}");

            actor.Tell(
                new DeliveryTerminalSignal(
                    deliveryId,
                    new DeliveryState(
                        deliveryId,
                        new ActorAddress("agent/agent-contract-1", "local"),
                        string.Empty,
                        new ActorAddress("resource/llm", "local"),
                        new CommandId($"cmd-{pending.OperationId.Value}"),
                        "payload-hash",
                        DeliveryStatus.Quarantined,
                        10,
                        null,
                        null,
                        new OperationError("operation_delivery_failed", "Operation delivery ended with status Quarantined.", false))));

            await AssertEventually(async () =>
            {
                var afterFailure = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Equal(RoleAgentStatus.Failed, afterFailure.Status);
                Assert.Equal("Operation delivery ended with status Quarantined.", afterFailure.LastRunSummary);
                Assert.Empty(afterFailure.PendingOperations);
                Assert.Empty(afterFailure.ActiveRuns);
                Assert.Single(afterFailure.OpenWorkItems);
            });

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.Equal("Operation delivery ended with status Quarantined.", operation.FailureReason);
                Assert.False(operation.Retryable ?? true);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), pending.WorkItemId, RunStatus.Failed, null, CancellationToken.None);
                var run = Assert.Single(runs);
                Assert.Equal("Operation delivery ended with status Quarantined.", run.FailureReason);
            });
        });
    }

    [Fact]
    public async Task OperationRejected_ForPendingOperation_RecordsRetryableFailureAndBlocksRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-rejected-blocked");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-rejected-blocked"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);

            var afterRejected = await actor.Ask<RoleAgentState>(Rejected(pending, "operation_rejected", "human review required", retryable: true), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Blocked, afterRejected.Status);
            Assert.Empty(afterRejected.PendingOperations);
            Assert.Empty(afterRejected.ActiveRuns);
            Assert.Single(afterRejected.OpenWorkItems);
            Assert.Equal("human review required", afterRejected.LastRunSummary);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.True(operation.Retryable);
                Assert.Equal("human review required", operation.FailureReason);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), pending.WorkItemId, RunStatus.Blocked, null, CancellationToken.None);
                var run = Assert.Single(runs);
                Assert.Equal("human review required", run.BlockedReason);
            });
        });
    }

    [Fact]
    public async Task OperationRejected_ForPendingOperation_RecordsNonRetryableFailureAndFailsRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-rejected-failed");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-rejected-failed"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);

            var afterRejected = await actor.Ask<RoleAgentState>(Rejected(pending, "operation_rejected", "schema validation failed", retryable: false), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Failed, afterRejected.Status);
            Assert.Empty(afterRejected.PendingOperations);
            Assert.Empty(afterRejected.ActiveRuns);
            Assert.Single(afterRejected.OpenWorkItems);
            Assert.Equal("schema validation failed", afterRejected.LastRunSummary);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.False(operation.Retryable ?? true);
                Assert.Equal("schema validation failed", operation.FailureReason);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), pending.WorkItemId, RunStatus.Failed, null, CancellationToken.None);
                var run = Assert.Single(runs);
                Assert.Equal("schema validation failed", run.FailureReason);
            });
        });
    }

    [Fact]
    public async Task OperationTimedOut_ForPendingOperation_RecordsRetryableFailureAndBlocksRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-timeout-blocked");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-timeout-blocked"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);

            var afterTimedOut = await actor.Ask<RoleAgentState>(TimedOut(pending, "operation_timeout", "operation timed out", retryable: true), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Blocked, afterTimedOut.Status);
            Assert.Empty(afterTimedOut.PendingOperations);
            Assert.Empty(afterTimedOut.ActiveRuns);
            Assert.Single(afterTimedOut.OpenWorkItems);
            Assert.Contains("operation timed out", afterTimedOut.LastRunSummary, StringComparison.Ordinal);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.True(operation.Retryable);
                Assert.Equal("operation timed out", operation.FailureReason);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), pending.WorkItemId, RunStatus.Blocked, null, CancellationToken.None);
                var run = Assert.Single(runs);
                Assert.Contains("operation timed out", run.BlockedReason, StringComparison.Ordinal);
            });
        });
    }

    [Fact]
    public async Task OperationTimedOut_ForPendingOperation_RecordsNonRetryableFailureAndFailsRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-timeout-failed");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-timeout-failed"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);

            var afterTimedOut = await actor.Ask<RoleAgentState>(TimedOut(pending, "operation_timeout", "operation timed out", retryable: false), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Failed, afterTimedOut.Status);
            Assert.Empty(afterTimedOut.PendingOperations);
            Assert.Empty(afterTimedOut.ActiveRuns);
            Assert.Single(afterTimedOut.OpenWorkItems);
            Assert.Contains("operation timed out", afterTimedOut.LastRunSummary, StringComparison.Ordinal);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.False(operation.Retryable ?? true);
                Assert.Equal("operation timed out", operation.FailureReason);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), pending.WorkItemId, RunStatus.Failed, null, CancellationToken.None);
                var run = Assert.Single(runs);
                Assert.Contains("operation timed out", run.FailureReason, StringComparison.Ordinal);
            });
        });
    }

    [Fact]
    public async Task OperationCancelled_ForPendingOperation_FailsRunWithOperationCancelled()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-cancelled");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-cancelled"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(state.PendingOperations.Values);

            var afterCancelled = await actor.Ask<RoleAgentState>(Cancelled(pending), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Failed, afterCancelled.Status);
            Assert.Empty(afterCancelled.PendingOperations);
            Assert.Empty(afterCancelled.ActiveRuns);
            Assert.Single(afterCancelled.OpenWorkItems);
            Assert.Equal("operation_cancelled", afterCancelled.LastRunSummary);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.False(operation.Retryable ?? true);
                Assert.Equal("operation_cancelled", operation.FailureReason);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), pending.WorkItemId, RunStatus.Failed, null, CancellationToken.None);
                var run = Assert.Single(runs);
                Assert.Equal("operation_cancelled", run.FailureReason);
            });
        });
    }

    [Fact]
    public async Task RetryableFailure_WithSiblingPendingOperations_ClearsSiblingsAndBlocksRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-sibling-retryable-failure");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-sibling-retryable-failure"), TimeSpan.FromSeconds(3));

            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var extraction = Assert.Single(initial.PendingOperations.Values);

            var afterExtraction = await actor.Ask<RoleAgentState>(Resolved(extraction, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            Assert.True(afterExtraction.PendingOperations.Count >= 2);

            var failedOperation = afterExtraction.PendingOperations.Values.OrderBy(x => x.RequestedAt).First();
            var siblingOperationIds = afterExtraction.PendingOperations.Values
                .Where(x => x.OperationId != failedOperation.OperationId)
                .Select(x => x.OperationId)
                .ToArray();

            var afterFailure = await actor.Ask<RoleAgentState>(Failed(failedOperation, "metadata_failed", "provider timeout", retryable: true), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Blocked, afterFailure.Status);
            Assert.Empty(afterFailure.ActiveRuns);
            Assert.Empty(afterFailure.PendingOperations);
            Assert.Single(afterFailure.OpenWorkItems);

            await AssertEventually(async () =>
            {
                var failedOperations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), failedOperation.RunId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.Equal(1 + siblingOperationIds.Length, failedOperations.Count);

                var triggering = Assert.Single(failedOperations, x => x.OperationId == failedOperation.OperationId);
                Assert.True(triggering.Retryable);
                Assert.Equal("provider timeout", triggering.FailureReason);

                foreach (var siblingOperationId in siblingOperationIds)
                {
                    var sibling = Assert.Single(failedOperations, x => x.OperationId == siblingOperationId);
                    Assert.False(sibling.Retryable ?? true);
                    Assert.Equal("run_terminated_after_operation_failure", sibling.FailureReason);
                }
            });
        });
    }

    [Fact]
    public async Task Completing_One_Sibling_Operation_Does_Not_ReRequest_Remaining_Siblings()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-sibling-no-rerequest");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-sibling-no-rerequest"), TimeSpan.FromSeconds(3));

            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var extraction = Assert.Single(initial.PendingOperations.Values);

            var afterExtraction = await actor.Ask<RoleAgentState>(Resolved(extraction, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            Assert.True(afterExtraction.PendingOperations.Count >= 2);

            var siblings = afterExtraction.PendingOperations.Values
                .Where(x => x.RunId == afterExtraction.PendingOperations.Values.First().RunId)
                .OrderBy(x => x.RequestedAt)
                .ToArray();

            Assert.True(siblings.Length >= 2);

            var completedOperation = siblings.First();
            var remainingBefore = siblings
                .Where(x => x.OperationId != completedOperation.OperationId)
                .ToDictionary(x => x.OperationId, x => x.RequestedAt);

            var replyJson = completedOperation.ContractId switch
            {
                "schedule.create" => "{\"scheduleId\":\"schedule-contract-LEASE-2027\"}",
                _ => "{\"recordId\":\"record-1\"}"
            };

            var afterCompletion = await actor.Ask<RoleAgentState>(Resolved(completedOperation, replyJson), TimeSpan.FromSeconds(3));

            Assert.DoesNotContain(afterCompletion.PendingOperations.Values, x => x.OperationId == completedOperation.OperationId);

            var remainingAfter = afterCompletion.PendingOperations.Values
                .Where(x => remainingBefore.ContainsKey(x.OperationId))
                .ToDictionary(x => x.OperationId, x => x.RequestedAt);

            Assert.Equal(
                remainingBefore.Keys.OrderBy(x => x.Value).ToArray(),
                remainingAfter.Keys.OrderBy(x => x.Value).ToArray());

            foreach (var pair in remainingBefore)
            {
                Assert.True(remainingAfter.TryGetValue(pair.Key, out var requestedAt));
                Assert.Equal(pair.Value, requestedAt);
            }
        });
    }

    [Fact]
    public async Task NonRetryableFailure_WithSiblingPendingOperations_ClearsSiblingsAndFailsRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-sibling-nonretryable-failure");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-sibling-nonretryable-failure"), TimeSpan.FromSeconds(3));

            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var extraction = Assert.Single(initial.PendingOperations.Values);

            var afterExtraction = await actor.Ask<RoleAgentState>(Resolved(extraction, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            Assert.True(afterExtraction.PendingOperations.Count >= 2);

            var failedOperation = afterExtraction.PendingOperations.Values.OrderBy(x => x.RequestedAt).First();
            var siblingOperationIds = afterExtraction.PendingOperations.Values
                .Where(x => x.OperationId != failedOperation.OperationId)
                .Select(x => x.OperationId)
                .ToArray();

            var afterFailure = await actor.Ask<RoleAgentState>(Failed(failedOperation, "metadata_failed", "schema validation failed", retryable: false), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Failed, afterFailure.Status);
            Assert.Empty(afterFailure.ActiveRuns);
            Assert.Empty(afterFailure.PendingOperations);
            Assert.Single(afterFailure.OpenWorkItems);

            await AssertEventually(async () =>
            {
                var failedOperations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), failedOperation.RunId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.Equal(1 + siblingOperationIds.Length, failedOperations.Count);

                var triggering = Assert.Single(failedOperations, x => x.OperationId == failedOperation.OperationId);
                Assert.False(triggering.Retryable ?? true);
                Assert.Equal("schema validation failed", triggering.FailureReason);

                foreach (var siblingOperationId in siblingOperationIds)
                {
                    var sibling = Assert.Single(failedOperations, x => x.OperationId == siblingOperationId);
                    Assert.False(sibling.Retryable ?? true);
                    Assert.Equal("run_terminated_after_operation_failure", sibling.FailureReason);
                }
            });
        });
    }

    [Fact]
    public async Task WatchdogTimeout_WithSiblingPendingOperations_ClearsSiblingsAndBlocksRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                "phase12-sibling-watchdog-timeout",
                CreateSiblingWatchdogOptions(TimeSpan.FromMilliseconds(200)),
                recipients: new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase));

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-sibling-watchdog-timeout"), TimeSpan.FromSeconds(3));

            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var extraction = Assert.Single(initial.PendingOperations.Values);

            var afterExtraction = await actor.Ask<RoleAgentState>(Resolved(extraction, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            Assert.True(afterExtraction.PendingOperations.Count >= 2);

            var expectedFailedOperationIds = afterExtraction.PendingOperations.Values
                .Select(x => x.OperationId)
                .ToArray();
            var runId = afterExtraction.PendingOperations.Values.First().RunId;

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Equal(RoleAgentStatus.Blocked, state.Status);
                Assert.Empty(state.PendingOperations);
                Assert.Empty(state.ActiveRuns);
            }, attempts: 50, delayMs: 50);

            await AssertEventually(async () =>
            {
                var failedOperations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), runId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.Equal(expectedFailedOperationIds.Length, failedOperations.Count);
                Assert.Contains(failedOperations, x => x.FailureReason.Contains("timed out", StringComparison.OrdinalIgnoreCase));
                Assert.Contains(failedOperations, x => x.FailureReason == "run_terminated_after_operation_failure");
            }, attempts: 50, delayMs: 50);
        });
    }

    [Fact]
    public async Task OperationCancelled_WithSiblingPendingOperations_ClearsSiblingsAndFailsRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-sibling-operation-cancelled");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-sibling-operation-cancelled"), TimeSpan.FromSeconds(3));

            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var extraction = Assert.Single(initial.PendingOperations.Values);

            var afterExtraction = await actor.Ask<RoleAgentState>(Resolved(extraction, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            Assert.True(afterExtraction.PendingOperations.Count >= 2);

            var cancelledOperation = afterExtraction.PendingOperations.Values.OrderBy(x => x.RequestedAt).First();
            var siblingOperationIds = afterExtraction.PendingOperations.Values
                .Where(x => x.OperationId != cancelledOperation.OperationId)
                .Select(x => x.OperationId)
                .ToArray();

            var afterCancelled = await actor.Ask<RoleAgentState>(Cancelled(cancelledOperation), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Failed, afterCancelled.Status);
            Assert.Equal("operation_cancelled", afterCancelled.LastRunSummary);
            Assert.Empty(afterCancelled.PendingOperations);
            Assert.Empty(afterCancelled.ActiveRuns);

            await AssertEventually(async () =>
            {
                var failedOperations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), cancelledOperation.RunId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.Equal(1 + siblingOperationIds.Length, failedOperations.Count);

                var triggering = Assert.Single(failedOperations, x => x.OperationId == cancelledOperation.OperationId);
                Assert.False(triggering.Retryable ?? true);
                Assert.Equal("operation_cancelled", triggering.FailureReason);

                foreach (var siblingOperationId in siblingOperationIds)
                {
                    var sibling = Assert.Single(failedOperations, x => x.OperationId == siblingOperationId);
                    Assert.False(sibling.Retryable ?? true);
                    Assert.Equal("run_terminated_after_operation_failure", sibling.FailureReason);
                }
            });
        });
    }

    [Fact]
    public async Task AcceptedDeliveryWithoutFinalReply_TimesOutPendingOperationAndBlocksRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var deliveryObserver = system.ActorOf(Props.Create(() => new DeliveryObserverActor()));
            var recipient = system.ActorOf(Props.Create(() => new AcceptWithoutReplyRecipientActor(deliveryObserver)));
            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                "phase12-watchdog-accepted-no-reply",
                CreateShortWatchdogOptions(),
                recipients: new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase) { ["llm"] = recipient });

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-watchdog-accepted-no-reply"), TimeSpan.FromSeconds(3));

            DeliveryAttemptOffer? delivery = null;
            await AssertEventually(async () =>
            {
                delivery = await deliveryObserver.Ask<DeliveryAttemptOffer>(new GetObservedDelivery(), TimeSpan.FromSeconds(3));
            }, attempts: 40, delayMs: 50);

            Assert.NotNull(delivery);
            Assert.Equal("llm.generate", delivery!.Envelope.MessageType);

            RoleAgentState timedOutState = null!;
            await AssertEventually(async () =>
            {
                var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Equal(RoleAgentStatus.Blocked, state.Status);
                Assert.Empty(state.PendingOperations);
                Assert.Empty(state.ActiveRuns);
                Assert.Single(state.OpenWorkItems);
                timedOutState = state;
            }, attempts: 40, delayMs: 50);

            Assert.Contains("timed out", timedOutState.LastRunSummary, StringComparison.OrdinalIgnoreCase);
            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), null, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.True(operation.Retryable);
                Assert.Contains("timed out", operation.FailureReason, StringComparison.OrdinalIgnoreCase);
            });
        });
    }

    [Fact]
    public async Task PendingOperationWithMissingRecipient_TimesOutInsteadOfWaitingForever()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                "phase12-watchdog-missing-recipient",
                CreateShortWatchdogOptions(),
                recipients: new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase));

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-watchdog-missing-recipient"), TimeSpan.FromSeconds(3));

            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(initial.PendingOperations.Values);

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Equal(RoleAgentStatus.Blocked, state.Status);
                Assert.Empty(state.PendingOperations);
                Assert.Empty(state.ActiveRuns);
                Assert.Single(state.OpenWorkItems);
            }, attempts: 40, delayMs: 50);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.True(operation.Retryable);
                Assert.Contains("timed out", operation.FailureReason, StringComparison.OrdinalIgnoreCase);
            });
        });
    }

    [Fact]
    public async Task OperationResolvedBeforeWatchdogDeadline_CancelsTimeout()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                "phase12-watchdog-resolved-before-deadline",
                CreateWatchdogOptions(TimeSpan.FromMilliseconds(500)));

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-watchdog-resolved-before-deadline"), TimeSpan.FromSeconds(3));
            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(initial.PendingOperations.Values);

            var afterCompletion = await actor.Ask<RoleAgentState>(Resolved(pending, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            Assert.DoesNotContain(afterCompletion.PendingOperations.Values, x => x.OperationId == pending.OperationId);

            await Task.Delay(900);

            var finalState = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.DoesNotContain(finalState.PendingOperations.Values, x => x.OperationId == pending.OperationId);

            var completed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Completed, null, CancellationToken.None);
            Assert.Contains(completed, x => x.OperationId == pending.OperationId);

            var failed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
            Assert.DoesNotContain(failed, x => x.OperationId == pending.OperationId);
        });
    }

    [Fact]
    public async Task RecoveredPendingOperation_SchedulesWatchdogAndTimesOut()
    {
        const string persistenceId = "phase12-watchdog-recovery";
        await WithSystem(async (system, ledger) =>
        {
            var watchdog = CreateShortWatchdogOptions();
            var deliveryObserver = system.ActorOf(Props.Create(() => new DeliveryObserverActor()));
            var recipient = system.ActorOf(Props.Create(() => new AcceptWithoutReplyRecipientActor(deliveryObserver)));
            var actorName = persistenceId.Replace('/', '-');
            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                persistenceId,
                watchdog,
                recipients: new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase) { ["llm"] = recipient });

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-watchdog-recovery"), TimeSpan.FromSeconds(3));
            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(initial.PendingOperations.Values);

            await actor.GracefulStop(TimeSpan.FromSeconds(5));

            actor = CreateContractWatcherAgentWithWatchdog(system, persistenceId, watchdog, actorNameOverride: actorName);

            await AssertEventually(async () =>
            {
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                var operation = Assert.Single(operations);
                Assert.Contains("timed out", operation.FailureReason, StringComparison.OrdinalIgnoreCase);
            }, attempts: 40, delayMs: 50);

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Blocked, state.Status);
            Assert.Empty(state.PendingOperations);
            Assert.Empty(state.ActiveRuns);
            Assert.Single(state.OpenWorkItems);
        });
    }

    [Fact]
    public async Task RecoveredTerminalRun_DoesNotRetainPendingSiblingOperations()
    {
        const string persistenceId = "phase12-terminal-run-recovery-cleanup";
        await WithSystem(async (system, ledger) =>
        {
            var actorName = persistenceId.Replace('/', '-');
            var actor = CreateContractWatcherAgent(system, persistenceId);

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-terminal-run-recovery-cleanup"), TimeSpan.FromSeconds(3));
            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var extraction = Assert.Single(initial.PendingOperations.Values);

            var afterExtraction = await actor.Ask<RoleAgentState>(Resolved(extraction, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            var failedOperation = afterExtraction.PendingOperations.Values.OrderBy(x => x.RequestedAt).First();

            var afterFailure = await actor.Ask<RoleAgentState>(Failed(failedOperation, "metadata_failed", "provider timeout", retryable: true), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Blocked, afterFailure.Status);
            Assert.Empty(afterFailure.PendingOperations);
            Assert.Empty(afterFailure.ActiveRuns);

            await actor.GracefulStop(TimeSpan.FromSeconds(5));

            actor = CreateContractWatcherAgent(system, persistenceId);

            var recovered = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Blocked, recovered.Status);
            Assert.Equal("provider timeout", recovered.LastRunSummary);
            Assert.Empty(recovered.PendingOperations);
            Assert.Empty(recovered.ActiveRuns);

            await Task.Delay(200);

            var afterDelay = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Blocked, afterDelay.Status);
            Assert.Empty(afterDelay.PendingOperations);
            Assert.Empty(afterDelay.ActiveRuns);

            var failedOperations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), failedOperation.RunId, OperationStatus.Failed, null, CancellationToken.None);
            Assert.True(failedOperations.Count >= 2);
            Assert.Contains(failedOperations, x => x.FailureReason == "run_terminated_after_operation_failure");
        });
    }

    [Fact]
    public async Task LateOperationReplyAfterWatchdog_IsIgnored()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgentWithWatchdog(
                system,
                "phase12-watchdog-late-reply",
                CreateShortWatchdogOptions(),
                recipients: new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase));

            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-watchdog-late-reply"), TimeSpan.FromSeconds(3));
            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(initial.PendingOperations.Values);

            await AssertEventually(async () =>
            {
                var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Equal(RoleAgentStatus.Blocked, state.Status);
                Assert.Empty(state.PendingOperations);
            }, attempts: 40, delayMs: 50);

            var reply = await actor.Ask<object>(Resolved(pending, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            var ignored = Assert.IsType<RoleAgentIgnoredLateReply>(reply);
            Assert.Equal("operation_not_pending", ignored.Reason);

            var stateAfterLateReply = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Blocked, stateAfterLateReply.Status);
            Assert.Empty(stateAfterLateReply.PendingOperations);

            await AssertEventually(async () =>
            {
                var failed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.Contains(failed, x => x.OperationId == pending.OperationId);
            });
        });
    }

    [Fact]
    public async Task LateOperationTimedOutOrCancelled_AfterCompletion_IsIgnored()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-late-timeout-cancel");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-late-timeout-cancel"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(before.PendingOperations.Values);

            var afterCompletion = await actor.Ask<RoleAgentState>(Resolved(pending, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            var pendingKeysAfterCompletion = afterCompletion.PendingOperations.Keys.OrderBy(static x => x.Value).ToArray();

            var timedOutReply = await actor.Ask<object>(TimedOut(pending, "late_timeout", "late timeout should be ignored", retryable: false), TimeSpan.FromSeconds(3));
            var cancelledReply = await actor.Ask<object>(Cancelled(pending), TimeSpan.FromSeconds(3));

            var ignoredTimedOut = Assert.IsType<RoleAgentIgnoredLateReply>(timedOutReply);
            var ignoredCancelled = Assert.IsType<RoleAgentIgnoredLateReply>(cancelledReply);
            Assert.Equal("operation_not_pending", ignoredTimedOut.Reason);
            Assert.Equal("operation_not_pending", ignoredCancelled.Reason);

            var afterLateReplies = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Equal(afterCompletion.Status, afterLateReplies.Status);
            Assert.Equal(pendingKeysAfterCompletion, afterLateReplies.PendingOperations.Keys.OrderBy(static x => x.Value).ToArray());

            await AssertEventually(async () =>
            {
                var completed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Completed, null, CancellationToken.None);
                Assert.Contains(completed, x => x.OperationId == pending.OperationId);

                var failed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.DoesNotContain(failed, x => x.OperationId == pending.OperationId);
            });
        });
    }

    [Fact]
    public void RoleAgentActor_HandlesEveryOperationReplyContract()
    {
        var source = File.ReadAllText(GetRepositoryFilePath(
            ["Aven", "src", "Agent", "Aven.RoleAgents", "RoleAgentActor.cs"],
            callerFilePath: GetCurrentSourceFilePath()));

        Assert.Contains("Command<OperationResolved>", source, StringComparison.Ordinal);
        Assert.Contains("Command<OperationFailureReply>", source, StringComparison.Ordinal);
        Assert.Contains("Command<OperationRejectedReply>", source, StringComparison.Ordinal);
        Assert.Contains("Command<OperationTimedOutReply>", source, StringComparison.Ordinal);
        Assert.Contains("Command<OperationCancelledReply>", source, StringComparison.Ordinal);
        Assert.DoesNotContain("OperationAccepted", source, StringComparison.Ordinal);
        Assert.DoesNotContain("OperationQueued", source, StringComparison.Ordinal);
        Assert.DoesNotContain("OperationAck", source, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LateOperationFailedOrRejected_AfterCompletion_IsIgnored()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-operation-late-replies");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-late-replies"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(before.PendingOperations.Values);

            var afterCompletion = await actor.Ask<RoleAgentState>(Resolved(pending, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            var pendingKeysAfterCompletion = afterCompletion.PendingOperations.Keys.OrderBy(static x => x.Value).ToArray();

            var failedReply = await actor.Ask<object>(Failed(pending, "late_failure", "late failure should be ignored", retryable: false), TimeSpan.FromSeconds(3));
            var rejectedReply = await actor.Ask<object>(Rejected(pending, "late_rejection", "late rejection should be ignored", retryable: true), TimeSpan.FromSeconds(3));

            var ignoredFailed = Assert.IsType<RoleAgentIgnoredLateReply>(failedReply);
            var ignoredRejected = Assert.IsType<RoleAgentIgnoredLateReply>(rejectedReply);
            Assert.Equal("operation_not_pending", ignoredFailed.Reason);
            Assert.Equal("operation_not_pending", ignoredRejected.Reason);

            var afterLateReplies = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Equal(afterCompletion.Status, afterLateReplies.Status);
            Assert.Equal(pendingKeysAfterCompletion, afterLateReplies.PendingOperations.Keys.OrderBy(static x => x.Value).ToArray());

            await AssertEventually(async () =>
            {
                var completed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Completed, null, CancellationToken.None);
                Assert.Contains(completed, x => x.OperationId == pending.OperationId);

                var failed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.DoesNotContain(failed, x => x.OperationId == pending.OperationId);
            });
        });
    }

    [Fact]
    public async Task Committed_Input_Persists_InputArtifact_OnStateAndLedger()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-input-artifact-persisted");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-input-artifact", incomingItemRef: "artifact-contract-2027.pdf"), TimeSpan.FromSeconds(3));

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var openWorkItem = Assert.Single(state.OpenWorkItems.Values);
            Assert.NotNull(openWorkItem.InputArtifact);
            Assert.Equal("artifact-contract-2027.pdf", openWorkItem.InputArtifact!.ArtifactId.Value);
            Assert.Null(openWorkItem.InputArtifact.RevisionId);

            await AssertEventually(async () =>
            {
                var workItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), WorkItemStatus.Open, null, CancellationToken.None);
                var workItem = Assert.Single(workItems);
                Assert.NotNull(workItem.InputArtifact);
                Assert.Equal("artifact-contract-2027.pdf", workItem.InputArtifact!.ArtifactId.Value);
                Assert.Null(workItem.InputArtifact.RevisionId);
            });
        });
    }

    [Fact]
    public async Task CommittedInput_WithSourceArtifact_CapturesArtifactRefOnWorkItem()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-committed-input-artifact-result");

            var accepted = await actor.Ask<DeliveryAccepted>(
                CreateCommittedOffer("claim-committed-input-artifact-result", incomingItemRef: "artifact-x"),
                TimeSpan.FromSeconds(3));

            Assert.Equal("agent_input_recorded", accepted.AcceptanceKind);

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var workItem = Assert.Single(state.OpenWorkItems.Values);
            Assert.NotNull(workItem.InputArtifact);
            Assert.Equal("artifact-x", workItem.InputArtifact!.ArtifactId.Value);
            Assert.Null(workItem.InputArtifact.RevisionId);

            await AssertEventually(async () =>
            {
                var workItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), WorkItemStatus.Open, null, CancellationToken.None);
                var persisted = Assert.Single(workItems);
                Assert.NotNull(persisted.InputArtifact);
                Assert.Equal("artifact-x", persisted.InputArtifact!.ArtifactId.Value);
                Assert.Null(persisted.InputArtifact.RevisionId);
            });
        });
    }

    [Fact]
    public async Task UnknownOperationResolved_OnFreshRoleAgent_IsIgnoredAsOperationNotPending()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-unknown-operation-resolved");
            var correlationId = new CorrelationId("corr-unknown-operation-resolved");

            var reply = await actor.Ask<object>(new OperationResolved(
                new OperationKey(new ActorAddress("caller/a", "local"), new RequestId("unknown-operation-resolved"), "contracts.ingest_document"),
                correlationId,
                new ActorAddress("resource/artifacts", "local"),
                new ActorAddress("resource/artifacts/worker", "local"),
                new OperationValue("contracts.ingest_document", "{}")), TimeSpan.FromSeconds(3));

            var ignored = Assert.IsType<RoleAgentIgnoredLateReply>(reply);
            Assert.Equal("operation_not_pending", ignored.Reason);

            var inspected = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Empty(inspected.OpenWorkItems);
            Assert.Empty(inspected.ActiveRuns);
            Assert.Empty(inspected.PendingOperations);
            Assert.Equal(RoleAgentStatus.Created, inspected.Status);
        });
    }

    [Fact]
    public async Task Completing_Run_Records_Summary_And_Closes_WorkItem()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-run-complete");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-run-complete"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var llm = Assert.Single(state.PendingOperations.Values);

            state = await actor.Ask<RoleAgentState>(Resolved(llm, ContractExtractionJson()), TimeSpan.FromSeconds(3));
            foreach (var pending in state.PendingOperations.Values.OrderBy(x => x.ContractId).ToArray())
            {
                var replyJson = pending.ContractId == "schedule.create"
                    ? "{\"scheduleId\":\"schedule-contract-LEASE-2027\"}"
                    : "{\"recordId\":\"record-1\"}";
                state = await actor.Ask<RoleAgentState>(Resolved(pending, replyJson), TimeSpan.FromSeconds(3));
            }

            Assert.Equal(RoleAgentStatus.Idle, state.Status);
            Assert.Equal("reminder_scheduled", state.LastRunSummary);
            Assert.Empty(state.OpenWorkItems);
            Assert.Empty(state.ActiveRuns);

            await AssertEventually(async () =>
            {
                var workItems = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), WorkItemStatus.Closed, null, CancellationToken.None);
                var workItem = Assert.Single(workItems);
                Assert.Equal("reminder_scheduled", workItem.Outcome);

                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), workItem.WorkItemId, RunStatus.Completed, null, CancellationToken.None);
                var run = Assert.Single(runs);
                Assert.Equal("reminder_scheduled", run.Summary);
            });
        });
    }

    [Fact]
    public async Task Completed_Run_Summary_Can_Patch_Curated_RoleMemoryJson()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-memory-patch");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-memory"), TimeSpan.FromSeconds(3));
            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            state = await actor.Ask<RoleAgentState>(Resolved(Assert.Single(state.PendingOperations.Values), ContractExtractionJson()), TimeSpan.FromSeconds(3));

            foreach (var pending in state.PendingOperations.Values.ToArray())
            {
                state = await actor.Ask<RoleAgentState>(Resolved(pending, pending.ContractId == "schedule.create" ? "{\"scheduleId\":\"schedule-contract-LEASE-2027\"}" : "{\"recordId\":\"record-1\"}"), TimeSpan.FromSeconds(3));
            }

            Assert.False(string.IsNullOrWhiteSpace(state.RoleMemoryJson));
            var roleMemory = JsonSerializer.Deserialize<ContractWatcherRoleState>(state.RoleMemoryJson!);
            Assert.NotNull(roleMemory);
            Assert.Contains("schedule-contract-LEASE-2027", roleMemory!.ReminderIds);
        });
    }

    [Fact]
    public async Task SecondCommittedInput_AfterInvoiceRunSettled_SeesPromotedInvoiceRoleMemory()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateAccountingAgent(system, "phase12-accounting-sequenced-inputs");

            var firstAccepted = await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-invoice",
                    incomingItemRef: "artifact-test-invoice",
                    proposedIntent: "accounting.invoice",
                    contentSummary: "invoice pdf from vendor",
                    requiredSchemas: [new SchemaRef("schema://accounting/invoice@3")]),
                TimeSpan.FromSeconds(3));

            Assert.Equal("agent_input_recorded", firstAccepted.AcceptanceKind);

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var invoiceExtraction = Assert.Single(state.PendingOperations.Values);
            Assert.Equal("llm.generate", invoiceExtraction.ContractId);

            state = await actor.Ask<RoleAgentState>(Resolved(invoiceExtraction, AccountingInvoiceExtractionJson("INV-777")), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            Assert.Equal(1, state.PendingOperations.Count);

            var invoiceMetadataPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataCreate, invoiceMetadataPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceMetadataPending, "{\"recordId\":\"invoice-metadata\"}"), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            var invoiceQueryPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataQuery, invoiceQueryPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceQueryPending, AccountingMetadataQueryResultJson("INV-777", "STMT-EMPTY", "NO-REF", includeStatement: false)), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Idle, state.Status);
            Assert.Equal("invoice_recorded", state.LastRunSummary);
            Assert.Contains("INV-777", state.RoleMemoryJson, StringComparison.Ordinal);
            Assert.Contains("invoice_recorded", state.RoleMemoryJson, StringComparison.Ordinal);
            Assert.Empty(state.PendingOperations);

            var secondAccepted = await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-statement",
                    incomingItemRef: "artifact-test-statement",
                    proposedIntent: "accounting.statement",
                    contentSummary: "bank statement pdf with transaction reference INV-777",
                    requiredSchemas: [new SchemaRef("schema://accounting/account-statement@3")]),
                TimeSpan.FromSeconds(3));

            Assert.Equal("agent_input_recorded", secondAccepted.AcceptanceKind);

            state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var statementExtraction = Assert.Single(state.PendingOperations.Values);
            Assert.Equal("llm.generate", statementExtraction.ContractId);
            Assert.Contains("INV-777", state.ActiveRuns.Values.Single().RunStateJson, StringComparison.Ordinal);

            state = await actor.Ask<RoleAgentState>(Resolved(statementExtraction, AccountingStatementExtractionJson("STMT-777", "INV-777")), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            Assert.Equal(2, state.PendingOperations.Count);

            foreach (var pending in state.PendingOperations.Values.OrderBy(x => x.OperationKey.RequestId.Value, StringComparer.Ordinal).ToArray())
            {
                var replyJson = pending.OperationKey.RequestId.Value.StartsWith("statement-", StringComparison.Ordinal)
                    ? "{\"recordId\":\"statement-metadata\"}"
                    : pending.OperationKey.RequestId.Value.StartsWith("statement-transaction-", StringComparison.Ordinal)
                        ? "{\"recordId\":\"transaction-metadata\"}"
                        : throw new InvalidOperationException($"Unexpected statement side-effect request '{pending.OperationKey.RequestId.Value}'.");

                state = await actor.Ask<RoleAgentState>(Resolved(pending, replyJson), TimeSpan.FromSeconds(3));
            }

            var queryPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataQuery, queryPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(queryPending, AccountingMetadataQueryResultJson("INV-777", "STMT-777", "INV-777")), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            var paymentPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataCreate, paymentPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(paymentPending, "{\"recordId\":\"payment-match-metadata\"}"), TimeSpan.FromSeconds(3));

            Assert.Equal(RoleAgentStatus.Idle, state.Status);
            Assert.Equal("paid", state.LastRunSummary);
            Assert.Contains("INV-777", state.RoleMemoryJson, StringComparison.Ordinal);
            Assert.Contains("paid", state.RoleMemoryJson, StringComparison.Ordinal);
            Assert.Empty(state.OpenWorkItems);
            Assert.Empty(state.ActiveRuns);
            Assert.Empty(state.PendingOperations);
        });
    }

    [Fact]
    public async Task Projection_Tables_Contain_WorkItem_Run_And_Operation_Rows_After_Actor_Events()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-projection-rows");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-projection"), TimeSpan.FromSeconds(3));

            await AssertEventually(async () =>
            {
                Assert.Single(await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), null, null, CancellationToken.None));
                Assert.Single(await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None));
                Assert.Single(await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), null, null, null, CancellationToken.None));
            });
        });
    }

    [Fact]
    public async Task AccountingCommittedInput_WithNonCanonicalStatementCommandType_IsNormalizedToAcceptedInputCommand()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateAccountingAgent(system, "phase12-accounting-noncanonical-statement-command");

            var firstAccepted = await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-invoice-normalize",
                    incomingItemRef: "artifact-test-invoice",
                    proposedIntent: "accounting.invoice",
                    contentSummary: "invoice pdf from vendor",
                    requiredSchemas: [new SchemaRef("schema://accounting/invoice@3")]),
                TimeSpan.FromSeconds(3));

            Assert.Equal("agent_input_recorded", firstAccepted.AcceptanceKind);

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var invoiceExtraction = Assert.Single(state.PendingOperations.Values);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceExtraction, AccountingInvoiceExtractionJson("INV-777")), TimeSpan.FromSeconds(3));

            var invoiceMetadataPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataCreate, invoiceMetadataPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceMetadataPending, "{\"recordId\":\"invoice-metadata\"}"), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            var invoiceQueryPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataQuery, invoiceQueryPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceQueryPending, AccountingMetadataQueryResultJson("INV-777", "STMT-EMPTY", "NO-REF", includeStatement: false)), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Idle, state.Status);
            Assert.Equal("invoice_recorded", state.LastRunSummary);

            var secondAccepted = await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-statement-normalize",
                    incomingItemRef: "artifact-test-statement",
                    proposedIntent: "accounting.statement",
                    contentSummary: "bank statement pdf with transaction reference INV-777",
                    requiredSchemas: [new SchemaRef("schema://accounting/account-statement@3")],
                    commandType: "accounting.statement"),
                TimeSpan.FromSeconds(3));

            Assert.Equal("agent_input_recorded", secondAccepted.AcceptanceKind);

            state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var statementExtraction = Assert.Single(state.PendingOperations.Values);
            Assert.Equal("llm.generate", statementExtraction.ContractId);
            Assert.True(BuiltInRoleBehaviorCatalog.TryResolveAcceptedInputCommand("accountant", "accounting.statement", out var canonicalCommandType));
            Assert.Equal("accounting.ingest_document", canonicalCommandType);
            Assert.Contains("INV-777", state.ActiveRuns.Values.Single().RunStateJson, StringComparison.Ordinal);

            state = await actor.Ask<RoleAgentState>(Resolved(statementExtraction, AccountingStatementExtractionJson("STMT-777", "INV-777")), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            Assert.Equal(2, state.PendingOperations.Count);
        });
    }

    [Fact]
    public async Task AccountingCommittedInput_WithUnknownCommandType_IsRejectedWithoutStartingRun()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateAccountingAgent(system, "phase12-accounting-unknown-command");

            var rejected = await actor.Ask<DeliveryRejected>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-unknown-command",
                    incomingItemRef: "unknown-accounting-source-artifact",
                    proposedIntent: "accounting.statement",
                    contentSummary: "bank statement pdf that would otherwise deserialize",
                    requiredSchemas: [new SchemaRef("schema://accounting/account-statement@3")],
                    commandType: "accounting.unknown"),
                TimeSpan.FromSeconds(3));

            Assert.Equal("unsupported_committed_input_command", rejected.Error.Code);

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Created, state.Status);
            Assert.Empty(state.OpenWorkItems);
            Assert.Empty(state.ActiveRuns);
            Assert.Empty(state.PendingOperations);

            Assert.Empty(await ledger.ListWorkItemsAsync(new RoleAgentId("agent-accounting-1"), null, null, CancellationToken.None));
            Assert.Empty(await ledger.ListRunsAsync(new RoleAgentId("agent-accounting-1"), null, null, null, CancellationToken.None));
            Assert.Empty(await ledger.ListOperationsAsync(new RoleAgentId("agent-accounting-1"), null, null, null, CancellationToken.None));
        });
    }

    [Fact]
    public async Task CommittedInput_WithAlias_PreservesOriginalIntentButUsesCanonicalOperationKey()
    {
        await WithSystem(async (system, _) =>
        {
            var actor = CreateAccountingAgent(system, "phase12-accounting-alias-canonical-operation-key");

            await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-alias-invoice",
                    incomingItemRef: "artifact-test-invoice",
                    proposedIntent: "accounting.invoice",
                    contentSummary: "invoice pdf from vendor",
                    requiredSchemas: [new SchemaRef("schema://accounting/invoice@3")]),
                TimeSpan.FromSeconds(3));

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var invoiceExtraction = Assert.Single(state.PendingOperations.Values);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceExtraction, AccountingInvoiceExtractionJson("INV-777")), TimeSpan.FromSeconds(3));

            foreach (var pending in state.PendingOperations.Values.OrderBy(x => x.OperationKey.RequestId.Value, StringComparer.Ordinal).ToArray())
            {
                var replyJson = pending.OperationKey.RequestId.Value switch
                {
                    var requestId when requestId.StartsWith("invoice-metadata-", StringComparison.Ordinal) => "{\"recordId\":\"invoice-metadata\"}",
                    _ => throw new InvalidOperationException($"Unexpected invoice side-effect request '{pending.OperationKey.RequestId.Value}'.")
                };

                state = await actor.Ask<RoleAgentState>(Resolved(pending, replyJson), TimeSpan.FromSeconds(3));
            }

            const string statementSummary = "bank statement pdf with transaction reference INV-777";
            var accepted = await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-alias-statement",
                    incomingItemRef: "artifact-test-statement",
                    proposedIntent: "accounting.statement",
                    contentSummary: statementSummary,
                    requiredSchemas: [new SchemaRef("schema://accounting/account-statement@3")],
                    commandType: "accounting.statement"),
                TimeSpan.FromSeconds(3));

            Assert.Equal("agent_input_recorded", accepted.AcceptanceKind);
            Assert.True(BuiltInRoleBehaviorCatalog.TryResolveAcceptedInputCommand("accountant", "accounting.statement", out var canonicalCommandType));
            Assert.Equal("accounting.ingest_document", canonicalCommandType);

            state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var openWorkItem = Assert.Single(state.OpenWorkItems.Values.Where(x => x.Subject == statementSummary));
            Assert.Equal(statementSummary, openWorkItem.Subject);
            var statementExtraction = Assert.Single(state.PendingOperations.Values, operation => string.Equals(operation.ContractId, "llm.generate", StringComparison.Ordinal));
            Assert.Equal("llm.generate", statementExtraction.ContractId);

            state = await actor.Ask<RoleAgentState>(Resolved(statementExtraction, AccountingStatementExtractionJson("STMT-777", "INV-777")), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            Assert.Equal(3, state.PendingOperations.Count);
        });
    }

    [Fact]
    public async Task HumanPromptExpiry_FromHumanActorNotification_FailsAccountingRun_AndClearsPendingOperations()
    {
        await WithSystem(async (system, ledger) =>
        {
            var resolver = new LocalActorAddressRegistry();
            var noFinalReplyRecipient = system.ActorOf(Props.Create(() => new AcceptWithoutReplyRecipientActor(system.DeadLetters)), "phase12-human-expiry-no-final-reply");

            var llmAddress = new ActorAddress("resource/llm", "local");
            var metadataAddress = new ActorAddress("resource/metadata", "local");
            var artifactAddress = new ActorAddress("resource/artifact", "local");
            var humanAddress = new ActorAddress("resource/human", "local");
            resolver.Register(llmAddress, noFinalReplyRecipient);
            resolver.Register(metadataAddress, noFinalReplyRecipient);
            resolver.Register(artifactAddress, noFinalReplyRecipient);

            var recipientAddresses = new Dictionary<string, ActorAddress>(StringComparer.OrdinalIgnoreCase)
            {
                ["llm"] = llmAddress,
                ["metadata"] = metadataAddress,
                ["artifact"] = artifactAddress,
                ["human"] = humanAddress
            };

            var actor = system.ActorOf(
                Props.Create(() => new RoleAgentActor(
                    "phase12-human-expiry-accounting-run",
                    new RoleAgentId("agent-accounting-1"),
                    new RoleDescriptor("accountant", "Accountant"),
                    "Handle invoices and statements",
                    resolver,
                    recipientAddresses)),
                "phase12-human-expiry-accounting-run");
            resolver.Register(new ActorAddress("agent/agent-accounting-1", "local"), actor);

            await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-human-expiry-invoice",
                    incomingItemRef: "artifact-test-invoice",
                    proposedIntent: "accounting.invoice",
                    contentSummary: "invoice pdf from vendor",
                    requiredSchemas: [new SchemaRef("schema://accounting/invoice@3")]),
                TimeSpan.FromSeconds(3));

            var state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var invoiceExtraction = Assert.Single(state.PendingOperations.Values);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceExtraction, AccountingInvoiceExtractionJson("INV-HUMAN-EXP")), TimeSpan.FromSeconds(3));

            var invoiceMetadataPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataCreate, invoiceMetadataPending.ContractId);
            Assert.StartsWith("invoice-metadata-", invoiceMetadataPending.OperationKey.RequestId.Value, StringComparison.Ordinal);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceMetadataPending, "{\"recordId\":\"invoice-metadata\"}"), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.WaitingForOperation, state.Status);
            var invoiceQueryPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataQuery, invoiceQueryPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(invoiceQueryPending, AccountingMetadataQueryResultJson("INV-HUMAN-EXP", "STMT-EMPTY", "NO-REF", includeStatement: false)), TimeSpan.FromSeconds(3));
            Assert.Equal(RoleAgentStatus.Idle, state.Status);

            await actor.Ask<DeliveryAccepted>(
                CreateAccountingCommittedOffer(
                    claimId: "claim-accounting-human-expiry-statement",
                    incomingItemRef: "artifact-test-statement",
                    proposedIntent: "accounting.statement",
                    contentSummary: "bank statement pdf with uncertain transaction reference",
                    requiredSchemas: [new SchemaRef("schema://accounting/account-statement@3")]),
                TimeSpan.FromSeconds(3));

            state = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var statementExtraction = Assert.Single(state.PendingOperations.Values);
            state = await actor.Ask<RoleAgentState>(Resolved(statementExtraction, AccountingStatementExtractionJson("STMT-HUMAN-EXP", "UNMATCHED-REF")), TimeSpan.FromSeconds(3));

            foreach (var pending in state.PendingOperations.Values.OrderBy(x => x.OperationKey.RequestId.Value, StringComparer.Ordinal).ToArray())
            {
                var replyJson = pending.OperationKey.RequestId.Value.StartsWith("statement-", StringComparison.Ordinal)
                    ? "{\"recordId\":\"statement-metadata\"}"
                    : pending.OperationKey.RequestId.Value.StartsWith("statement-transaction-", StringComparison.Ordinal)
                        ? "{\"recordId\":\"transaction-metadata\"}"
                        : throw new InvalidOperationException($"Unexpected statement side-effect request '{pending.OperationKey.RequestId.Value}'.");

                state = await actor.Ask<RoleAgentState>(Resolved(pending, replyJson), TimeSpan.FromSeconds(3));
            }

            var queryPending = Assert.Single(state.PendingOperations.Values);
            Assert.Equal(ResourceOperationTypes.MetadataQuery, queryPending.ContractId);
            state = await actor.Ask<RoleAgentState>(Resolved(queryPending, AccountingMetadataQueryResultJson("INV-HUMAN-EXP", "STMT-HUMAN-EXP", "UNMATCHED-REF")), TimeSpan.FromSeconds(3));

            var pendingHuman = Assert.Single(state.PendingOperations.Values, x => x.ContractId == "human.approve");
            var humanPlan = JsonSerializer.Deserialize<HumanPromptOperationPayload>(pendingHuman.Input.Json)
                ?? throw new InvalidOperationException("Human prompt payload was empty.");

            var promptActor = system.ActorOf(
                Props.Create(() => new HumanPromptActor(
                    "phase12/human-prompts/payment-match-review",
                    pendingHuman.OperationKey,
                    new CorrelationId($"corr-{pendingHuman.OperationId.Value}"),
                    humanAddress,
                    humanPlan.PromptText,
                    DateTimeOffset.UtcNow.AddMilliseconds(200),
                    null,
                    null,
                    null,
                    resolver)),
                "phase12-human-prompt-expiry-owner-notify");
            _ = await promptActor.Ask<Aven.Resources.Human.Contracts.State.HumanPromptState>(new Aven.Resources.Human.Contracts.Commands.HumanPromptEnsureRegistered(), TimeSpan.FromSeconds(3));

            RoleAgentState failedState = null!;
            await AssertEventually(async () =>
            {
                var current = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
                Assert.Equal(RoleAgentStatus.Failed, current.Status);
                Assert.Empty(current.PendingOperations);
                Assert.Empty(current.ActiveRuns);
                Assert.Contains("retry budget", current.LastRunSummary ?? string.Empty, StringComparison.OrdinalIgnoreCase);
                Assert.Contains("delivery", current.LastRunSummary ?? string.Empty, StringComparison.OrdinalIgnoreCase);
                failedState = current;
            }, attempts: 80, delayMs: 50);

            Assert.NotNull(failedState);

            await AssertEventually(async () =>
            {
                var failedRuns = await ledger.ListRunsAsync(new RoleAgentId("agent-accounting-1"), null, RunStatus.Failed, null, CancellationToken.None);
                var run = Assert.Single(failedRuns);
                Assert.Contains("retry budget", run.FailureReason ?? string.Empty, StringComparison.OrdinalIgnoreCase);
                Assert.Contains("delivery", run.FailureReason ?? string.Empty, StringComparison.OrdinalIgnoreCase);

                var failedOperations = await ledger.ListOperationsAsync(new RoleAgentId("agent-accounting-1"), run.RunId, OperationStatus.Failed, null, CancellationToken.None);
                Assert.Contains(failedOperations, x => x.FailureReason == "run_terminated_after_operation_failure");
                Assert.Contains(failedOperations, x => x.ContractId == "human.approve" && x.FailureReason?.Contains("retry budget", StringComparison.OrdinalIgnoreCase) == true);
            }, attempts: 80, delayMs: 50);
        });
    }

    [Fact]
    public async Task Query_Store_Lists_WorkItems_By_RoleAgent_And_Status()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-query-workitems");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-query-workitems"), TimeSpan.FromSeconds(3));

            await AssertEventually(async () =>
            {
                var open = await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), WorkItemStatus.Open, 10, CancellationToken.None);
                Assert.Single(open);
            });
        });
    }

    [Fact]
    public async Task Query_Store_Lists_Runs_By_WorkItem_And_Status()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-query-runs");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-query-runs"), TimeSpan.FromSeconds(3));

            await AssertEventually(async () =>
            {
                var workItem = Assert.Single(await ledger.ListWorkItemsAsync(new RoleAgentId("agent-contract-1"), WorkItemStatus.Open, 10, CancellationToken.None));
                var runs = await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), workItem.WorkItemId, RunStatus.Running, 10, CancellationToken.None);
                Assert.Single(runs);
            });
        });
    }

    [Fact]
    public async Task Query_Store_Lists_Operations_By_Run_And_Status()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-query-operations");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-query-operations"), TimeSpan.FromSeconds(3));

            await AssertEventually(async () =>
            {
                var run = Assert.Single(await ledger.ListRunsAsync(new RoleAgentId("agent-contract-1"), null, RunStatus.Running, 10, CancellationToken.None));
                var operations = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), run.RunId, OperationStatus.Requested, 10, CancellationToken.None);
                Assert.Single(operations);
            });
        });
    }

    [Fact]
    public async Task RoleAgent_State_Does_Not_Retain_Completed_Operation_History_After_Completion()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-bounded-state");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-bounded-state"), TimeSpan.FromSeconds(3));
            var before = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var firstPending = Assert.Single(before.PendingOperations.Values);

            var after = await actor.Ask<RoleAgentState>(Resolved(firstPending, ContractExtractionJson()), TimeSpan.FromSeconds(3));

            Assert.DoesNotContain(after.PendingOperations.Values, x => x.OperationId == firstPending.OperationId);

            await AssertEventually(async () =>
            {
                var completed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), firstPending.RunId, OperationStatus.Completed, 10, CancellationToken.None);
                Assert.Contains(completed, x => x.OperationId == firstPending.OperationId);
            });
        });
    }

    [Fact]
    [Trait("Category", "FoundationRail")]
    public async Task OperationReply_WithSameRequestAndType_ButWrongCaller_IsIgnored()
    {
        await WithSystem(async (system, ledger) =>
        {
            var actor = CreateContractWatcherAgent(system, "phase12-wrong-caller");
            await actor.Ask<DeliveryAccepted>(CreateCommittedOffer("claim-wrong-caller"), TimeSpan.FromSeconds(3));
            var initial = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            var pending = Assert.Single(initial.PendingOperations.Values);

            var wrongCallerReply = new OperationResolved(
                pending.OperationKey with { Caller = new ActorAddress("resource/llm", "local") },
                new CorrelationId($"corr-wrong-caller-{pending.OperationId.Value}"),
                new ActorAddress("resource/llm", "local"),
                new ActorAddress("resource/llm/worker", "local"),
                new OperationValue(pending.ContractId, ContractExtractionJson()));

            var reply = await actor.Ask<object>(wrongCallerReply, TimeSpan.FromSeconds(3));

            var ignored = Assert.IsType<RoleAgentIgnoredLateReply>(reply);
            Assert.True(
                ignored.Reason.Contains("pending", StringComparison.OrdinalIgnoreCase)
                || ignored.Reason.Contains("caller", StringComparison.OrdinalIgnoreCase)
                || ignored.Reason.Contains("operation_key", StringComparison.OrdinalIgnoreCase),
                $"Expected a rejection reason that references pending state, caller mismatch, or operation key mismatch, but got '{ignored.Reason}'.");

            var after = await actor.Ask<RoleAgentState>(new InspectRoleAgent(), TimeSpan.FromSeconds(3));
            Assert.Contains(after.PendingOperations.Values, x => x.OperationId == pending.OperationId);

            await Task.Delay(200);
            var completed = await ledger.ListOperationsAsync(new RoleAgentId("agent-contract-1"), pending.RunId, OperationStatus.Completed, null, CancellationToken.None);
            Assert.DoesNotContain(completed, x => x.OperationId == pending.OperationId);
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

    private async Task WithSystem(Func<ActorSystem, RoleAgentLedgerStore, Task> action)
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

        var system = ActorSystem.Create($"aven-phase12-{Guid.NewGuid():N}", config);
        var ledger = new RoleAgentLedgerStore($"Data Source={_databasePath}");
        _ = system.ActorOf(Props.Create(() => new RoleAgentLedgerProjectionActor(ledger)), $"phase12-ledger-projection-{Guid.NewGuid():N}");
        try
        {
            await action(system, ledger);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static IActorRef CreateContractWatcherAgent(ActorSystem system, string persistenceId, IRoleAgentLedgerQuery? ledgerQuery = null) =>
        system.ActorOf(
            Props.Create(() => new RoleAgentActor(
                persistenceId,
                new RoleAgentId("agent-contract-1"),
                new RoleDescriptor("contract_watcher", "Contract Watcher"),
                "Track contract renewals",
                null,
                null,
                null,
                ledgerQuery)),
            $"{persistenceId.Replace('/', '-')}-{Guid.NewGuid():N}");

    private static IActorRef CreateContractWatcherAgentWithWatchdog(
        ActorSystem system,
        string persistenceId,
        RoleAgentOperationWatchdogOptions watchdogOptions,
        IReadOnlyDictionary<string, IActorRef>? recipients = null,
        string? actorNameOverride = null,
        IRoleAgentLedgerQuery? ledgerQuery = null)
    {
        var resolver = new LocalActorAddressRegistry();
        var recipientAddresses = new Dictionary<string, ActorAddress>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in recipients ?? new Dictionary<string, IActorRef>(StringComparer.OrdinalIgnoreCase))
        {
            var address = new ActorAddress($"resource/{pair.Key}", "local");
            resolver.Register(address, pair.Value);
            recipientAddresses[pair.Key] = address;
        }

        return system.ActorOf(
            Props.Create(() => new RoleAgentActor(
                persistenceId,
                new RoleAgentId("agent-contract-1"),
                new RoleDescriptor("contract_watcher", "Contract Watcher"),
                "Track contract renewals",
                resolver,
                recipientAddresses,
                watchdogOptions,
                ledgerQuery)),
            actorNameOverride ?? persistenceId.Replace('/', '-'));
    }

    private static IActorRef CreateAccountingAgent(ActorSystem system, string persistenceId, IRoleAgentLedgerQuery? ledgerQuery = null) =>
        system.ActorOf(
            Props.Create(() => new RoleAgentActor(
                persistenceId,
                new RoleAgentId("agent-accounting-1"),
                new RoleDescriptor("accountant", "Accountant"),
                "Handle invoices and statements",
                null,
                null,
                null,
                ledgerQuery)),
            persistenceId.Replace('/', '-'));

    private static DeliveryAttemptOffer CreateCommittedOffer(string claimId, string incomingItemRef = "lease-2027.pdf")
    {
        var command = new ContractWatcherDocumentCommand(
            new RoutingAttemptId($"route-{claimId}"),
            new WorkOfferId($"offer-{claimId}"),
            new WorkClaimId(claimId),
            new RoleAgentId("agent-contract-1"),
            incomingItemRef,
            Array.Empty<string>(),
            "lease renewal packet",
            "contracts.renewal",
            "router proposal",
            [new SchemaRef("schema://contracts/contract-summary@1")],
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"));

        var committed = new CommittedWorkItem(
            new WorkClaimId(claimId),
            new RoutingAttemptId($"route-{claimId}"),
            new RoleAgentId("agent-contract-1"),
            incomingItemRef,
            Array.Empty<string>(),
            "lease renewal packet",
            "contracts.ingest_document",
            JsonSerializer.Serialize(command),
            "contracts",
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"),
            "contracts.renewal",
            "router proposal");

        var payload = JsonSerializer.Serialize(committed);
        var envelope = new AvenEnvelope<string>(
            new CommandId($"cmd-{claimId}"),
            new MessageId($"msg-{claimId}"),
            new ActorAddress("intake/a", "local"),
            new ActorAddress("agent/agent-contract-1", "local"),
            new ActorAddress("intake/a", "local"),
            new CorrelationId($"corr-{claimId}"),
            CommittedWorkItem.MessageType,
            1,
            payload,
            null,
            null,
            DateTimeOffset.UtcNow);

        return new DeliveryAttemptOffer(new DeliveryId($"delivery-{claimId}"), envelope, PersistedCommandPayload.FromInlineJson(payload).Hash);
    }

    private static DeliveryAttemptOffer CreateAccountingCommittedOffer(
        string claimId,
        string incomingItemRef,
        string proposedIntent,
        string contentSummary,
        IReadOnlyList<SchemaRef> requiredSchemas,
        string commandType = "accounting.ingest_document")
    {
        var command = new AccountingDocumentCommand(
            new RoutingAttemptId($"route-{claimId}"),
            new WorkOfferId($"offer-{claimId}"),
            new WorkClaimId(claimId),
            new RoleAgentId("agent-accounting-1"),
            incomingItemRef,
            [incomingItemRef],
            contentSummary,
            proposedIntent,
            "router proposal",
            requiredSchemas,
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"));

        var committed = new CommittedWorkItem(
            new WorkClaimId(claimId),
            new RoutingAttemptId($"route-{claimId}"),
            new RoleAgentId("agent-accounting-1"),
            incomingItemRef,
            [incomingItemRef],
            contentSummary,
            commandType,
            JsonSerializer.Serialize(command),
            "accounting",
            new CorrelationId($"corr-{claimId}"),
            new ActorAddress("router/a", "local"),
            proposedIntent,
            "router proposal");

        var payload = JsonSerializer.Serialize(committed);
        var envelope = new AvenEnvelope<string>(
            new CommandId($"cmd-{claimId}"),
            new MessageId($"msg-{claimId}"),
            new ActorAddress("intake/a", "local"),
            new ActorAddress("agent/agent-accounting-1", "local"),
            new ActorAddress("intake/a", "local"),
            new CorrelationId($"corr-{claimId}"),
            CommittedWorkItem.MessageType,
            1,
            payload,
            null,
            null,
            DateTimeOffset.UtcNow);

        return new DeliveryAttemptOffer(new DeliveryId($"delivery-{claimId}"), envelope, PersistedCommandPayload.FromInlineJson(payload).Hash);
    }

    private static OperationResolved Resolved(PendingOperationState pending, string valueJson) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}/worker", "local"),
            new OperationValue(pending.ContractId, valueJson));

    private static OperationFailedReply Failed(PendingOperationState pending, string code, string message, bool retryable) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}/worker", "local"),
            new OperationError(code, message, retryable));

    private static OperationRejected Rejected(PendingOperationState pending, string code, string message, bool retryable) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new OperationError(code, message, retryable));

    private static OperationTimedOutReply TimedOut(PendingOperationState pending, string code, string message, bool retryable) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}/worker", "local"),
            new OperationError(code, message, retryable));

    private static OperationCancelledReply Cancelled(PendingOperationState pending) =>
        new(
            pending.OperationKey,
            new CorrelationId($"corr-{pending.OperationId.Value}"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"),
            new ActorAddress($"resource/{pending.TargetKind}", "local"));

    private static string ContractExtractionJson() =>
        "{\"structuredJson\":{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"2030-01-01T00:00:00Z\",\"reminderText\":\"Review lease renewal\",\"renewalTermJson\":{\"contractId\":\"LEASE-2027\",\"renewalDate\":\"2030-01-01T00:00:00Z\"}}}";

    private static string AccountingInvoiceExtractionJson(string invoiceNumber) => JsonSerializer.Serialize(new
    {
        structuredJson = new
        {
            vendor = new { name = "Example GmbH", banking_accounts = Array.Empty<object>() },
            buyer = new { name = "Buyer GmbH", banking_accounts = Array.Empty<object>() },
            header = new
            {
                document_kind = "invoice",
                letter_date = "2026-01-05",
                due_date = "2026-01-31",
                referenced_invoice_numbers = Array.Empty<string>(),
                issue_date = "2026-01-05",
                invoice_number = invoiceNumber,
                order_number = (string?)null,
                customer_number = (string?)null,
                reference_entries = Array.Empty<object>(),
                currency = "EUR"
            },
            payment_instructions = "Transfer",
            totals = new { subtotal = 100m, tax_breakdown = Array.Empty<object>(), tax_total = 25.5m, invoice_total = 125.5m },
            payments = Array.Empty<object>(),
            total_outstanding = 125.5m,
            statements = new[]
            {
                new { section_title = "Services", service_period = "2026-01", line_items = Array.Empty<object>(), line_groups = Array.Empty<object>(), service_period_normalized = (object?)null }
            }
        },
        artifactId = "artifact-test-invoice",
        revisionId = "revision-test-invoice"
    });

    private static string AccountingStatementExtractionJson(string statementId, string transactionReference) => JsonSerializer.Serialize(new
    {
        structuredJson = new
        {
            statement_kind = "periodic_account_statement",
            statement_id = statementId,
            statement_issue_date = "2026-02-01",
            currency = "EUR",
            period_start = "2026-01-01",
            period_end = "2026-02-10",
            payment_due_date = (string?)null,
            opening_balance = 0m,
            closing_balance = 1000m,
            account_holder = new { name = "Buyer GmbH" },
            institution = new { name = "Bank AG" },
            account_overview = new { iban = "DE123", bic = "BANKDEFF", account_number = "123", product_name = "Business" },
            transactions = new[]
            {
                new
                {
                    booking_date = "2026-02-03",
                    booking_date_as_printed = "03.02.2026",
                    value_date = "2026-02-03",
                    description = $"Payment {transactionReference}",
                    counterparty_name = "Example GmbH",
                    transaction_id = $"TX-{statementId}",
                    amount = -125.50m,
                    title = "Invoice payment",
                    fx_surcharge_eur = (decimal?)null,
                    original_amount = (decimal?)null,
                    original_currency = (string?)null,
                    exchange_rate = (string?)null,
                    balance_after = 874.5m
                }
            },
            notes = (string?)null
        },
        artifactId = "artifact-test-statement",
        revisionId = "revision-test-statement"
    });

    // Canonical @3 EUR money object: minor_units = amount * 100.
    private static object EurMoney(decimal amount) => new { amount, currency = "EUR", minor_units = (long)(amount * 100m) };

    // Canonical invoice@3 record (flat fields + Money objects) as it is STORED and read by the matcher.
    private static string CanonicalInvoiceJson(string invoiceNumber) => JsonSerializer.Serialize(new
    {
        vendor_name = "Example GmbH",
        invoice_number = invoiceNumber,
        issue_date = "2026-01-05",
        due_date = "2026-01-31",
        currency = "EUR",
        subtotal = EurMoney(100m),
        tax_total = EurMoney(25.5m),
        invoice_total = EurMoney(125.5m),
        total_outstanding = EurMoney(125.5m),
        normalization = new { source_schema = "schema://accounting/invoice-extraction@1", issues = Array.Empty<object>() },
        source_document = new { }
    });

    // Canonical account-statement@3 record (flat fields, canonical transactions with Money amounts).
    private static string CanonicalStatementJson(string statementId, string transactionReference) => JsonSerializer.Serialize(new
    {
        institution_name = "Bank AG",
        account_iban = "DE123",
        currency = "EUR",
        period_start = "2026-01-01",
        period_end = "2026-02-10",
        opening_balance = EurMoney(0m),
        closing_balance = EurMoney(1000m),
        transaction_count = 1,
        transactions = new[]
        {
            new
            {
                transaction_id = $"TX-{statementId}",
                transaction_index = 0,
                booking_date = "2026-02-03",
                booking_date_as_printed = "03.02.2026",
                value_date = "2026-02-03",
                description = $"Payment {transactionReference}",
                counterparty_name = "Example GmbH",
                title = "Invoice payment",
                amount = EurMoney(-125.50m),
                direction = "debit",
                original_amount = (object?)null,
                original_currency = (string?)null,
                exchange_rate = (string?)null,
                balance_after = EurMoney(874.5m)
            }
        },
        normalization = new { source_schema = "schema://accounting/account-statement-extraction@1", issues = Array.Empty<object>() },
        source_document = new { }
    });

    private static string AccountingMetadataQueryResultJson(string invoiceNumber, string statementId, string transactionReference, bool includeStatement = true) => JsonSerializer.Serialize(new MetadataQueryOperationResult(
        includeStatement
            ? [
                new MetadataRecordSnapshot(
                    "meta-invoice",
                    "accounting-invoice",
                    $"invoice:examplegmbh:{invoiceNumber.ToLowerInvariant()}:abc123",
                    "artifact-test-invoice",
                    "revision-test-invoice",
                    AccountingSchemaRefs.InvoiceV3.Value,
                    CanonicalInvoiceJson(invoiceNumber),
                    "hash-invoice",
                    DateTimeOffset.UtcNow,
                    "invoice"),
                new MetadataRecordSnapshot(
                    "meta-statement",
                    "accounting-account-statement",
                    $"statement:bankag:{statementId.ToLowerInvariant()}:def456",
                    "artifact-test-statement",
                    "revision-test-statement",
                    AccountingSchemaRefs.AccountStatementV3.Value,
                    CanonicalStatementJson(statementId, transactionReference),
                    "hash-statement",
                    DateTimeOffset.UtcNow,
                    "statement")
            ]
            : [
                new MetadataRecordSnapshot(
                    "meta-invoice",
                    "accounting-invoice",
                    $"invoice:examplegmbh:{invoiceNumber.ToLowerInvariant()}:abc123",
                    "artifact-test-invoice",
                    "revision-test-invoice",
                    AccountingSchemaRefs.InvoiceV3.Value,
                    CanonicalInvoiceJson(invoiceNumber),
                    "hash-invoice",
                    DateTimeOffset.UtcNow,
                    "invoice")
            ],
        false,
        200));

    private static async Task AssertEventually(Func<Task> assertion, int attempts = 30, int delayMs = 100)
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

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);
    private static RoleAgentOperationWatchdogOptions CreateShortWatchdogOptions() => CreateWatchdogOptions(TimeSpan.FromMilliseconds(200));

    private static RoleAgentOperationWatchdogOptions CreateWatchdogOptions(TimeSpan timeout) =>
        new(
            DefaultTimeout: null,
            TargetKindTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase)
            {
                ["llm"] = timeout
            },
            ContractIdTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase),
            TimeoutRetryable: true);

    private static RoleAgentOperationWatchdogOptions CreateSiblingWatchdogOptions(TimeSpan timeout) =>
        new(
            DefaultTimeout: null,
            TargetKindTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase)
            {
                ["llm"] = timeout,
                ["metadata"] = timeout,
                ["schedule"] = timeout
            },
            ContractIdTimeouts: new Dictionary<string, TimeSpan?>(StringComparer.OrdinalIgnoreCase)
            {
                ["metadata.create"] = timeout,
                ["schedule.create"] = timeout
            },
            TimeoutRetryable: true);

    private sealed record GetObservedDelivery;

    private sealed class DeliveryObserverActor : ReceiveActor
    {
        private DeliveryAttemptOffer? _offer;

        public DeliveryObserverActor()
        {
            Receive<DeliveryAttemptOffer>(offer => _offer = offer);
            Receive<GetObservedDelivery>(_ => Sender.Tell(_offer ?? throw new InvalidOperationException("No delivery observed.")));
        }
    }

    private sealed class AcceptWithoutReplyRecipientActor : ReceiveActor
    {
        public AcceptWithoutReplyRecipientActor(IActorRef observer)
        {
            Receive<DeliveryAttemptOffer>(offer =>
            {
                observer.Tell(offer);
                Sender.Tell(new DeliveryAccepted(offer.DeliveryId, offer.Envelope.CommandId, offer.Envelope.Recipient, "accepted_no_final_reply"));
            });
        }
    }

    private static string GetRepositoryFilePath(string[] relativeSegments, string callerFilePath)
    {
        var directory = new DirectoryInfo(Path.GetDirectoryName(callerFilePath) ?? Environment.CurrentDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "Aven.sln");
            if (File.Exists(candidate))
            {
                return Path.Combine([directory.FullName, .. relativeSegments]);
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException($"Could not locate repository file '{Path.Combine(relativeSegments)}' from caller path '{callerFilePath}'.");
    }

    private static string GetCurrentSourceFilePath([CallerFilePath] string callerFilePath = "") => callerFilePath;
}