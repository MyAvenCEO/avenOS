using Akka.Actor;

namespace Aven.Scheduling.Actors.Messages;

internal sealed record ScheduleDeliveryCompleted(string OccurrenceId, DeliveryState Terminal, IActorRef ReplyTo);
