// Memory Worker - manages a single memory thread (markdown file)
// Long-running worker that accumulates knowledge

import { readFile, writeFile, exists } from 'fs/promises';
import { join, dirname } from 'path';

export interface MemoryWorkerConfig {
  threadPath: string;        // Path to the thread file
  topic: string;            // Thread topic (e.g., "people", "companies")
}

export interface MemoryReadResult {
  content: string;
  thread: string;
  entryCount: number;
  lastUpdated: Date;
}

export interface MemoryWriteResult {
  success: boolean;
  thread: string;
  path: string;
}

export interface MemorySearchResult {
  matches: Array<{
    thread: string;
    content: string;
    relevance: number;
  }>;
  totalMatches: number;
}

export class MemoryWorker {
  readonly id: string;
  readonly specialty: string;
  readonly threadPath: string;
  readonly topic: string;
  
  private lastRead?: Date;
  private entryCount = 0;

  constructor(id: string, config: MemoryWorkerConfig) {
    this.id = id;
    this.specialty = `thread:${config.topic}`;
    this.threadPath = config.threadPath;
    this.topic = config.topic;
  }

  // Read memory entries matching a query
  async read(query?: string): Promise<MemoryReadResult> {
    try {
      if (!await exists(this.threadPath)) {
        return {
          content: '',
          thread: this.topic,
          entryCount: 0,
          lastUpdated: new Date(),
        };
      }

      const content = await readFile(this.threadPath, 'utf-8');
      this.lastRead = new Date();
      
      // Parse entry count from file
      this.entryCount = (content.match(/^## /gm) || []).length;
      
      // Filter by query if provided
      let filtered = content;
      if (query) {
        const queryLower = query.toLowerCase();
        const lines = content.split('\n');
        const relevantLines = lines.filter(line => 
          line.toLowerCase().includes(queryLower)
        );
        filtered = relevantLines.join('\n');
      }

      return {
        content: filtered || content,
        thread: this.topic,
        entryCount: this.entryCount,
        lastUpdated: this.lastRead,
      };
    } catch (error) {
      throw new Error(`Failed to read memory: ${error}`);
    }
  }

  // Write new entry to memory thread
  async write(content: string, metadata?: Record<string, unknown>): Promise<MemoryWriteResult> {
    try {
      // Ensure directory exists
      const dir = dirname(this.threadPath);
      if (dir) {
        // Directory creation handled by caller
      }

      // Build entry
      const timestamp = new Date().toISOString().split('T')[0];
      const header = `\n## ${timestamp}`;
      
      let entry = header;
      if (metadata) {
        entry += `\nMetadata: ${JSON.stringify(metadata, null, 2)}`;
      }
      entry += `\n${content}\n`;

      // Check if file exists
      let existingContent = '';
      if (await exists(this.threadPath)) {
        existingContent = await readFile(this.threadPath, 'utf-8');
      } else {
        // Create new thread with header
        existingContent = `---
thread: ${this.topic}
---

# ${this.topic.charAt(0).toUpperCase() + this.topic.slice(1)}

`;
      }

      // Append entry
      const newContent = existingContent + entry;
      await writeFile(this.threadPath, newContent, 'utf-8');
      
      this.entryCount++;
      this.lastRead = new Date();

      return {
        success: true,
        thread: this.topic,
        path: this.threadPath,
      };
    } catch (error) {
      throw new Error(`Failed to write memory: ${error}`);
    }
  }

  // Search within this thread
  async search(entity: string): Promise<MemorySearchResult> {
    try {
      if (!await exists(this.threadPath)) {
        return { matches: [], totalMatches: 0 };
      }

      const content = await readFile(this.threadPath, 'utf-8');
      const entityLower = entity.toLowerCase();
      
      // Simple relevance scoring
      const lines = content.split('\n');
      const matches: Array<{ thread: string; content: string; relevance: number }> = [];
      
      let currentSection = '';
      let sectionContent: string[] = [];
      
      for (const line of lines) {
        if (line.startsWith('# ')) {
          currentSection = line.substring(2);
          sectionContent = [];
        } else if (line.toLowerCase().includes(entityLower)) {
          sectionContent.push(line);
          // Higher relevance if in header
          if (currentSection.toLowerCase().includes(entityLower)) {
            matches.push({
              thread: this.topic,
              content: sectionContent.join('\n'),
              relevance: 0.9,
            });
          }
        }
      }
      
      // If no structured matches, add any line containing the entity
      const simpleMatches = lines.filter(l => l.toLowerCase().includes(entityLower));
      if (matches.length === 0 && simpleMatches.length > 0) {
        matches.push({
          thread: this.topic,
          content: simpleMatches.slice(0, 10).join('\n'),
          relevance: 0.5,
        });
      }

      return {
        matches,
        totalMatches: matches.length,
      };
    } catch (error) {
      throw new Error(`Failed to search memory: ${error}`);
    }
  }

  // Get worker stats
  getStats(): { entryCount: number; lastRead?: Date; topic: string } {
    return {
      entryCount: this.entryCount,
      lastRead: this.lastRead,
      topic: this.topic,
    };
  }
}

// Factory for creating memory workers
export function createMemoryWorker(
  id: string,
  basePath: string,
  topic: string
): MemoryWorker {
  const threadPath = join(basePath, `${topic}.md`);
  return new MemoryWorker(id, { threadPath, topic });
}

// Known thread topics
export const KNOWN_THREADS = [
  'people',
  'companies',
  'events',
  'projects',
  'decisions',
  'audit',
  'dossiers',
] as const;

// Infer topic from content
export function inferTopic(content: string): string {
  const lowerContent = content.toLowerCase();
  
  // Person indicators
  if (
    lowerContent.includes('works at') ||
    lowerContent.includes('ceo') ||
    lowerContent.includes('founder') ||
    lowerContent.includes('@') && lowerContent.includes('name:')
  ) {
    return 'people';
  }
  
  // Company indicators
  if (
    lowerContent.includes('inc') ||
    lowerContent.includes('corp') ||
    lowerContent.includes('llc') ||
    lowerContent.includes('founded') ||
    lowerContent.includes('headquarters')
  ) {
    return 'companies';
  }
  
  // Event indicators
  if (
    lowerContent.includes('meeting') ||
    lowerContent.includes('conference') ||
    lowerContent.includes('happened on') ||
    lowerContent.includes('event:')
  ) {
    return 'events';
  }
  
  // Decision indicators
  if (
    lowerContent.includes('decided') ||
    lowerContent.includes('approved') ||
    lowerContent.includes('rejected') ||
    lowerContent.includes('action item')
  ) {
    return 'decisions';
  }
  
  // Default to audit
  return 'audit';
}