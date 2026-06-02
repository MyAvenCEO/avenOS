import { spawn } from "node:child_process";
import { once } from "node:events";
import { Buffer } from "node:buffer";
import type { ArtifactDescriptor, ArtifactRef } from "artifact-contracts";
import type { CreateMetadataRecordMessage } from "metadata-contracts";
import type { ShellExecuteRequest, ShellToolConfig } from "../../shell-contracts/src/index.ts";
import { sanitizeAndTruncateShellPreview } from "./shell-sanitize.ts";

export interface ShellExecuteDependencies {
  readonly config: ShellToolConfig;
  putArtifact(input: {
    readonly bytes: Uint8Array;
    readonly declaredMimeType: string;
    readonly filename: string;
    readonly createdAt: string;
    readonly source: { readonly kind: "shellOutput"; readonly uri: string };
  }): Promise<ArtifactDescriptor>;
  createMetadata(message: CreateMetadataRecordMessage): void;
  logError(message: string, error: unknown): void;
}

interface CollectedStream {
  readonly text: string;
  readonly limitExceeded: boolean;
}

function normalizeTimeoutSeconds(config: ShellToolConfig, request: ShellExecuteRequest): number {
  const requested = request.timeoutSeconds ?? config.defaultTimeoutSeconds;
  if (!Number.isFinite(requested) || requested <= 0) {
    return config.defaultTimeoutSeconds;
  }
  return Math.min(requested, config.maxTimeoutSeconds);
}

function enforceAllowedCommand(config: ShellToolConfig, command: string): void {
  if (config.allowedCommands.length === 0) {
    return;
  }
  const allowed = config.allowedCommands.some((entry: string) => command.trim().startsWith(entry));
  if (!allowed) {
    throw new Error(`Command rejected by allowlist: ${command}`);
  }
}

async function collectStream(stream: NodeJS.ReadableStream | null, maxMemoryBytes: number, onLimit: () => void): Promise<CollectedStream> {
  if (!stream) {
    return { text: "", limitExceeded: false };
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let limitExceeded = false;
  stream.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (limitExceeded) {
      return;
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > maxMemoryBytes) {
      limitExceeded = true;
      onLimit();
      return;
    }
    chunks.push(buffer);
  });
  await once(stream, "end");
  return { text: Buffer.concat(chunks).toString("utf8"), limitExceeded };
}

function createShellMetadata(
  request: ShellExecuteRequest,
  stream: "stdout" | "stderr",
  totalSizeBytes: number,
  execution: {
    readonly exitCode: number;
    readonly durationMs: number;
    readonly timedOut: boolean;
    readonly truncatedInline: boolean;
    readonly executedAt: string;
    readonly cwd: string;
  },
  ref: ArtifactRef,
): CreateMetadataRecordMessage {
  return {
    type: "createMetadataRecord",
    subject: { type: "artifact", ref },
    schemaRef: { schemaId: "aven:shell-execution-context", version: "v1" },
    value: {
      command: request.command,
      exitCode: execution.exitCode,
      stream,
      durationMs: execution.durationMs,
      timedOut: execution.timedOut,
      truncatedInline: execution.truncatedInline,
      totalSizeBytes,
      executedAt: execution.executedAt,
      cwd: execution.cwd,
    },
  };
}

