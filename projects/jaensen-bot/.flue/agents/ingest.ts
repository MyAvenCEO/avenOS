// Ingest Skill Agent - manages short-lived document ingest workers
// Spawns workers to download, archive, and register documents

import { SkillAgentBase } from '../core/skill-agent.js';
import type { InjectedContext } from '../core/skill-agent.js';
import {
  IngestWorker,
  createIngestWorker,
  detectContentType,
  IngestResult,
} from '../workers/ingest/index.js';
import { mkdir } from 'fs/promises';

export interface IngestTask {
  action: 'download' | 'process';
  params: {
    url?: string;
    content?: Uint8Array;
    typeHint?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface IngestTaskResult {
  action: string;
  success: boolean;
  result?: IngestResult;
  error?: string;
}

export class IngestSkillAgent extends SkillAgentBase {
  private archivePath: string;
  private workers: Map<string, IngestWorker> = new Map();

  constructor(archivePath: string, maxWorkers = 5) {
    super({ name: 'ingest', maxWorkers });
    this.archivePath = archivePath;
  }

  // Initialize archive directory
  async initialize(): Promise<void> {
    await mkdir(this.archivePath, { recursive: true });
  }

  // Execute an ingest task
  async executeTask(task: IngestTask): Promise<IngestTaskResult> {
    switch (task.action) {
      case 'download':
        return this.handleDownload(task.params);
      case 'process':
        return this.handleProcess(task.params);
      default:
        return { action: task.action, success: false, error: 'Unknown action' };
    }
  }

  // Handle download request
  private async handleDownload(params: {
    url: string;
    typeHint?: string;
    metadata?: Record<string, unknown>;
  }): Promise<IngestTaskResult> {
    const contentTypeInfo = detectContentType(params.url, params.typeHint);
    const worker = createIngestWorker(
      this.generateWorkerId(contentTypeInfo.specialty),
      this.archivePath
    );
    
    this.workers.set(worker.id, worker);

    try {
      const result = await worker.ingestUrl(params.url, params.typeHint);
      
      // Mark worker as complete
      const handle = this.spawnWorker(contentTypeInfo.specialty);
      handle.complete(result);

      return {
        action: 'download',
        success: true,
        result,
      };
    } catch (error) {
      const handle = this.spawnWorker(contentTypeInfo.specialty);
      handle.fail(error instanceof Error ? error.message : String(error));

      return {
        action: 'download',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.workers.delete(worker.id);
    }
  }

  // Handle binary content processing
  private async handleProcess(params: {
    content: Uint8Array;
    metadata?: Record<string, unknown>;
  }): Promise<IngestTaskResult> {
    const worker = createIngestWorker(
      this.generateWorkerId('binary-handler'),
      this.archivePath
    );
    
    this.workers.set(worker.id, worker);

    try {
      const result = await worker.ingestBinary(params.content, {
        filename: params.metadata?.filename as string,
        contentType: params.metadata?.contentType as string,
        source: params.metadata?.source as string,
      });
      
      const handle = this.spawnWorker('binary-handler');
      handle.complete(result);

      return {
        action: 'process',
        success: true,
        result,
      };
    } catch (error) {
      const handle = this.spawnWorker('binary-handler');
      handle.fail(error instanceof Error ? error.message : String(error));

      return {
        action: 'process',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.workers.delete(worker.id);
    }
  }

  // Override routing decision
  protected decideRouting(
    task: unknown,
    context: InjectedContext
  ): { reuseExisting: boolean; specialty: string; workerId?: string } {
    const ingestTask = task as IngestTask;
    
    if (ingestTask.action === 'download' && ingestTask.params.url) {
      const contentTypeInfo = detectContentType(ingestTask.params.url, ingestTask.params.typeHint);
      return {
        reuseExisting: false, // Always spawn new for ingest (one-shot)
        specialty: contentTypeInfo.specialty,
      };
    }

    return {
      reuseExisting: false,
      specialty: 'url-handler',
    };
  }

  // Get worker by ID
  getIngestWorker(id: string): IngestWorker | undefined {
    return this.workers.get(id);
  }

  // List all workers
  listWorkers(): Array<{ id: string; specialty: string }> {
    return Array.from(this.workers.values()).map(w => ({
      id: w.id,
      specialty: w.specialty,
    }));
  }

  // Get archive statistics
  getArchiveStats(): { workerCount: number; archivePath: string } {
    return {
      workerCount: this.workers.size,
      archivePath: this.archivePath,
    };
  }
}