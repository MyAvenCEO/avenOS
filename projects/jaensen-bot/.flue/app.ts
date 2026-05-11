// Jaensen Bot - Main Application
// Initializes dispatcher and exposes webhook endpoint

import { JaensenDispatcher, JaensenDispatcherConfig } from './agents/dispatcher.js';
import express, { Request, Response } from 'express';

export interface AppConfig {
  memoryPath: string;
  archivePath: string;
  humanInboxUrl?: string;
  port?: number;
}

export class JaensenApp {
  private dispatcher: JaensenDispatcher;
  private app = express();
  private port: number;

  constructor(config: AppConfig) {
    this.port = config.port || 3000;
    
    const dispatcherConfig: JaensenDispatcherConfig = {
      memoryPath: config.memoryPath,
      archivePath: config.archivePath,
      humanInboxUrl: config.humanInboxUrl,
    };
    
    this.dispatcher = new JaensenDispatcher(dispatcherConfig);
    
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    // Webhook endpoint for receiving messages
    this.app.post('/webhook', async (req: Request, res: Response) => {
      try {
        const { type, from, payload } = req.body;
        
        const result = await this.dispatcher.routeMessage({
          id: `msg-${Date.now()}`,
          type: 'task',
          from: from || 'user',
          payload,
          timestamp: new Date(),
        });

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        dispatcher: this.dispatcher.getStatus(),
      });
    });

    // Status endpoint
    this.app.get('/status', (_req: Request, res: Response) => {
      res.json(this.dispatcher.getStatus());
    });

    // Active intents
    this.app.get('/intents', (_req: Request, res: Response) => {
      res.json(this.dispatcher.getActiveIntents());
    });

    // Memory operations (direct access)
    this.app.post('/memory/read', async (req: Request, res: Response) => {
      try {
        const { query, topic } = req.body;
        const { JaensenDispatcher } = await import('./agents/dispatcher.js');
        // Access memory agent through dispatcher
        const result = { success: true, message: 'Use /webhook with memory: prefix' };
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    });

    // Ingest endpoint
    this.app.post('/ingest', async (req: Request, res: Response) => {
      try {
        const { url } = req.body;
        const result = await this.dispatcher.routeMessage({
          id: `ingest-${Date.now()}`,
          type: 'task',
          from: 'user',
          payload: `ingest: ${url}`,
          timestamp: new Date(),
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    });

    // Extract endpoint
    this.app.post('/extract', async (req: Request, res: Response) => {
      try {
        const { archivePath } = req.body;
        const result = await this.dispatcher.routeMessage({
          id: `extract-${Date.now()}`,
          type: 'task',
          from: 'user',
          payload: `extract: ${archivePath}`,
          timestamp: new Date(),
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    });
  }

  // Initialize and start the app
  async start(): Promise<void> {
    await this.dispatcher.initialize();
    
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`Jaensen Bot running on port ${this.port}`);
        resolve();
      });
    });
  }

  // Get the Express app for testing
  getApp() {
    return this.app;
  }
}

// CLI entry point
async function main() {
  const memoryPath = process.env.MEMORY_PATH || './.flue/memory';
  const archivePath = process.env.ARCHIVE_PATH || '/tmp/ingest';
  const humanInboxUrl = process.env.HUMAN_INBOX_URL;
  const port = parseInt(process.env.PORT || '3000', 10);

  const app = new JaensenApp({
    memoryPath,
    archivePath,
    humanInboxUrl,
    port,
  });

  await app.start();
}

// Run if executed directly
main().catch(console.error);

export default JaensenApp;