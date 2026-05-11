// Base Intent class - tracks one topic from creation to resolution
// Intents are long-running sub-agents that stay informed about all events

import type { Intent, IntentEvent, IntentContext } from './types.js';

export interface IntentOptions {
  id: string;
  userId: string;
  topic: string;
  initialContext?: Partial<IntentContext>;
}

export interface InjectedContext {
  workerCount: number;
  activeWorkers: Array<{
    id: string;
    specialty: string;
    status: string;
    lastUpdate: Date;
  }>;
}

export abstract class IntentBase {
  readonly id: string;
  readonly userId: string;
  readonly topic: string;
  
  protected state: Intent['status'] = 'active';
  protected events: IntentEvent[] = [];
  protected context: IntentContext;
  protected createdAt: Date;
  protected updatedAt: Date;

  constructor(options: IntentOptions) {
    this.id = options.id;
    this.userId = options.userId;
    this.topic = options.topic;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.context = {
      relevantWorkers: [],
      relevantSkills: [],
      humanPreferences: {},
      ...options.initialContext,
    };
  }

  // Log an event related to this intent
  logEvent(
    source: IntentEvent['source'],
    type: string,
    data: unknown,
    routedVia: IntentEvent['routedVia'] = 'dispatcher'
  ): void {
    this.events.push({
      timestamp: new Date(),
      source,
      type,
      data,
      routedVia,
    });
    this.updatedAt = new Date();
  }

  // Get current state for external queries
  getState(): Intent {
    return {
      id: this.id,
      userId: this.userId,
      topic: this.topic,
      summary: this.getSummary(),
      status: this.state,
      events: [...this.events],
      context: { ...this.context },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  // Get injected context for LLM-assisted decisions
  getInjectedContext(): InjectedContext {
    return {
      workerCount: this.context.relevantWorkers.length,
      activeWorkers: this.context.relevantWorkers.map(wId => ({
        id: wId,
        specialty: this.getWorkerSpecialty(wId),
        status: 'active',
        lastUpdate: this.updatedAt,
      })),
    };
  }

  // Check if this intent matches a given query/topic
  matchesQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return (
      this.topic.toLowerCase().includes(lowerQuery) ||
      this.getSummary().toLowerCase().includes(lowerQuery) ||
      this.matchesContext(query)
    );
  }

  // Update intent status
  setStatus(status: Intent['status']): void {
    this.state = status;
    this.updatedAt = new Date();
  }

  // Update context values
  updateContext(key: string, value: unknown): void {
    if (key in this.context) {
      (this.context as Record<string, unknown>)[key] = value;
    } else {
      this.context[key] = value;
    }
    this.updatedAt = new Date();
  }

  // Add a worker to tracking
  addWorker(workerId: string, specialty: string): void {
    if (!this.context.relevantWorkers.includes(workerId)) {
      this.context.relevantWorkers.push(workerId);
    }
    this.updatedAt = new Date();
  }

  // Remove a worker from tracking
  removeWorker(workerId: string): void {
    this.context.relevantWorkers = this.context.relevantWorkers.filter(
      id => id !== workerId
    );
    this.updatedAt = new Date();
  }

  // Abstract methods for subclasses to implement
  protected abstract getSummary(): string;
  protected abstract getWorkerSpecialty(workerId: string): string;
  protected abstract matchesContext(query: string): boolean;
}

// Intent registry for managing active intents
export class IntentRegistry {
  private intents: Map<string, IntentBase> = new Map();

  // Create and register a new intent
  createIntent<T extends IntentBase>(
    intentClass: new (options: IntentOptions) => T,
    options: IntentOptions
  ): T {
    const intent = new intentClass(options);
    this.intents.set(options.id, intent);
    return intent;
  }

  // Get an intent by ID
  getIntent(id: string): IntentBase | undefined {
    return this.intents.get(id);
  }

  // Find intents matching a query
  findMatchingIntents(query: string): IntentBase[] {
    return Array.from(this.intents.values()).filter(
      intent => intent.matchesQuery(query)
    );
  }

  // List all active intents
  getActiveIntents(): IntentBase[] {
    return Array.from(this.intents.values()).filter(
      intent => intent.getState().status === 'active'
    );
  }

  // Remove an intent
  removeIntent(id: string): boolean {
    return this.intents.delete(id);
  }

  // Persist intents (for state recovery)
  toJSON(): Intent[] {
    return Array.from(this.intents.values()).map(intent => intent.getState());
  }

  // Restore intents from persisted state
  fromJSON(intents: Intent[]): void {
    // Note: This is a simplified version. In production, you'd need
    // to reconstruct the actual IntentBase subclasses
    // For now, this is a placeholder for the persistence pattern
    this.intents.clear();
    // intents.forEach(i => this.intents.set(i.id, i));
  }
}