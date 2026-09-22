import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: '.',
	outputDir: process.env.E2E_EVIDENCE_DIR ?? '../../test-results',
	testMatch: ['platform.spec.ts', 'portal-layout.spec.ts'],
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 180_000,
	expect: { timeout: 15_000 },
	reporter: [['line']],
	use: {
		headless: true,
		trace: 'retain-on-failure'
	}
})
