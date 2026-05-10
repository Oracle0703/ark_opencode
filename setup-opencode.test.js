const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  parseArgs,
  validateApiKey,
  mergeConfig,
  maskApiKey,
  serialize,
  resolveTargetPath,
  loadExistingConfig,
  backupExisting,
  atomicWrite,
  sanitizePathForLog,
} = require('./setup-opencode');

function makeTemplate() {
  return {
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
}

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
  const merged = mergeConfig(existing, makeTemplate(), 'new-secret-key');
  assert.equal(merged.model, 'anthropic/claude');
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.provider.anthropic.options.apiKey, 'keep-secret');
  assert.equal(merged.provider['volcengine-plan'].options.apiKey, 'new-secret-key');
  assert.equal(merged.provider['volcengine-plan'].options.customOption, true);
  assert.equal(merged.provider['volcengine-plan'].extraRoot, 'keep');
  assert.deepEqual(Object.keys(merged.provider['volcengine-plan']), ['npm', 'name', 'options', 'models', 'extraRoot']);
});

test('mergeConfig fills model when existing model is not a string', () => {
  const merged = mergeConfig({ model: 123, provider: {} }, makeTemplate(), 'new-secret-key');
  assert.equal(merged.model, 'volcengine-plan/ark-code-latest');
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

test('resolveTargetPath uses explicit config path as absolute target', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const target = path.join(tmp, 'opencode.json');
  const resolved = resolveTargetPath({ configPath: target });
  assert.equal(resolved.target, target);
  assert.equal(resolved.realTarget, target);
  assert.equal(resolved.exists, false);
});

test('loadExistingConfig treats zero-byte file as missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const target = path.join(tmp, 'opencode.json');
  fs.writeFileSync(target, '');
  assert.equal(loadExistingConfig(target), null);
});

test('loadExistingConfig parses UTF-8 BOM JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const target = path.join(tmp, 'opencode.json');
  fs.writeFileSync(target, '\uFEFF{"theme":"dark"}');
  assert.deepEqual(loadExistingConfig(target), { theme: 'dark' });
});

test('backupExisting creates a same-directory backup', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const target = path.join(tmp, 'opencode.json');
  fs.writeFileSync(target, '{"theme":"dark"}\n');
  const backup = backupExisting(target);
  assert.equal(path.dirname(backup), tmp);
  assert.match(path.basename(backup), /^opencode\.json\.bak-\d{8}T\d{6}/);
  assert.equal(fs.readFileSync(backup, 'utf8'), '{"theme":"dark"}\n');
});

test('atomicWrite writes content and removes temp files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const target = path.join(tmp, 'opencode.json');
  atomicWrite(target, '{"ok":true}\n');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"ok":true}\n');
  const tempFiles = fs.readdirSync(tmp).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(tempFiles, []);
});

test('sanitizePathForLog removes control characters', () => {
  assert.equal(sanitizePathForLog('abc\u001b[31mdef'), 'abc[31mdef');
});

test('CLI rejects Node versions below 22', { skip: Number(process.versions.node.split('.')[0]) >= 22 }, () => {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'setup-opencode.js'),
    '--version',
  ], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const target = path.join(tmp, 'opencode.json');
  const run = spawnSync(process.execPath, [
    path.join(__dirname, 'setup-opencode.js'),
    '--non-interactive',
    '--dry-run',
    '--config-path',
    target,
  ], {
    cwd: tmp,
    env: { ...process.env, ARK_API_KEY: 'valid-test-key' },
    encoding: 'utf8',
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Node\.js 22\+/);
});

test('CLI dry-run masks apiKey and does not write target file', { skip: Number(process.versions.node.split('.')[0]) < 22 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const target = path.join(tmp, 'opencode.json');
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'setup-opencode.js'),
    '--non-interactive',
    '--dry-run',
    '--config-path',
    target,
  ], {
    cwd: tmp,
    env: { ...process.env, ARK_API_KEY: 'valid-test-key' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"apiKey": "\*\*\*"/);
  assert.equal(fs.existsSync(target), false);
});
