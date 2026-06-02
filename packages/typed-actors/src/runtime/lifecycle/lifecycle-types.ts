import { RestartReasonType, StopReasonType } from "../../core/constants.js";
import type { ActorFailure } from "../supervision/supervision-types.js";

export type StopReason =
  | { readonly type: typeof StopReasonType.Requested }
  | { readonly type: typeof StopReasonType.Completed }
  | { readonly type: typeof StopReasonType.Cancelled }
  | { readonly type: typeof StopReasonType.Supervision; readonly failure: ActorFailure }
  | { readonly type: typeof StopReasonType.ParentStopped }
  | { readonly type: typeof StopReasonType.RuntimeShutdown };

export type RestartReason =
  | { readonly type: typeof RestartReasonType.Supervision; readonly failure: ActorFailure }
  | { readonly type: typeof RestartReasonType.Manual };