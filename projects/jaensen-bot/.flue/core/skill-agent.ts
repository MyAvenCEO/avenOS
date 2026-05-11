// Base SkillAgent class - manages worker pools for a skill
// SkillAgents decide when to spawn new workers vs reuse existing ones

import type { WorkerInfo, SkillAgentState } from './types.js';

export interface SkillAgentOptions {
  name: string;
  maxWorkers?: number;
  defaultSpecialty?: string;
}

export interface InjectedContext {
  workerCount: number;
  completedCount: number;
  workers: WorkerInfo[];
  specialties: string[];
}

// Worker handle for tracking
export interface WorkerHandle {
  id: string;
  specialty: string;
  status: WorkerInfo['status'];
  complete(result?: unknown): void;
  fail(error: string): void;
  getInfo(): WorkerInfo;
}

// Callback types for worker lifecycle
export type WorkerCompleteCallback = (workerId: string, result: unknown) => void;
export type WorkerFailCallback = (workerId: string, error: string) => void;

// Shared worker state interface for persistence
export interface WorkerState {
  id: string;
  specialty: string;
  status: WorkerInfo['status'];
  createdAt: string;
  lastUpdate: string;
  result?: unknown;
  error?: string;
}

export abstract class SkillAgentBase {
  readonly name: string;
  readonly maxWorkers: number;
  
  protected activeWorkers: Map<string, WorkerInfo> = new Map();
  protected completedWorkers: WorkerInfo[] = [];
  protected onWorkerComplete?: WorkerCompleteCallback;
  protected onWorkerFail?: WorkerFailCallback;

  constructor(options: SkillAgentOptions) {
    this.name = options.name;
    this.maxWorkers = options.maxWorkers ?? 10;
  }

  // Set lifecycle callbacks
  setCallbacks(
    onComplete?: WorkerCompleteCallback,
    onFail?: WorkerFailCallback
  ): void {
    this.onWorkerComplete = onComplete;
    this.onWorkerFail = onFail;
  }

  // Spawn a new worker with a given specialty
  spawnWorker(specialty: string): WorkerHandle {
    const id = this.generateWorkerId(specialty);
    const now = new Date();
    
    const workerInfo: WorkerInfo = {
      id,
      status: 'running',
      specialty,
      createdAt: now,
      lastUpdate: now,
    };
    
    this.activeWorkers.set(id, workerInfo);
    
    return {
      id,
      specialty,
      status: 'running',
      complete: (result?: unknown) => this.handleWorkerComplete(id, result),
      fail: (error: string) => this.handleWorkerFail(id, error),
      getInfo: () => this.getWorker(id)!,
    };
  }

  // Get worker by ID
  getWorker(id: string): WorkerInfo | null {
    return this.activeWorkers.get(id) ?? null;
  }

  // Get workers by specialty
  getWorkersBySpecialty(specialty: string): WorkerInfo[] {
    return Array.from(this.activeWorkers.values()).filter(
      w => w.specialty === specialty
    );
  }

  // Get all active workers
  getActiveWorkers(): WorkerInfo[] {
    return Array.from(this.activeWorkers.values());
  }

  // Get injected context from actual worker states
  getInjectedContext(): InjectedContext {
    return {
      workerCount: this.activeWorkers.size,
      completedCount: this.completedWorkers.length,
      workers: Array.from(this.activeWorkers.values()),
      specialties: [...new Set(
        Array.from(this.activeWorkers.values()).map(w => w.specialty)
      )],
    };
  }

  // Get current state for persistence
  getState(): SkillAgentState {
    return {
      activeWorkers: new Map(this.activeWorkers),
      completedWorkers: [...this.completedWorkers],
    };
  }

  // Get routing decision based on task and worker state
  // Override this in subclasses for custom routing logic
  protected abstract decideRouting(
    task: unknown,
    context: InjectedContext
  ): { reuseExisting: boolean; specialty: string; workerId?: string };

  // Decide whether to spawn or route to existing
  shouldSpawnWorker(
    task: unknown,
    preferredSpecialty?: string
  ): { spawn: boolean; targetWorker?: string; specialty: string } {
    const context = this.getInjectedContext();
    const decision = this.decideRouting(task, context);
    
    if (decision.reuseExisting && decision.workerId) {
      return {
        spawn: false,
        targetWorker: decision.workerId,
        specialty: decision.specialty,
      };
    }
    
    return {
      spawn: true,
      specialty: decision.specialty,
    };
  }

  // Handle worker completion
  protected handleWorkerComplete(workerId: string, result?: unknown): void {
    const worker = this.activeWorkers.get(workerId);
    if (!worker) return;
    
    worker.status = 'completed';
    worker.lastUpdate = new Date();
    worker.result = result;
    
    this.activeWorkers.delete(workerId);
    this.completedWorkers.push(worker);
    
    this.onWorkerComplete?.(workerId, result);
  }

  // Handle worker failure
  protected handleWorkerFail(workerId: string, error: string): void {
    const worker = this.activeWorkers.get(workerId);
    if (!worker) return;
    
    worker.status = 'failed';
    worker.lastUpdate = new Date();
    worker.error = error;
    
    this.activeWorkers.delete(workerId);
    this.completedWorkers.push(worker);
    
    this.onWorkerFail?.(workerId, error);
  }

  // Generate unique worker ID
  protected generateWorkerId(specialty: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `${this.name}-${specialty}-${timestamp}-${random}`;
  }

  // Check if we can spawn more workers
  canSpawnWorker(): boolean {
    return this.activeWorkers.size < this.maxWorkers;
  }

  // Get utilization stats
  getUtilization(): { active: number; max: number; completed: number } {
    return {
      active: this.activeWorkers.size,
      max: this.maxWorkers,
      completed: this.completedWorkers.length,
    };
  }

  // Persist worker state (for recovery)
  toJSON(): { name: string; workers: WorkerState[] } {
    return {
      name: this.name,
      workers: [
        ...Array.from(this.activeWorkers.values()),
        ...this.completedWorkers.slice(-100), // keep last 100 completed
      ].map(w => ({
        id: w.id,
        specialty: w.specialty,
        status: w.status,
        createdAt: w.createdAt.toISOString(),
        lastUpdate: w.lastUpdate.toISOString(),
        result: w.result,
        error: w.error,
      })),
    };
  }
}