// Memory Skill Agent - manages memory workers (thread-based long-running workers)
// Routes tasks to appropriate thread workers or spawns new ones

import { SkillAgentBase } from '../core/skill-agent.js';
import type { InjectedContext } from '../core/skill-agent.js';
import {
  MemoryWorker,
  createMemoryWorker,
  inferTopic,
  KNOWN_THREADS,
} from '../workers/memory/index.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';

export interface MemoryTask {
  action: 'read' | 'write' | 'search' | 'query';
  params: {
    query?: string;
    content?: string;
    topic?: string;
    entity?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface MemoryTaskResult {
  action: string;
  success: boolean;
  result?: unknown;
  thread?: string;
  error?: string;
}

export class MemorySkillAgent extends SkillAgentBase {
  private memoryPath: string;
  private workers: Map<string, MemoryWorker> = new Map();

  constructor(memoryPath: string, maxWorkers = 10) {
    super({ name: 'memory', maxWorkers });
    this.memoryPath = memoryPath;
  }

  // Initialize memory storage directory
  async initialize(): Promise<void> {
    await mkdir(this.memoryPath, { recursive: true });
    
    // Initialize thread files
    for (const topic of KNOWN_THREADS) {
      // Files will be created on first write
    }
  }

  // Execute a memory task
  async executeTask(task: MemoryTask): Promise<MemoryTaskResult> {
    switch (task.action) {
      case 'read':
        return this.handleRead(task.params);
      case 'write':
        return this.handleWrite(task.params);
      case 'search':
        return this.handleSearch(task.params);
      case 'query':
        return this.handleQuery(task.params);
      default:
        return { action: task.action, success: false, error: 'Unknown action' };
    }
  }

  // Handle read request
  private async handleRead(params: { query?: string; topic?: string }): Promise<MemoryTaskResult> {
    const topic = params.topic || 'audit';
    const worker = await this.getOrCreateWorker(topic);
    
    try {
      const result = await worker.read(params.query);
      return {
        action: 'read',
        success: true,
        result,
        thread: topic,
      };
    } catch (error) {
      return {
        action: 'read',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        thread: topic,
      };
    }
  }

  // Handle write request
  private async handleWrite(params: {
    content: string;
    topic?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MemoryTaskResult> {
    // Infer topic if not provided
    const topic = params.topic || inferTopic(params.content);
    const worker = await this.getOrCreateWorker(topic);
    
    try {
      const result = await worker.write(params.content, params.metadata);
      return {
        action: 'write',
        success: true,
        result,
        thread: topic,
      };
    } catch (error) {
      return {
        action: 'write',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        thread: topic,
      };
    }
  }

  // Handle search request
  private async handleSearch(params: { entity: string; topic?: string }): Promise<MemoryTaskResult> {
    if (params.topic) {
      // Search within specific thread
      const worker = await this.getOrCreateWorker(params.topic);
      const result = await worker.search(params.entity);
      return {
        action: 'search',
        success: true,
        result,
        thread: params.topic,
      };
    } else {
      // Search across all threads
      const allResults = await this.searchAcrossThreads(params.entity);
      return {
        action: 'search',
        success: true,
        result: allResults,
        thread: 'all',
      };
    }
  }

  // Handle query (LLM-assisted query across memory)
  private async handleQuery(params: { query: string }): Promise<MemoryTaskResult> {
    // Simple query handling - in production this could use LLM
    const searchTerm = params.query;
    const results = await this.searchAcrossThreads(searchTerm);
    
    return {
      action: 'query',
      success: true,
      result: {
        query: params.query,
        results,
        summary: `Found ${results.totalMatches} matches across ${results.threads.length} threads`,
      },
    };
  }

  // Search across all threads
  private async searchAcrossThreads(entity: string): Promise<{
    matches: Array<{ thread: string; content: string; relevance: number }>;
    totalMatches: number;
    threads: string[];
  }> {
    const allMatches: Array<{ thread: string; content: string; relevance: number }> = [];
    const searchedThreads: string[] = [];

    for (const topic of KNOWN_THREADS) {
      try {
        const worker = await this.getOrCreateWorker(topic);
        const result = await worker.search(entity);
        
        if (result.totalMatches > 0) {
          allMatches.push(...result.matches);
          searchedThreads.push(topic);
        }
      } catch {
        // Thread may not exist yet
      }
    }

    return {
      matches: allMatches.sort((a, b) => b.relevance - a.relevance),
      totalMatches: allMatches.length,
      threads: searchedThreads,
    };
  }

  // Get or create a worker for a topic
  private async getOrCreateWorker(topic: string): Promise<MemoryWorker> {
    // Check if we have an existing worker for this topic
    const existingWorker = this.findWorkerByTopic(topic);
    if (existingWorker) {
      return existingWorker;
    }

    // Create new worker
    const worker = createMemoryWorker(
      this.generateWorkerId(topic),
      this.memoryPath,
      topic
    );
    
    this.workers.set(worker.id, worker);
    return worker;
  }

  // Find worker by topic
  private findWorkerByTopic(topic: string): MemoryWorker | undefined {
    for (const worker of this.workers.values()) {
      if (worker.topic === topic) {
        return worker;
      }
    }
    return undefined;
  }

  // Override routing decision
  protected decideRouting(
    task: unknown,
    context: InjectedContext
  ): { reuseExisting: boolean; specialty: string; workerId?: string } {
    const memoryTask = task as MemoryTask;
    
    // Infer specialty from task
    let specialty = 'thread:audit';
    
    if (memoryTask.action === 'write' && memoryTask.params.topic) {
      specialty = `thread:${memoryTask.params.topic}`;
    } else if (memoryTask.action === 'write' && memoryTask.params.content) {
      specialty = `thread:${inferTopic(memoryTask.params.content)}`;
    } else if (memoryTask.action === 'search' && memoryTask.params.topic) {
      specialty = `thread:${memoryTask.params.topic}`;
    } else if (memoryTask.action === 'query') {
      specialty = 'search';
    }
    
    // Check for existing worker with same specialty
    const existing = this.getWorkersBySpecialty(specialty);
    if (existing.length > 0) {
      return {
        reuseExisting: true,
        specialty,
        workerId: existing[0].id,
      };
    }
    
    return {
      reuseExisting: false,
      specialty,
    };
  }

  // Get worker by ID
  getMemoryWorker(id: string): MemoryWorker | undefined {
    return this.workers.get(id);
  }

  // List all workers
  listWorkers(): Array<{ id: string; topic: string; specialty: string }> {
    return Array.from(this.workers.values()).map(w => ({
      id: w.id,
      topic: w.topic,
      specialty: w.specialty,
    }));
  }
}