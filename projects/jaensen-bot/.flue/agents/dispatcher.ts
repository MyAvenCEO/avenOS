// Jaensen Dispatcher - main entry point for routing messages
// Routes to Intents OR Skill Agents, notifies Intents on every event

import { DispatcherBase, DispatcherConfig, DispatcherMessage, RouteResult } from '../core/dispatcher.js';
import type { RoutingDecision, IntentEvent } from '../core/types.js';
import { IntentRegistry } from '../core/intent.js';
import { SkillAgentBase } from '../core/skill-agent.js';
import { MemorySkillAgent, MemoryTask } from './memory.js';
import { IngestSkillAgent, IngestTask } from './ingest.js';
import { ExtractSkillAgent, ExtractTask } from './extract.js';

export interface JaensenDispatcherConfig {
  memoryPath: string;
  archivePath: string;
  humanInboxUrl?: string;
}

export interface RouteDecision {
  routeTo: 'intent' | 'memory' | 'ingest' | 'extract' | 'human';
  intentId?: string;
  task?: unknown;
  reason: string;
}

// Default intents for Jaensen
export interface JaensenIntentState {
  id: string;
  topic: string;
  summary: string;
  status: 'active' | 'pending' | 'resolved';
}

// Jaensen-specific Intent implementation
class JaensenIntent {
  readonly id: string;
  readonly userId: string;
  readonly topic: string;
  
  private state: 'active' | 'pending' | 'resolved' = 'active';
  private events: IntentEvent[] = [];
  private context: Record<string, unknown> = {};
  private createdAt: Date = new Date();
  private updatedAt: Date = new Date();

  constructor(options: { id: string; userId: string; topic: string }) {
    this.id = options.id;
    this.userId = options.userId;
    this.topic = options.topic;
  }

  logEvent(source: IntentEvent['source'], type: string, data: unknown): void {
    this.events.push({
      timestamp: new Date(),
      source,
      type,
      data,
      routedVia: 'dispatcher',
    });
    this.updatedAt = new Date();
  }

  getState(): JaensenIntentState {
    return {
      id: this.id,
      topic: this.topic,
      summary: this.generateSummary(),
      status: this.state,
    };
  }

  private generateSummary(): string {
    if (this.events.length === 0) {
      return `Intent: ${this.topic}`;
    }
    const lastEvent = this.events[this.events.length - 1];
    return `${this.topic} - Last: ${lastEvent.type}`;
  }

  matchesQuery(query: string): boolean {
    const lower = query.toLowerCase();
    return (
      this.topic.toLowerCase().includes(lower) ||
      this.generateSummary().toLowerCase().includes(lower)
    );
  }
}

export class JaensenDispatcher extends DispatcherBase {
  private memoryAgent: MemorySkillAgent;
  private ingestAgent: IngestSkillAgent;
  private extractAgent: ExtractSkillAgent;

  constructor(config: JaensenDispatcherConfig) {
    const intentRegistry = new IntentRegistry();
    
    const memoryAgent = new MemorySkillAgent(config.memoryPath);
    const ingestAgent = new IngestSkillAgent(config.archivePath);
    const extractAgent = new ExtractSkillAgent();
    
    const skillAgents = new Map<string, SkillAgentBase>([
      ['memory', memoryAgent],
      ['ingest', ingestAgent],
      ['extract', extractAgent],
    ]);

    super({
      intentRegistry,
      skillAgents,
      humanInboxUrl: config.humanInboxUrl,
    });

    this.memoryAgent = memoryAgent;
    this.ingestAgent = ingestAgent;
    this.extractAgent = extractAgent;
  }

  // Initialize all agents
  async initialize(): Promise<void> {
    await this.memoryAgent.initialize();
    await this.ingestAgent.initialize();
  }

  // Main entry point for routing messages
  async routeMessage(message: DispatcherMessage): Promise<RouteResult> {
    // Make routing decision
    const decision = await this.makeRoutingDecision(message);
    
    // Log incoming event to intent if matched
    if (decision.target === 'intent' && decision.targetId) {
      this.notifyIntent(decision.targetId, {
        timestamp: new Date(),
        source: message.from,
        type: 'message_received',
        data: message.payload,
        routedVia: 'dispatcher',
      });
    }

    // Route based on decision
    switch (decision.target) {
      case 'intent':
        return this.routeToIntent(decision);
      case 'skill':
        return this.routeToSkill(decision.skillName!, decision.task, decision.targetId);
      case 'human':
        return this.notifyHuman(String(message.payload), decision.targetId);
      default:
        return { success: false, error: 'Unknown routing target' };
    }
  }

  // Make routing decision based on message content
  protected async makeRoutingDecision(
    message: DispatcherMessage
  ): Promise<RoutingDecision> {
    const payload = message.payload;
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    // Check for skill commands
    if (payloadStr.startsWith('memory:')) {
      return {
        target: 'skill',
        skillName: 'memory',
        task: this.parseMemoryTask(payloadStr),
      };
    }
    
    if (payloadStr.startsWith('ingest:') || payloadStr.includes('http')) {
      return {
        target: 'skill',
        skillName: 'ingest',
        task: this.parseIngestTask(payloadStr, message),
      };
    }
    
    if (payloadStr.startsWith('extract:')) {
      return {
        target: 'skill',
        skillName: 'extract',
        task: this.parseExtractTask(payloadStr),
      };
    }

    // Check for intent matching
    const matchingIntent = this.findBestIntent(payloadStr);
    if (matchingIntent) {
      return {
        target: 'intent',
        targetId: matchingIntent.id,
        task: { type: 'query', query: payloadStr },
      };
    }

    // Create new intent if it's a new topic
    if (message.from === 'user' && !this.isCommand(payloadStr)) {
      const newIntent = this.createNewIntent(payloadStr, message);
      return {
        target: 'intent',
        targetId: newIntent.id,
        task: { type: 'initial', query: payloadStr },
      };
    }

    // Default to memory for knowledge queries
    return {
      target: 'skill',
      skillName: 'memory',
      task: { action: 'query', params: { query: payloadStr } },
    };
  }

