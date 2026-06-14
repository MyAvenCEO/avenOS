using Akka.Actor;

namespace Aven.Scheduling.Actors.Messages;

internal sealed record ScheduleDeliveryFailed(string OccurrenceId, OperationError Error, IActorRef ReplyTo);
