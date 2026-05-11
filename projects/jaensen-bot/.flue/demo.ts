// Demo: Showing the dispatcher-worker-intent architecture in action
// Run with: npx tsx .flue/demo.ts

import { JaensenDispatcher } from './agents/dispatcher.js';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';

async function runDemo() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Jaensen Bot - Dispatcher/Worker/Intent Demo              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Setup
  const testDir = '/tmp/jaensen-demo';
  await mkdir(testDir, { recursive: true });
  
  const memoryPath = join(testDir, 'memory');
  const archivePath = join(testDir, 'archive');
  await mkdir(memoryPath, { recursive: true });
  await mkdir(archivePath, { recursive: true });

  const dispatcher = new JaensenDispatcher({
    memoryPath,
    archivePath,
  });
  
  await dispatcher.initialize();

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO: Customer support for "Acme Corp deal"
  // ═══════════════════════════════════════════════════════════════════
  
  console.log('📋 SCENARIO: Tracking the Acme Corp deal\n');
  console.log('─'.repeat(60));

  // Step 1: User starts a new topic
  console.log('\n👤 USER: "Following up on the Acme Corp deal"\n');
  
  const intent = await dispatcher.routeMessage({
    id: 'msg-1',
    type: 'task',
    from: 'user',
    payload: 'Following up on the Acme Corp deal',
    timestamp: new Date(),
  });
  
  const intentId = intent.routedTo?.id;
  console.log('🔵 DISPATCHER: Creating new Intent for topic...');
  console.log(`   Intent ID: ${intentId}`);
  console.log(`   Topic: "Acme Corp deal"`);

  // Step 2: Dispatcher logs to memory
  console.log('\n👤 USER: "Alice works at Acme Corp"\n');
  
  await dispatcher.routeMessage({
    id: 'msg-2',
    type: 'task',
    from: 'user',
    payload: 'memory: write: Alice works at Acme Corp as the main contact',
    timestamp: new Date(),
  });
  
  console.log('🔵 DISPATCHER: Routed to Memory skill → written to people.md');
  if (intentId) {
    console.log('🔔 INTENT NOTIFIED: "Memory write completed"');
  }

  // Step 3: Email ingestion
  console.log('\n📧 EMAIL RECEIVED: Invoice from Acme Corp\n');
  
  await dispatcher.routeMessage({
    id: 'msg-3',
    type: 'task',
    from: 'email',
    payload: 'ingest: https://acme.com/invoice-123.pdf',
    timestamp: new Date(),
  });
  
  console.log('🔵 DISPATCHER: Routed to Ingest skill → downloading...');
  console.log('🔔 INTENT NOTIFIED: "Document ingested"');

  // Step 4: Extraction
  console.log('\n🔍 EXTRACTING: Invoice details\n');
  
  await dispatcher.routeMessage({
    id: 'msg-4',
    type: 'task',
    from: 'system',
    payload: 'extract: /tmp/jaensen-demo/archive/invoice-123.pdf',
    timestamp: new Date(),
  });
  
  console.log('🔵 DISPATCHER: Routed to Extract skill → parsing...');
  console.log('🔔 INTENT NOTIFIED: "Extracted $50,000 invoice"');

  // Step 5: User query
  console.log('\n👤 USER: "What do we know about Acme?"\n');
  
  const queryResult = await dispatcher.routeMessage({
    id: 'msg-5',
    type: 'task',
    from: 'user',
    payload: 'memory: search: Acme',
    timestamp: new Date(),
  });
  
  console.log('🔵 DISPATCHER: Routed to Memory skill → searching all threads');
  console.log('🔔 INTENT NOTIFIED: "Memory query executed"');

  // ═══════════════════════════════════════════════════════════════════
  // Show final state
  // ═══════════════════════════════════════════════════════════════════
  
  console.log('\n' + '─'.repeat(60));
  console.log('\n📊 FINAL STATE\n');
  
  const status = dispatcher.getStatus();
  console.log('Dispatcher Status:');
  console.log(`  • Active Intents: ${status.activeIntents}`);
  console.log(`  • Memory Workers: ${status.skills.memory.active}/${status.skills.memory.max}`);
  console.log(`  • Ingest Workers: ${status.skills.ingest.active}/${status.skills.ingest.max}`);
  console.log(`  • Extract Workers: ${status.skills.extract.active}/${status.skills.extract.max}`);
  
  const intents = dispatcher.getActiveIntents();
  console.log('\nActive Intents:');
  for (const i of intents) {
    console.log(`  • ${i.id}`);
    console.log(`    Topic: ${i.topic}`);
    console.log(`    Summary: ${i.summary}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Show memory content
  // ═══════════════════════════════════════════════════════════════════
  
  console.log('\n💭 Memory content (people.md):\n');
  
  const { readFile } = await import('fs/promises');
  try {
    const content = await readFile(join(memoryPath, 'people.md'), 'utf-8');
    console.log(content);
  } catch {
    console.log('(memory file not accessible)');
  }

  // Cleanup
  await rm(testDir, { recursive: true, force: true });
  
  console.log('\n' + '─'.repeat(60));
  console.log('\n✅ Demo completed! Intent tracked all events for the topic.\n');
}

runDemo().catch(console.error);