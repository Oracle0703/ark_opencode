# OpenCode Volcengine Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency Node.js setup script that merges the Volcengine Ark OpenCode template into the user's OpenCode config.

**Architecture:** Implement one CLI file, `setup-opencode.js`, with pure exported helpers for parsing, path resolution, config merging, masking, and validation. Add `node:test` coverage in `setup-opencode.test.js` for pure logic and file write behavior, then add a concise README.

**Tech Stack:** Node.js 22+, CommonJS, Node standard library, `node:test`.

---

### Task 1: Core Pure Helpers

**Files:**
- Create: `setup-opencode.js`
- Create: `setup-opencode.test.js`

- [ ] **Step 1: Write failing tests for args, API key validation, config merge, masking**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  validateApiKey,
  mergeConfig,
  maskApiKey,
  serialize,
} = require('./setup-opencode');

test('parseArgs resolves non-interactive and yes conflict', () => {
  const opts = parseArgs(['--non-interactive', '--yes', '--api-key-env', 'MY_KEY', '--dry-run']);
  assert.equal(opts.nonInteractive, true);
  assert.equal(opts.yes, true);
  assert.equal(opts.apiKeyEnv, 'MY_KEY');
  assert.equal(opts.dryRun, true);
  assert.equal(opts.skipInstall, true);
});

test('validateApiKey rejects placeholder-like values', () => {
  assert.equal(validateApiKey('  real-key-123  ').ok, true);
  assert.equal(validateApiKey('<ARK_API_KEY>').ok, false);
  assert.equal(validateApiKey('abc').ok, false);
  assert.equal(validateApiKey('abc<defghi').ok, false);
});

test('mergeConfig preserves unrelated settings and existing model', () => {
  const template = {
    $schema: 'https://opencode.ai/config.json',
    model: 'volcengine-plan/ark-code-latest',
    provider: {
      'volcengine-plan': {
        npm: '@ai-sdk/openai-compatible',
        name: 'Volcano Engine',
        options: { baseURL: 'https://example.test', apiKey: '<ARK_API_KEY>' },
        models: { 'ark-code-latest': { name: 'ark-code-latest' } },
      },
    },
  };
  const existing = {
    model: 'anthropic/claude',
    theme: 'dark',
    provider: {
      anthropic: { options: { apiKey: 'keep-secret' } },
      'volcengine-plan': {
        options: { customOption: true, apiKey: 'old' },
        extraRoot: 'keep',
      },
    },
  };
  const merged = mergeConfig(existing, template, 'new-secret-key');
  assert.equal(merged.model, 'anthropic/claude');
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.provider.anthropic.options.apiKey, 'keep-secret');
  assert.equal(merged.provider['volcengine-plan'].options.apiKey, 'new-secret-key');
  assert.equal(merged.provider['volcengine-plan'].options.customOption, true);
  assert.equal(merged.provider['volcengine-plan'].extraRoot, 'keep');
  assert.deepEqual(Object.keys(merged.provider['volcengine-plan']), ['npm', 'name', 'options', 'models', 'extraRoot']);
});

test('maskApiKey masks only volcengine api key in cloned object', () => {
  const config = { provider: { 'volcengine-plan': { options: { apiKey: 'secret' } } } };
  const masked = maskApiKey(config);
  assert.equal(masked.provider['volcengine-plan'].options.apiKey, '***');
  assert.equal(config.provider['volcengine-plan'].options.apiKey, 'secret');
});

test('serialize writes two-space JSON with trailing newline', () => {
  assert.equal(serialize({ a: 1 }), '{\n  "a": 1\n}\n');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test setup-opencode.test.js`

Expected: FAIL because `setup-opencode.js` does not exist or exports are missing.

- [ ] **Step 3: Implement minimal pure helpers**

Implement `parseArgs`, `validateApiKey`, `mergeConfig`, `maskApiKey`, and `serialize` in `setup-opencode.js`, exporting them when required as a module.

- [ ] **Step 4: Run tests and verify they pass**

Run: `node --test setup-opencode.test.js`

Expected: PASS.

### Task 2: Filesystem And CLI Behavior

**Files:**
- Modify: `setup-opencode.js`
- Modify: `setup-opencode.test.js`

- [ ] **Step 1: Write failing tests for path resolution, config loading, backup, atomic write**

Add tests that create temporary directories under `os.tmpdir()`, then verify:

- `resolveTargetPath({ configPath })` returns an absolute target.
- `loadExistingConfig` treats a 0-byte file as `null`.
- `loadExistingConfig` parses a UTF-8 BOM file.
- `backupExisting` creates a backup beside the target.
- `atomicWrite` writes valid JSON and removes temp files.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test setup-opencode.test.js`

Expected: FAIL because filesystem helpers are missing.

- [ ] **Step 3: Implement filesystem helpers**

Implement `resolveTargetPath`, `loadExistingConfig`, `backupExisting`, `atomicWrite`, `sanitizePathForLog`, and `loadTemplate`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `node --test setup-opencode.test.js`

Expected: PASS.

### Task 3: CLI Orchestration

**Files:**
- Modify: `setup-opencode.js`
- Modify: `setup-opencode.test.js`

- [ ] **Step 1: Write failing tests for non-interactive dry-run CLI**

Use `child_process.spawnSync(process.execPath, ['setup-opencode.js', '--non-interactive', '--dry-run', '--config-path', tmpPath], { env: { ...process.env, ARK_API_KEY: 'valid-test-key' } })`.

Assert:

- exit code is 0.
- stdout contains `"apiKey": "***"`.
- target file does not exist.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test setup-opencode.test.js`

Expected: FAIL because main orchestration is incomplete.

- [ ] **Step 3: Implement CLI orchestration**

Implement `main`, `checkNode`, `findOnPath`, `ensureOpencode`, `promptYesNo`, `promptApiKey`, logging, help/version, dry-run, and final write flow. Ensure `require.main === module` runs `main()`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `node --test setup-opencode.test.js`

Expected: PASS.

### Task 4: README And Final Verification

**Files:**
- Create: `README.md`
- Modify: `setup-opencode.js` if verification finds issues

- [ ] **Step 1: Add README usage**

Document:

- `node setup-opencode.js`
- `ARK_API_KEY=... node setup-opencode.js --non-interactive`
- `node setup-opencode.js --dry-run`
- OpenCode install behavior and permission notes.
- Existing config merge and backup behavior.

- [ ] **Step 2: Run full verification**

Run:

```bash
node --test setup-opencode.test.js
node setup-opencode.js --help
node setup-opencode.js --version
```

Expected: tests pass; help/version exit 0.

