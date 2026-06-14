using System.Text.Json;
using Akka.Actor;
using Aven.Resources.Human.Contracts;
using Aven.Resources.Human.Contracts.Enums;
using Aven.Resources.Human.Gateways;
using Aven.Resources.Runtime.Gateways;

namespace Aven.Resources.Human.Workers;

using HumanRecovered = ResourceGatewayRail<HumanPromptOperationPayload>.Recovered;
using HumanStoreCommandFailed = ResourceGatewayRail<HumanPromptOperationPayload>.StoreCommandFailed;

internal sealed class HumanTerminalReplyStoreWorkerActor : ReceiveActor
{
    public sealed record LoadTerminalReply(HumanPromptTerminalReplyReady Reply, IActorRef PromptActor);
    public sealed record TerminalReplyLoaded(HumanPromptTerminalReplyReady Reply, ResourceOperationInboxRecord? Record, IActorRef PromptActor);
    public sealed record TerminalReplyLoadFailed(HumanPromptTerminalReplyReady Reply, Exception Exception);

    public sealed record RecordTerminalReplyPending(HumanPromptTerminalReplyReady Reply, HumanRecovered Recovered, IActorRef PromptActor);
    public sealed record TerminalReplyPendingRecorded(HumanPromptTerminalReplyReady Reply, HumanRecovered Recovered, ResourceOperationInboxRecord PendingRecord, IActorRef PromptActor);
    public sealed record TerminalReplyAlreadyDelivered(HumanPromptTerminalReplyReady Reply, ResourceOperationInboxRecord Record, IActorRef PromptActor);

    public sealed record MarkTerminalReplyDelivered(HumanPromptTerminalReplyReady Reply, HumanRecovered Recovered, IActorRef PromptActor);
    public sealed record TerminalReplyDelivered(HumanPromptTerminalReplyReady Reply, ResourceOperationInboxRecord Record, IActorRef PromptActor);

    public sealed record ListPendingTerminalReplies;
    public sealed record PendingTerminalRepliesLoaded(IReadOnlyList<ResourceOperationInboxRecord> Records);

    public sealed record MarkReplayedTerminalReplyDelivered(HumanRecovered Recovered);
    public sealed record ReplayedTerminalReplyMarkedDelivered(HumanRecovered Recovered);

    private readonly IResourceOperationInboxStore _inboxStore;
    private readonly IActorRef _gateway;

    public HumanTerminalReplyStoreWorkerActor(IResourceOperationInboxStore inboxStore, IActorRef gateway)
    {
        _inboxStore = inboxStore;
        _gateway = gateway;

        Receive<LoadTerminalReply>(message => LoadTerminalReplyAsync(message));
        Receive<RecordTerminalReplyPending>(message => RecordTerminalReplyPendingAsync(message));
        Receive<MarkTerminalReplyDelivered>(message => MarkTerminalReplyDeliveredAsync(message));
        Receive<ListPendingTerminalReplies>(_ => ListPendingTerminalRepliesAsync());
        Receive<MarkReplayedTerminalReplyDelivered>(message => MarkReplayedTerminalReplyDeliveredAsync(message));
    }

