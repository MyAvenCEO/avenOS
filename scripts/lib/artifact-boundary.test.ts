import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
test('source workflows cannot acquire installation authority', () => {
 for (const file of readdirSync('.github/workflows')) {
  const workflow = Bun.YAML.parse(readFileSync(`.github/workflows/${file}`, 'utf8')) as any
  for (const job of Object.values(workflow.jobs) as any[]) expect(job.environment).toBeUndefined()
  const text = JSON.stringify(workflow)
  expect(text).not.toMatch(/HETZNER_COMPUTE_TOKEN|BACKUP_RESTIC_PASSWORD|PULUMI_CONFIG_PASSPHRASE|platform-deploy|platform-infrastructure|repository_dispatch|workflow run/)
 }
 expect(existsSync('infrastructure')).toBe(false)
 expect(existsSync('scripts/deployment-bootstrap.ts')).toBe(false)
})
test('successful source verification publishes a durable attested manifest', () => {
 const workflow=Bun.YAML.parse(readFileSync('.github/workflows/platform-release.yml','utf8')) as any
 expect(workflow.jobs.publish.needs).toEqual(['build','verify'])
 const text=JSON.stringify(workflow.jobs.publish)
 expect(text).toContain('subject-path')
 expect(text).toContain('gh release create')
 expect(text).toContain('release-attestation.jsonl')
 expect(readFileSync('deploy/operations/Dockerfile','utf8')).toContain('/release/deploy/runtime/')
})
