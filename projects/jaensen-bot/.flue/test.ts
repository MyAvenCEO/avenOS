// Integration test for Jaensen architecture
// Run with: npx tsx .flue/test.ts

import { JaensenDispatcher } from './agents/dispatcher.js';
import { MemorySkillAgent } from './agents/memory.js';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';

async function runTests() {
  console.log('🧪 Testing Jaensen Architecture\n');

  // Setup
  const testDir = '/tmp/jaensen-test';
  await mkdir(testDir, { recursive: true });
  
  const memoryPath = join(testDir, 'memory');
  const archivePath = join(testDir, 'archive');
  await mkdir(memoryPath, { recursive: true });
  await mkdir(archivePath, { recursive: true });

  // Initialize dispatcher
  const dispatcher = new JaensenDispatcher({
    memoryPath,
    archivePath,
  });
  
  await dispatcher.initialize();
  console.log('✅ Dispatcher initialized\n');

  // Test 1: Memory skill
  console.log('--- Test 1: Memory Skill ---');
  const memoryAgent = new MemorySkillAgent(memoryPath);
  await memoryAgent.initialize();
  
  // Write to memory
  const writeResult = await memoryAgent.executeTask({
    action: 'write',
    params: {
      content: 'Alice works at Acme Corp as CEO. Founded in 2020.',
      topic: 'people',
    },
  });
  console.log('Write result:', writeResult.success ? '✅' : '❌', writeResult);
  
  // Read from memory
  const readResult = await memoryAgent.executeTask({
    action: 'read',
    params: { topic: 'people' },
  });
  console.log('Read result:', readResult.success ? '✅' : '❌', {
    thread: readResult.thread,
    entryCount: (readResult.result as any)?.entryCount,
  });
  
  // Search memory
  const searchResult = await memoryAgent.executeTask({
    action: 'search',
    params: { entity: 'Alice' },
  });
  console.log('Search result:', searchResult.success ? '✅' : '❌', {
    totalMatches: (searchResult.result as any)?.totalMatches,
  });

  // Test 2: Dispatcher routing
  console.log('\n--- Test 2: Dispatcher Routing ---');
  
  // Route a memory query
  const routeResult1 = await dispatcher.routeMessage({
    id: 'test-1',
    type: 'task',
    from: 'user',
    payload: 'memory: search: Alice',
    timestamp: new Date(),
  });
  console.log('Memory routing:', routeResult1.success ? '✅' : '❌');
  
  // Route an ingest (will fail without real URL, but routing should work)
  const routeResult2 = await dispatcher.routeMessage({
    id: 'test-2',
    type: 'task',
    from: 'user',
    payload: 'ingest: https://example.com/test.pdf',
    timestamp: new Date(),
  });
  console.log('Ingest routing:', routeResult2.success ? '✅' : '❌', routeResult2.error || 'OK');

  // Test 3: Intent tracking
  console.log('\n--- Test 3: Intent Tracking ---');
  const activeIntents = dispatcher.getActiveIntents();
  console.log('Active intents:', activeIntents.length, '✅');

  // Test 4: Status
  console.log('\n--- Test 4: Status ---');
  const status = dispatcher.getStatus();
  console.log('Dispatcher status:', status);

  // Cleanup
  console.log('\n--- Cleanup ---');
  await rm(testDir, { recursive: true, force: true });
  console.log('✅ Test directory cleaned up');

  console.log('\n🎉 All tests completed!');
}

runTests().catch(console.error);