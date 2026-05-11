// Extract Skill Agent - manages short-lived document extraction workers
// Spawns workers to extract content, entities, and create dossiers

import { SkillAgentBase } from '../core/skill-agent.js';
import type { InjectedContext } from '../core/skill-agent.js';
import {
  ExtractWorker,
  createExtractWorker,
  detectDocumentType,
  ExtractionResult,
  DossierData,
} from '../workers/extract/index.js';

export interface ExtractTask {
  action: 'extract' | 'create_dossier';
  params: {
    archivePath: string;
    entityType?: 'person' | 'company' | 'document' | 'event';
    primaryEntity?: string;
    options?: Record<string, unknown>;
  };
}

export interface ExtractTaskResult {
  action: string;
  success: boolean;
  result?: {
    extraction?: ExtractionResult;
    dossier?: DossierData;
  };
  error?: string;
}

export class ExtractSkillAgent extends SkillAgentBase {
  private workers: Map<string, ExtractWorker> = new Map();

  constructor(maxWorkers = 5) {
    super({ name: 'extract', maxWorkers });
  }

  // Execute an extract task
  async executeTask(task: ExtractTask): Promise<ExtractTaskResult> {
    switch (task.action) {
      case 'extract':
        return this.handleExtract(task.params);
      case 'create_dossier':
        return this.handleCreateDossier(task.params);
      default:
        return { action: task.action, success: false, error: 'Unknown action' };
    }
  }

  // Handle extraction request
  private async handleExtract(params: {
    archivePath: string;
    options?: Record<string, unknown>;
  }): Promise<ExtractTaskResult> {
    const typeInfo = detectDocumentType(params.archivePath);
    const worker = createExtractWorker(
      this.generateWorkerId(typeInfo.specialty),
      typeInfo.type
    );
    
    this.workers.set(worker.id, worker);
    const handle = this.spawnWorker(typeInfo.specialty);

    try {
      const result = await worker.extractFromArchive(params.archivePath);
      handle.complete(result);

      return {
        action: 'extract',
        success: true,
        result: { extraction: result },
      };
    } catch (error) {
      handle.fail(error instanceof Error ? error.message : String(error));

      return {
        action: 'extract',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.workers.delete(worker.id);
    }
  }

  // Handle dossier creation request
  private async handleCreateDossier(params: {
    archivePath: string;
    entityType?: 'person' | 'company' | 'document' | 'event';
    primaryEntity?: string;
  }): Promise<ExtractTaskResult> {
    const typeInfo = detectDocumentType(params.archivePath);
    const worker = createExtractWorker(
      this.generateWorkerId(typeInfo.specialty),
      typeInfo.type
    );
    
    this.workers.set(worker.id, worker);
    const handle = this.spawnWorker(typeInfo.specialty);

    try {
      // Extract content first
      const extraction = await worker.extractFromArchive(params.archivePath);
      
      // Create dossier
      const dossier: DossierData = {
        id: this.generateWorkerId('dossier').replace(this.name, 'dossier'),
        type: params.entityType || this.inferEntityType(extraction),
        primaryEntity: params.primaryEntity || this.inferPrimaryEntity(extraction),
        source: {
          archivePath: params.archivePath,
          documentType: typeInfo.type,
        },
        content: {
          text: extraction.content,
          summary: extraction.summary,
          entities: extraction.entities,
        },
      };

      handle.complete(dossier);

      return {
        action: 'create_dossier',
        success: true,
        result: { extraction, dossier },
      };
    } catch (error) {
      handle.fail(error instanceof Error ? error.message : String(error));

      return {
        action: 'create_dossier',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.workers.delete(worker.id);
    }
  }

  // Infer entity type from extraction
  private inferEntityType(extraction: ExtractionResult): DossierData['type'] {
    if (extraction.entities.companies.length > extraction.entities.people.length) {
      return 'company';
    }
    if (extraction.entities.people.length > 0) {
      return 'person';
    }
    if (extraction.metadata.documentType === 'email') {
      return 'document';
    }
    if (extraction.entities.dates.length > 0) {
      return 'event';
    }
    return 'document';
  }

  // Infer primary entity from extraction
  private inferPrimaryEntity(extraction: ExtractionResult): string {
    if (extraction.entities.companies.length > 0) {
      return extraction.entities.companies[0];
    }
    if (extraction.entities.people.length > 0) {
      return extraction.entities.people[0];
    }
    return 'Unknown Entity';
  }

  // Override routing decision
  protected decideRouting(
    task: unknown,
    context: InjectedContext
  ): { reuseExisting: boolean; specialty: string; workerId?: string } {
    const extractTask = task as ExtractTask;
    
    if (extractTask.action === 'extract' && extractTask.params.archivePath) {
      const typeInfo = detectDocumentType(extractTask.params.archivePath);
      return {
        reuseExisting: false, // Always spawn new for extract (one-shot)
        specialty: typeInfo.specialty,
      };
    }

    return {
      reuseExisting: false,
      specialty: 'pdf-extract',
    };
  }

  // Get worker by ID
  getExtractWorker(id: string): ExtractWorker | undefined {
    return this.workers.get(id);
  }

  // List all workers
  listWorkers(): Array<{ id: string; specialty: string }> {
    return Array.from(this.workers.values()).map(w => ({
      id: w.id,
      specialty: w.specialty,
    }));
  }
}