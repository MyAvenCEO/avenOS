using Akka.Actor;
using Aven.Events.Interfaces;

namespace Aven.Api.Runtime;

/// <summary>
/// Subscribes to the actor system's <see cref="Akka.Event.EventStream"/> for every
/// <see cref="IAvenEventEnvelope"/> and forwards it to a registered handler. This is the
/// non-invasive hook the stdio sidecar uses to project durable run/operation lifecycle
/// events into live UI events (milestone plan M8) — no actor lifecycle code is modified;
/// it simply taps the same stream the trace/ledger projections already consume.
/// </summary>
internal sealed class RuntimeEventForwarderActor : ReceiveActor
{
    private readonly Action<IAvenEventEnvelope> _onEnvelope;

    public RuntimeEventForwarderActor(Action<IAvenEventEnvelope> onEnvelope)
    {
        _onEnvelope = onEnvelope;
        Receive<IAvenEventEnvelope>(envelope =>
        {
            try
            {
                _onEnvelope(envelope);
            }
            catch
            {
                // A misbehaving subscriber must never crash the runtime event stream.
            }
        });
    }

    protected override void PreStart() => Context.System.EventStream.Subscribe(Self, typeof(IAvenEventEnvelope));

    protected override void PostStop() => Context.System.EventStream.Unsubscribe(Self);
}
