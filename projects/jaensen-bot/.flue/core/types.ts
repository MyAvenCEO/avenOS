// Shared types for the Jaensen agent system

export interface IntentEvent {
  timestamp: Date;
  source: 'user' | 'worker' | 'human' | 'system';
  type: string;
  data: unknown;
  routedVia: 'dispatcher' | 'skill' | 'direct';
}

export interface IntentContext {
  relevantWorkers: string[];
  relevantSkills: string[];
  humanPreferences: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Intent {
  id: string;
  userId: string;
  topic: string;
  summary: string;
  status: 'active' | 'pending' | 'resolved';
  events: IntentEvent[];
  context: IntentContext;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkerInfo {
  id: string;
  status: 'running' | 'completed' | 'failed';
  specialty: string;
  createdAt: Date;
  lastUpdate: Date;
  result?: unknown;
  error?: string;
}

export interface SkillAgentState {
  activeWorkers: Map<string, WorkerInfo>;
  completedWorkers: WorkerInfo[];
}

export interface RoutingDecision {
  target: 'intent' | 'skill' | 'human';
  targetId?: string;
  skillName?: string;
  task: unknown;
  context?: Record<string, unknown>;
}

export interface TaskResult {
  success: boolean;
  result?: unknown;
  error?: string;
  events?: IntentEvent[];
}

// Message types for inter-component communication
export interface Message {
  id: string;
  type: 'task' | 'event' | 'response' | 'query';
  from: string;
  to: string;
  payload: unknown;
  timestamp: Date;
}

export interface TaskMessage extends Message {
  type: 'task';
  payload: {
    action: string;
    params: Record<string, unknown>;
    intentId?: string;
  };
}

export interface EventMessage extends Message {
  type: 'event';
  payload: {
    eventType: string;
    data: unknown;
    intentId?: string;
  };
}

export interface ResponseMessage extends Message {
  type: 'response';
  payload: TaskResult;
}

export interface QueryMessage extends Message {
  type: 'query';
  payload: {
    queryType: string;
    params: Record<string, unknown>;
  };
}