    private void LoadTerminalReplyAsync(LoadTerminalReply message)
    {
        var gateway = _gateway;
        var self = Self;
        _ = _inboxStore.GetAsync(FormatOperationKey(message.Reply.Key))
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new TerminalReplyLoaded(message.Reply, task.Result, message.PromptActor)
                    : new TerminalReplyLoadFailed(message.Reply, task.Exception?.GetBaseException() ?? new InvalidOperationException("Human prompt terminal reply lookup failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void RecordTerminalReplyPendingAsync(RecordTerminalReplyPending message)
    {
        var gateway = _gateway;
        var self = Self;
        var terminalRecord = CreateTerminalReplyRecord(message.Reply);
        _ = _inboxStore.TryRecordTerminalReplyPendingAsync(message.Recovered.OperationKeyText, terminalRecord)
            .ContinueWith(
                task =>
                {
                    if (!task.IsCompletedSuccessfully)
                    {
                        return (object)new HumanStoreCommandFailed("terminalize_prompt_reply", FormatOperationKey(message.Reply.Key), task.Exception?.GetBaseException() ?? new InvalidOperationException("Human prompt terminal reply terminalization failed."));
                    }

                    var pending = task.Result;
                    if (pending is null)
                    {
                        return new HumanStoreCommandFailed("terminalize_prompt_reply", message.Recovered.OperationKeyText, new InvalidOperationException($"Human prompt terminal reply could not record pending state for inbox row '{message.Recovered.OperationKeyText}'."));
                    }

                    return pending.TerminalReplyDeliveryStatus is ResourceOperationTerminalReplyDeliveryStatus.Delivered
                        ? (object)new TerminalReplyAlreadyDelivered(message.Reply, pending, message.PromptActor)
                        : new TerminalReplyPendingRecorded(message.Reply, message.Recovered, pending, message.PromptActor);
                },
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void MarkTerminalReplyDeliveredAsync(MarkTerminalReplyDelivered message)
    {
        var gateway = _gateway;
        var self = Self;
        _ = _inboxStore.MarkTerminalReplyDeliveredAsync(message.Recovered.OperationKeyText)
            .ContinueWith(
                task =>
                {
                    if (!task.IsCompletedSuccessfully)
                    {
                        return (object)new HumanStoreCommandFailed("mark_terminal_reply_delivered", message.Recovered.OperationKeyText, task.Exception?.GetBaseException() ?? new InvalidOperationException("Human prompt terminal reply delivered mark failed."));
                    }

                    var delivered = task.Result;
                    return delivered is null
                        ? (object)new HumanStoreCommandFailed("mark_terminal_reply_delivered", message.Recovered.OperationKeyText, new InvalidOperationException($"Human prompt terminal reply delivered mark lost inbox row '{message.Recovered.OperationKeyText}'."))
                        : new TerminalReplyDelivered(message.Reply, delivered, message.PromptActor);
                },
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void ListPendingTerminalRepliesAsync()
    {
        var gateway = _gateway;
        var self = Self;
        _ = _inboxStore.ListPendingTerminalRepliesAsync(ResourceKinds.Human)
            .ContinueWith(
                task => task.IsCompletedSuccessfully
                    ? (object)new PendingTerminalRepliesLoaded(task.Result)
                    : new HumanStoreCommandFailed("list_pending_terminal_replies", ResourceKinds.Human, task.Exception?.GetBaseException() ?? new InvalidOperationException("Human prompt pending terminal reply recovery failed.")),
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private void MarkReplayedTerminalReplyDeliveredAsync(MarkReplayedTerminalReplyDelivered message)
    {
        var gateway = _gateway;
        var self = Self;
        _ = _inboxStore.MarkTerminalReplyDeliveredAsync(message.Recovered.OperationKeyText)
            .ContinueWith(
                task =>
                {
                    if (!task.IsCompletedSuccessfully)
                    {
                        return (object)new HumanStoreCommandFailed("mark_terminal_reply_delivered", message.Recovered.OperationKeyText, task.Exception?.GetBaseException() ?? new InvalidOperationException("Replayed human prompt terminal reply delivered mark failed."));
                    }

                    return task.Result is null
                        ? (object)new HumanStoreCommandFailed("mark_terminal_reply_delivered", message.Recovered.OperationKeyText, new InvalidOperationException($"Replayed human terminal reply delivered mark lost inbox row '{message.Recovered.OperationKeyText}'."))
                        : new ReplayedTerminalReplyMarkedDelivered(message.Recovered);
                },
                TaskScheduler.Default)
            .ContinueWith(task => gateway.Tell(task.Result, self), TaskScheduler.Default);
    }

    private static ResourceOperationInboxStore.TerminalReplyRecord CreateTerminalReplyRecord(HumanPromptTerminalReplyReady reply)
    {
        return reply.Status switch
        {
            HumanPromptStatus.Answered when reply.Answer is not null => new ResourceOperationInboxStore.TerminalReplyRecord(
                ResourceOperationInboxStatus.Completed,
                "resolved",
                JsonSerializer.Serialize(new
                {
                    kind = ResourceOperationTypes.HumanAnswer,
                    promptId = reply.PromptId.Value,
                    answer = reply.Answer,
                    answeredAt = reply.AnsweredAt
                }),
                null,
                null),
            HumanPromptStatus.Cancelled => new ResourceOperationInboxStore.TerminalReplyRecord(
                ResourceOperationInboxStatus.Failed,
                "cancelled",
                JsonSerializer.Serialize(new
                {
                    promptId = reply.PromptId.Value,
                    reason = reply.CancelReason ?? "operation_cancelled"
                }),
                "operation_cancelled",
                reply.CancelReason ?? "operation_cancelled"),
            HumanPromptStatus.Expired => new ResourceOperationInboxStore.TerminalReplyRecord(
                ResourceOperationInboxStatus.Failed,
                "timed_out",
                JsonSerializer.Serialize(new
                {
                    promptId = reply.PromptId.Value,
                    error = reply.Error ?? new OperationError("human_prompt_expired", $"Human prompt '{reply.PromptId.Value}' expired before it was answered.", false)
                }),
                (reply.Error ?? new OperationError("human_prompt_expired", $"Human prompt '{reply.PromptId.Value}' expired before it was answered.", false)).Code,
                (reply.Error ?? new OperationError("human_prompt_expired", $"Human prompt '{reply.PromptId.Value}' expired before it was answered.", false)).Message),
            _ => throw new InvalidOperationException($"Unsupported human terminal reply status '{reply.Status}'.")
        };
    }

    private static string FormatOperationKey(OperationKey key)
        => $"{key.Caller.Protocol}|{key.Caller.Value}|{key.RequestId.Value}|{key.OperationType}";
}