  // Route to an intent
  private async routeToIntent(decision: RoutingDecision): Promise<RouteResult> {
    const intent = this.intentRegistry.getIntent(decision.targetId!);
    if (!intent) {
      return { success: false, error: 'Intent not found' };
    }

    const task = decision.task as { type: string; query: string };
    
    // For query tasks, get context from intent
    if (task.type === 'query') {
      const state = intent.getState();
      const context = intent.getInjectedContext();
      
      return {
        success: true,
        routedTo: { type: 'intent', id: intent.id },
        response: {
          intentId: intent.id,
          topic: intent.topic,
          summary: state.summary,
          events: state.events.length,
          context,
        },
      };
    }

    return {
      success: true,
      routedTo: { type: 'intent', id: intent.id },
      response: intent.getState(),
    };
  }

  // Execute skill task
  protected async executeSkillTask(
    skillAgent: SkillAgentBase,
    task: unknown,
    intentId?: string
  ): Promise<unknown> {
    if (skillAgent instanceof MemorySkillAgent) {
      return this.memoryAgent.executeTask(task as MemoryTask);
    }
    if (skillAgent instanceof IngestSkillAgent) {
      return this.ingestAgent.executeTask(task as IngestTask);
    }
    if (skillAgent instanceof ExtractSkillAgent) {
      return this.extractAgent.executeTask(task as ExtractTask);
    }
    
    throw new Error(`Unknown skill agent type: ${skillAgent.name}`);
  }

  // Create a new intent for a topic
  private createNewIntent(topic: string, message: DispatcherMessage): JaensenIntent {
    const id = `intent-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const intent = new JaensenIntent({
      id,
      userId: message.from === 'user' ? 'user' : 'system',
      topic: this.extractTopic(topic),
    });
    
    intent.logEvent('system', 'intent_created', { originalMessage: topic });
    this.intentRegistry.intents.set(id, intent as unknown as import('../core/intent.js').IntentBase);
    
    return intent;
  }

  // Extract topic from message
  private extractTopic(message: string): string {
    // Simple extraction - in production could use LLM
    const firstLine = message.split('\n')[0];
    if (firstLine.length > 50) {
      return firstLine.slice(0, 50) + '...';
    }
    return firstLine || 'New Topic';
  }

  // Check if message is a command
  private isCommand(message: string): boolean {
    const commands = ['memory:', 'ingest:', 'extract:', 'help', 'status'];
    return commands.some(cmd => message.startsWith(cmd));
  }

  // Parse memory task from string
  private parseMemoryTask(payload: string): MemoryTask {
    const body = payload.replace('memory:', '').trim();
    
    if (body.startsWith('write:')) {
      const content = body.replace('write:', '').trim();
      return { action: 'write', params: { content } };
    }
    if (body.startsWith('search:')) {
      const entity = body.replace('search:', '').trim();
      return { action: 'search', params: { entity } };
    }
    if (body.startsWith('read:')) {
      const query = body.replace('read:', '').trim();
      return { action: 'read', params: { query } };
    }
    
    return { action: 'query', params: { query: body } };
  }

  // Parse ingest task from string
  private parseIngestTask(payload: string, message: DispatcherMessage): IngestTask {
    const body = payload.replace('ingest:', '').trim();
    
    // Extract URL from message
    const urlMatch = message.payload?.toString().match(/https?:\/\/[^\s]+/) ||
      body.match(/https?:\/\/[^\s]+/);
    
    if (urlMatch) {
      return { action: 'download', params: { url: urlMatch[0] } };
    }
    
    // Check for email attachment
    if (message.payload && typeof message.payload === 'object' && 'attachment' in message.payload) {
      return {
        action: 'process',
        params: {
          content: Buffer.from(message.payload.attachment as string, 'base64'),
          metadata: message.payload.metadata,
        },
      };
    }
    
    return { action: 'download', params: { url: body } };
  }

  // Parse extract task from string
  private parseExtractTask(payload: string): ExtractTask {
    const body = payload.replace('extract:', '').trim();
    
    return {
      action: 'extract',
      params: {
        archivePath: body,
      },
    };
  }

  // Get all active intents
  getActiveIntents(): JaensenIntentState[] {
    return Array.from(this.intentRegistry.intents.values())
      .map(i => (i as unknown as JaensenIntent).getState())
      .filter(s => s.status === 'active');
  }

  // Get dispatcher status
  getStatus(): {
    activeIntents: number;
    skills: { memory: object; ingest: object; extract: object };
  } {
    return {
      activeIntents: this.intentRegistry.getActiveIntents().length,
      skills: {
        memory: this.memoryAgent.getUtilization(),
        ingest: this.ingestAgent.getUtilization(),
        extract: this.extractAgent.getUtilization(),
      },
    };
  }
}