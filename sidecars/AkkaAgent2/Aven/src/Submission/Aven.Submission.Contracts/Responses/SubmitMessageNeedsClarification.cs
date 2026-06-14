namespace Aven.Submission.Contracts.Responses;

public sealed record SubmitMessageNeedsClarification(
    string IdempotencyKey,
    bool Idempotent,
    CorrelationId CorrelationId,
    RoutingAttemptId RoutingAttemptId,
    RouteNeedsClarification Decision);