export async function executeShellCommand(
  request: ShellExecuteRequest,
  dependencies: ShellExecuteDependencies,
): Promise<{
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
}> {
  const { config } = dependencies;
  enforceAllowedCommand(config, request.command);
  const timeoutMs = normalizeTimeoutSeconds(config, request) * 1000;
  const cwd = request.cwd ?? config.cwd;
  const startedAt = Date.now();
  let timedOut = false;
  let killedForMemory = false;

  const proc = spawn("/bin/sh", ["-c", request.command], {
    cwd,
    env: { ...process.env, ...config.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const terminate = () => {
    if (!proc.killed) {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 250).unref();
    }
  };

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);

  if (request.stdinText !== undefined) {
    proc.stdin.write(request.stdinText);
  }
  proc.stdin.end();

  const [stdout, stderr] = await Promise.all([
    collectStream(proc.stdout, config.maxMemoryBytes, () => {
      killedForMemory = true;
      terminate();
    }),
    collectStream(proc.stderr, config.maxMemoryBytes, () => {
      killedForMemory = true;
      terminate();
    }),
  ]);

  const [exitCode] = (await once(proc, "close")) as [number | null, NodeJS.Signals | null];
  clearTimeout(timeoutHandle);

  let stdoutText = stdout.text;
  let stderrText = stderr.text;
  if (killedForMemory) {
    stderrText += `${stderrText.endsWith("\n") || stderrText.length === 0 ? "" : "\n"}[killed: output exceeded memory limit ${config.maxMemoryBytes} bytes]`;
  }

  const stdoutDescriptor = stdoutText.length > 0
    ? await dependencies.putArtifact({
        bytes: Buffer.from(stdoutText, "utf8"),
        declaredMimeType: "text/x-shell-output",
        filename: "stdout.txt",
        createdAt: new Date().toISOString(),
        source: { kind: "shellOutput", uri: `shell:${request.requestId ?? "unknown"}:stdout` },
      })
    : undefined;
  const stderrDescriptor = stderrText.length > 0
    ? await dependencies.putArtifact({
        bytes: Buffer.from(stderrText, "utf8"),
        declaredMimeType: "text/x-shell-output; stream=stderr",
        filename: "stderr.txt",
        createdAt: new Date().toISOString(),
        source: { kind: "shellOutput", uri: `shell:${request.requestId ?? "unknown"}:stderr` },
      })
    : undefined;

  const durationMs = Date.now() - startedAt;
  const stdoutPreview = sanitizeAndTruncateShellPreview(stdoutText, config.maxInlineOutputChars, stdoutDescriptor ? { artifactId: stdoutDescriptor.artifactId, blob: stdoutDescriptor.blob } : undefined);
  const stderrPreview = sanitizeAndTruncateShellPreview(stderrText, config.maxInlineOutputChars, stderrDescriptor ? { artifactId: stderrDescriptor.artifactId, blob: stderrDescriptor.blob } : undefined);
  const executedAt = new Date().toISOString();

  try {
    if (stdoutDescriptor) {
      dependencies.createMetadata(createShellMetadata(request, "stdout", stdoutDescriptor.blob.sizeBytes, {
        exitCode: exitCode ?? (timedOut || killedForMemory ? 1 : 0),
        durationMs,
        timedOut,
        truncatedInline: stdoutPreview.truncated,
        executedAt,
        cwd,
      }, { artifactId: stdoutDescriptor.artifactId, blob: stdoutDescriptor.blob }));
    }
    if (stderrDescriptor) {
      dependencies.createMetadata(createShellMetadata(request, "stderr", stderrDescriptor.blob.sizeBytes, {
        exitCode: exitCode ?? (timedOut || killedForMemory ? 1 : 0),
        durationMs,
        timedOut,
        truncatedInline: stderrPreview.truncated,
        executedAt,
        cwd,
      }, { artifactId: stderrDescriptor.artifactId, blob: stderrDescriptor.blob }));
    }
  } catch (error) {
    dependencies.logError("Failed to create shell execution metadata.", error);
  }

  return {
    type: "shell.execute.completion",
    exitCode: exitCode ?? (timedOut || killedForMemory ? 1 : 0),
    stdoutPreview: stdoutPreview.preview,
    stderrPreview: stderrPreview.preview,
    stdoutTruncated: stdoutPreview.truncated,
    stderrTruncated: stderrPreview.truncated,
    ...(stdoutDescriptor ? { stdoutArtifact: { artifactId: stdoutDescriptor.artifactId, blob: stdoutDescriptor.blob } } : {}),
    ...(stderrDescriptor ? { stderrArtifact: { artifactId: stderrDescriptor.artifactId, blob: stderrDescriptor.blob } } : {}),
    durationMs,
    timedOut,
  };
}