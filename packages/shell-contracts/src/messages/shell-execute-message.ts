import type { ReplyableMessage } from "../../../actor-contracts/src/types/actor-message.ts";
import type { ArtifactRef } from "artifact-contracts";

export interface ShellExecuteRequest extends ReplyableMessage<"shellExecuteRequest"> {
  readonly type: "shellExecuteRequest";
  readonly command: string;
  readonly timeoutSeconds?: number;
  readonly cwd?: string;
  readonly stdinText?: string;
}

export interface ShellExecuteCompletion {
  readonly type: "shellExecuteCompleted";
  readonly requestId: string;
  readonly result: {
    readonly type: "shell.execute.completion";
    readonly exitCode: number;
    readonly stdoutPreview: string;
    readonly stderrPreview: string;
    readonly stdoutTruncated: boolean;
    readonly stderrTruncated: boolean;
    readonly stdoutArtifact?: ArtifactRef;
    readonly stderrArtifact?: ArtifactRef;
    readonly durationMs: number;
    readonly timedOut: boolean;
  };
}