// Dispatcher - routes messages to Intents or Skill Agents
// Notifies Intents on every event

import type { RoutingDecision, IntentEvent } from './types.js';
import type { IntentBase, IntentRegistry } from './intent.js';
import type { SkillAgentBase } from './skill-agent.js';

export interface DispatcherConfig {
  intentRegistry: IntentRegistry;
  skillAgents: Map<string, SkillAgentBase>;
  humanInboxUrl?: string;
}

// Message envelope for dispatcher communication
export interface DispatcherMessage {
  id: string;
  from: 'user' | 'worker' | 'human';
  type: 'task' | 'event' | 'response';
  payload: unknown;
  intentId?: string;
  timestamp: Date;
}

export interface RouteResult {
  success: boolean;
  routedTo?: {
    type: 'intent' | 'skill' | 'human';
    id?: string;
    skill?: string;
  };
  response?: unknown;
  error?: string;
}

export abstract class DispatcherBase {
  protected config: DispatcherConfig;
  protected intentRegistry: IntentRegistry;
  protected skillAgents: Map<string, SkillAgentBase>;

  constructor(config: DispatcherConfig) {
    this.config = config;
    this.intentRegistry = config.intentRegistry;
    this.skillAgents = config.skillAgents;
  }

  // Main entry point for routing a message
  abstract route(message: DispatcherMessage): Promise<RouteResult>;

  // Notify an intent about an event
  protected notifyIntent(intentId: string, event: IntentEvent): void {
    const intent = this.intentRegistry.getIntent(intentId);
    if (intent) {
      intent.logEvent(event.source, event.type, event.data, event.routedVia);
    }
  }

  // Find the best matching intent for a message
  protected findBestIntent(message: string): IntentBase | undefined {
    const matches = this.intentRegistry.findMatchingIntents(message);
    if (matches.length === 0) return undefined;
    
    // Return the most recent active match
    return matches
      .filter(i => i.getState().status === 'active')
      .sort((a, b) => 
        b.getState().updatedAt.getTime() - a.getState().updatedAt.getTime()
      )[0];
  }

  // Route to a skill agent
  protected async routeToSkill(
    skillName: string,
    task: unknown,
    intentId?: string
  ): Promise<RouteResult> {
    const skillAgent = this.skillAgents.get(skillName);
    if (!skillAgent) {
      return { success: false, error: `Unknown skill: ${skillName}` };
    }

    try {
      const result = await this.executeSkillTask(skillAgent, task, intentId);
      
      // If we have an intent, notify it of the task result
      if (intentId) {
        this.notifyIntent(intentId, {
          timestamp: new Date(),
          source: 'worker',
          type: 'skill_complete',
          data: { skill: skillName, result },
          routedVia: 'skill',
        });
      }
      
      return {
        success: true,
        routedTo: { type: 'skill', id: skillName, skill: skillName },
        response: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Execute a task on a skill agent
  protected abstract executeSkillTask(
    skillAgent: SkillAgentBase,
    task: unknown,
    intentId?: string
  ): Promise<unknown>;

  // Send notification to human
  protected async notifyHuman(
    message: string,
    intentId?: string
  ): Promise<RouteResult> {
    if (!this.config.humanInboxUrl) {
      return { success: false, error: 'No human inbox configured' };
    }

    try {
      // In production, this would be an HTTP POST or similar
      // For now, just return success indication
      console.log('[Dispatcher] Notifying human:', message);
      
      if (intentId) {
        this.notifyIntent(intentId, {
          timestamp: new Date(),
          source: 'system',
          type: 'human_notified',
          data: { message },
          routedVia: 'dispatcher',
        });
      }
      
      return {
        success: true,
        routedTo: { type: 'human' },
        response: { notified: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Get routing decision from LLM or rules
  protected abstract makeRoutingDecision(
    message: DispatcherMessage
  ): Promise<RoutingDecision>;

  // List available skills for routing context
  protected getAvailableSkills(): string[] {
    return Array.from(this.skillAgents.keys());
  }

  // List active intents for routing context
  protected getActiveIntents(): { id: string; topic: string }[] {
    return this.intentRegistry.getActiveIntents().map(intent => ({
      id: intent.id,
      topic: intent.topic,
    }));
  }
}