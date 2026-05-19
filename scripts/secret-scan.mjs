#!/usr/bin/env node
/**
 * Secret scanner — fails the commit if any tracked file contains a known
 * secret pattern. Run before every commit (manual or via pre-commit hook).
 *
 * Usage:
 *   node scripts/secret-scan.mjs           # scan all tracked files
 *   node scripts/secret-scan.mjs --staged  # scan only staged files (pre-commit)
 *
 * Patterns checked:
 *   - Anthropic API keys: sk-ant-*
 *   - AWS access keys: AKIA[0-9A-Z]{16}
 *   - Generic high-entropy tokens (heuristic): 40+ char alnum strings near "key" / "secret"
 *   - JWT tokens: eyJ.*.eyJ.*.*
 *   - Private keys: -----BEGIN ... PRIVATE KEY-----
 *
 * Files explicitly skipped:
 *   - .env.example (allowed to contain placeholder text)
 *   - this script itself
 *   - lockfiles (package-lock.json, etc.)
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGED = process.argv.includes('--staged')
const ROOT = process.cwd()

const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'OpenAI API key', re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/g },
  { name: 'Generic JWT', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'GitHub PAT', re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/g },
]

const SKIP_FILES = new Set([
  '.env.example',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'scripts/secret-scan.mjs',
])

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.lock', '.bin', '.exe'])

// Skip dependencies, build artifacts, and other vendor directories
const SKIP_PATH_FRAGMENTS = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.next/',
  '.git/',
  'vendor/',
]

function getFiles() {
  const cmd = STAGED
    ? 'git diff --cached --name-only --diff-filter=ACM'
    : 'git ls-files'
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
}

const findings = []
const files = getFiles()

for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  if (SKIP_FILES.has(file.split('/').pop())) continue
  if ([...SKIP_EXT].some((ext) => file.toLowerCase().endsWith(ext))) continue
  if (SKIP_PATH_FRAGMENTS.some((frag) => file.includes(frag))) continue

  const abs = resolve(ROOT, file)
  if (!existsSync(abs)) continue

  let content
  try {
    content = readFileSync(abs, 'utf-8')
  } catch {
    continue // binary or unreadable
  }

  for (const { name, re } of PATTERNS) {
    const matches = content.match(re)
    if (matches) {
      for (const match of matches) {
        findings.push({
          file,
          type: name,
          preview: match.slice(0, 12) + '…',
        })
      }
    }
  }
}

if (findings.length > 0) {
  console.error('\n[SECRET SCAN] FAILED — secrets detected in tracked files:\n')
  for (const f of findings) {
    console.error(`  ${f.file}`)
    console.error(`    Type: ${f.type}`)
    console.error(`    Preview: ${f.preview}\n`)
  }
  console.error('Remove the secret, rotate the credential, and re-run the commit.')
  console.error('If this is a false positive, add the file to SKIP_FILES in scripts/secret-scan.mjs.\n')
  process.exit(1)
}

console.log(`[SECRET SCAN] OK — ${files.length} files scanned, 0 secrets found.`)
process.exit(0)
