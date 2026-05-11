#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const VERSION = '0.1.0';
const EXIT = {
  GENERAL: 1,
  RUNTIME: 2,
  INSTALL: 3,
  TEMPLATE: 4,
  USER_CONFIG: 5,
  CANCEL: 6,
  API_KEY: 7,
};

let activeTempFile = null;

function parseArgs(argv) {
  const opts = {
    yes: false,
    nonInteractive: false,
    apiKeyEnv: 'ARK_API_KEY',
    skipInstall: false,
    dryRun: false,
    configPath: null,
    verbose: false,
    quiet: false,
    help: false,
    version: false,
    warnings: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--version') opts.version = true;
    else if (arg === '-y' || arg === '--yes') opts.yes = true;
    else if (arg === '--non-interactive') {
      opts.nonInteractive = true;
      opts.yes = true;
    } else if (arg === '--api-key-env') {
      i += 1;
      if (!argv[i]) throw new Error('--api-key-env requires NAME');
      opts.apiKeyEnv = argv[i];
    } else if (arg.startsWith('--api-key-env=')) {
      opts.apiKeyEnv = arg.slice('--api-key-env='.length);
    } else if (arg === '--skip-install') opts.skipInstall = true;
    else if (arg === '--dry-run') {
      opts.dryRun = true;
      opts.skipInstall = true;
    } else if (arg === '--config-path') {
      i += 1;
      if (!argv[i]) throw new Error('--config-path requires PATH');
      opts.configPath = argv[i];
    } else if (arg.startsWith('--config-path=')) {
      opts.configPath = arg.slice('--config-path='.length);
    } else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--quiet') opts.quiet = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (opts.verbose && opts.quiet) {
    opts.quiet = false;
    opts.warnings.push('--quiet ignored because --verbose was also provided');
  }

  if (opts.nonInteractive) opts.yes = true;
  if (opts.dryRun) opts.skipInstall = true;

  return opts;
}

function validateApiKey(value) {
  const key = String(value || '').trim();
  if (!key) return { ok: false, reason: 'API key 不能为空。' };
  if (key.includes('<') || key.includes('>')) return { ok: false, reason: 'API key 不能包含尖括号。' };
  if (key === '<ARK_API_KEY>') return { ok: false, reason: 'API key 不能是模板占位符。' };
  if (key.length < 8) return { ok: false, reason: 'API key 长度过短。' };
  return { ok: true, value: key };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(existingConfig, templateConfig, apiKey) {
  const existing = isObject(existingConfig) ? existingConfig : {};
  const template = templateConfig;
  const templateProvider = template.provider['volcengine-plan'];
  const existingProviderRoot = isObject(existing.provider) ? existing.provider : {};
  const existingVolcengine = isObject(existingProviderRoot['volcengine-plan'])
    ? existingProviderRoot['volcengine-plan']
    : {};

  const provider = {};
  for (const key of Object.keys(existingProviderRoot)) {
    if (key !== 'volcengine-plan') provider[key] = deepClone(existingProviderRoot[key]);
  }

  const volcengine = {};
  volcengine.npm = deepClone(templateProvider.npm);
  volcengine.name = deepClone(templateProvider.name);
  volcengine.options = {
    ...(isObject(templateProvider.options) ? deepClone(templateProvider.options) : {}),
    ...(isObject(existingVolcengine.options) ? deepClone(existingVolcengine.options) : {}),
  };
  for (const key of Object.keys(templateProvider.options || {})) {
    volcengine.options[key] = deepClone(templateProvider.options[key]);
  }
  volcengine.options.apiKey = apiKey;
  volcengine.models = deepClone(templateProvider.models || {});
  for (const key of Object.keys(existingVolcengine)) {
    if (!Object.prototype.hasOwnProperty.call(volcengine, key)) {
      volcengine[key] = deepClone(existingVolcengine[key]);
    }
  }
  provider['volcengine-plan'] = volcengine;

  const result = {};
  for (const key of Object.keys(existing)) {
    if (key === 'provider') result.provider = provider;
    else if (key === 'model' && (typeof existing.model !== 'string' || existing.model === '')) result.model = deepClone(template.model);
    else result[key] = deepClone(existing[key]);
  }

  if (!Object.prototype.hasOwnProperty.call(result, '$schema') && template.$schema !== undefined) {
    result.$schema = deepClone(template.$schema);
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'model') || typeof result.model !== 'string' || result.model === '') {
    result.model = deepClone(template.model);
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'provider')) {
    result.provider = provider;
  }

  return result;
}

function maskApiKey(config) {
  const cloned = deepClone(config);
  const options = cloned?.provider?.['volcengine-plan']?.options;
  if (isObject(options) && Object.prototype.hasOwnProperty.call(options, 'apiKey')) {
    options.apiKey = '***';
  }
  return cloned;
}

function serialize(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function resolveTargetPath(opts = {}, env = process.env) {
  let target;
  if (opts.configPath) {
    target = path.resolve(process.cwd(), opts.configPath);
  } else if (env.XDG_CONFIG_HOME && String(env.XDG_CONFIG_HOME).trim()) {
    target = path.join(env.XDG_CONFIG_HOME, 'opencode', 'opencode.json');
  } else if (process.platform === 'win32') {
    const home = env.USERPROFILE || os.homedir();
    target = path.join(home, '.config', 'opencode', 'opencode.json');
  } else {
    target = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  }

  const exists = fs.existsSync(target);
  let realTarget = target;
  let isSymlink = false;
  if (exists) {
    const stat = fs.lstatSync(target);
    isSymlink = stat.isSymbolicLink();
    realTarget = fs.realpathSync(target);
  }
  return { target, realTarget, exists, isSymlink };
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function loadExistingConfig(realTarget) {
  if (!fs.existsSync(realTarget)) return null;
  const stat = fs.statSync(realTarget);
  if (stat.size === 0) return null;
  const raw = stripBom(fs.readFileSync(realTarget, 'utf8'));
  try {
    return JSON.parse(raw);
  } catch (error) {
    const err = new Error(`用户已有配置不是合法 JSON：${sanitizePathForLog(realTarget)}`);
    err.code = 'USER_CONFIG_JSON';
    err.cause = error;
    throw err;
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backupExisting(realTarget) {
  const dir = path.dirname(realTarget);
  const base = path.basename(realTarget);
  let backup = path.join(dir, `${base}.bak-${timestamp()}`);
  try {
    fs.copyFileSync(realTarget, backup, fs.constants.COPYFILE_EXCL);
    return backup;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  backup = path.join(dir, `${base}.bak-${timestamp()}-${crypto.randomBytes(3).toString('hex')}`);
  fs.copyFileSync(realTarget, backup, fs.constants.COPYFILE_EXCL);
  return backup;
}

function atomicWrite(realTarget, content) {
  const dir = path.dirname(realTarget);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${path.basename(realTarget)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  activeTempFile = tmp;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, realTarget);
    if (process.platform !== 'win32') fs.chmodSync(realTarget, 0o600);
    activeTempFile = null;
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
    activeTempFile = null;
    throw error;
  }
}

function sanitizePathForLog(value) {
  return path.normalize(String(value)).replace(/[\x00-\x1F\x7F]/g, '');
}

function loadTemplate(scriptDir) {
  const templatePath = path.join(scriptDir, 'example.config.json');
  let parsed;
  try {
    parsed = JSON.parse(stripBom(fs.readFileSync(templatePath, 'utf8')));
  } catch (error) {
    const err = new Error(`无法读取或解析模板：${sanitizePathForLog(templatePath)}`);
    err.code = 'TEMPLATE';
    err.cause = error;
    throw err;
  }
  const apiKey = parsed?.provider?.['volcengine-plan']?.options?.apiKey;
  if (typeof apiKey !== 'string') {
    const err = new Error('模板缺少 provider["volcengine-plan"].options.apiKey。');
    err.code = 'TEMPLATE';
    throw err;
  }
  return parsed;
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 22) {
    throw Object.assign(new Error(`需要 Node.js 22+，当前版本是 ${process.versions.node}。`), { exitCode: EXIT.RUNTIME });
  }
}

function printHelp() {
  return `OpenCode Volcengine setup ${VERSION}

Usage:
  node setup-opencode.js [options]

Options:
  -h, --help              打印帮助并退出。
      --version           打印脚本版本。
  -y, --yes               自动确认安装 OpenCode。
      --non-interactive   禁止 prompt，API key 必须来自环境变量。
      --api-key-env NAME  从指定环境变量读取 API key，默认 ARK_API_KEY。
      --skip-install      未检测到 OpenCode 时不自动安装。
      --dry-run           打印遮罩后的配置，不写入文件。
      --config-path PATH  覆盖 OpenCode 配置写入路径。
      --verbose           打印调试日志。
      --quiet             成功时只输出配置路径。
`;
}

function log(opts, message, level = 'info') {
  if (opts.quiet && level !== 'error') return;
  process.stderr.write(`${message}\n`);
}

function debug(opts, message) {
  if (opts.verbose) process.stderr.write(`[debug] ${message}\n`);
}

function findOnPath(command, env = process.env) {
  const pathValue = env.PATH || env.Path || env.path || '';
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32'
    ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
    : [command];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch (_) {}
    }
  }
  return null;
}

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

function runNpmInstall() {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', 'opencode-ai'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function ensureOpencode(opts) {
  if (findOnPath('opencode')) {
    debug(opts, 'detected opencode on PATH');
    return;
  }
  if (opts.skipInstall) {
    log(opts, '未检测到 OpenCode；已跳过安装。可手动运行：npm install -g opencode-ai');
    return;
  }

  let shouldInstall = opts.yes;
  if (!shouldInstall) {
    shouldInstall = await promptYesNo('未检测到 OpenCode，是否现在安装？将执行：npm install -g opencode-ai');
  }
  if (!shouldInstall) {
    log(opts, '已跳过安装。可手动运行：npm install -g opencode-ai');
    return;
  }

  if (!findOnPath('npm')) {
    throw Object.assign(new Error('未检测到 npm，请安装 Node.js/npm 后重试。'), { exitCode: EXIT.RUNTIME });
  }
  log(opts, '正在安装 OpenCode，请稍候...');
  const ok = await runNpmInstall();
  if (!ok) {
    throw Object.assign(new Error('OpenCode 安装失败。请检查权限、代理或 npm 全局目录 PATH，并手动重试：npm install -g opencode-ai'), { exitCode: EXIT.INSTALL });
  }
}

function readApiKeyFromEnv(opts) {
  const raw = process.env[opts.apiKeyEnv];
  if (!raw) return null;
  const result = validateApiKey(raw);
  if (!result.ok) {
    throw Object.assign(new Error(`环境变量 ${opts.apiKeyEnv} 中的 API key 无效：${result.reason}`), { exitCode: EXIT.API_KEY });
  }
  return result.value;
}

function apiKeyPromptText() {
  return [
    '',
    '请输入你的火山订阅专属 API key。',
    '安全提示：输入内容不会显示在终端中，这是正常现象。',
    '粘贴或输入完成后，请按回车继续。',
    'API key：',
  ].join('\n');
}

function promptApiKey() {
  if (!process.stdin.isTTY) {
    throw Object.assign(new Error('当前输入不是 TTY，请通过 ARK_API_KEY 环境变量提供 API key。'), { exitCode: EXIT.API_KEY });
  }

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const originalWrite = rl._writeToOutput;
    rl._writeToOutput = function writeMasked() {};
    const ask = () => {
      process.stderr.write(apiKeyPromptText());
      rl.question('', (answer) => {
        process.stderr.write('\n');
        const result = validateApiKey(answer);
        if (result.ok) {
          rl._writeToOutput = originalWrite;
          rl.close();
          resolve(result.value);
          return;
        }
        process.stderr.write(`${result.reason}\n`);
        ask();
      });
    };
    rl.on('SIGINT', () => {
      rl._writeToOutput = originalWrite;
      rl.close();
      reject(Object.assign(new Error('用户取消。'), { exitCode: EXIT.CANCEL }));
    });
    ask();
  });
}

async function resolveApiKey(opts) {
  const envKey = readApiKeyFromEnv(opts);
  if (envKey) return envKey;
  if (opts.nonInteractive) {
    throw Object.assign(new Error(`非交互模式需要通过 ${opts.apiKeyEnv} 提供 API key。`), { exitCode: EXIT.API_KEY });
  }
  return promptApiKey();
}

function installSignalHandlers() {
  const handler = () => {
    if (activeTempFile) {
      try { fs.unlinkSync(activeTempFile); } catch (_) {}
    }
    process.stderr.write('\n用户取消。\n');
    process.exit(EXIT.CANCEL);
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}

async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(printHelp());
      return 0;
    }
    if (opts.version) {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    for (const warning of opts.warnings) log(opts, warning);
    installSignalHandlers();
    checkNode();

    const template = loadTemplate(__dirname);
    const targetInfo = resolveTargetPath(opts);
    debug(opts, `target=${sanitizePathForLog(targetInfo.target)} exists=${targetInfo.exists} symlink=${targetInfo.isSymlink}`);
    const apiKey = await resolveApiKey(opts);
    const existing = loadExistingConfig(targetInfo.realTarget);
    await ensureOpencode(opts);
    const merged = mergeConfig(existing, template, apiKey);

    if (opts.dryRun) {
      process.stdout.write(serialize(maskApiKey(merged)));
      return 0;
    }

    let backupPath = null;
    if (targetInfo.exists && fs.existsSync(targetInfo.realTarget) && fs.statSync(targetInfo.realTarget).size > 0) {
      backupPath = backupExisting(targetInfo.realTarget);
    }
    atomicWrite(targetInfo.realTarget, serialize(merged));
    if (!opts.quiet) {
      log(opts, `配置已写入：${sanitizePathForLog(targetInfo.target)}`);
      if (backupPath) log(opts, `已创建备份：${sanitizePathForLog(backupPath)}`);
    }
    process.stdout.write(`${targetInfo.target}\n`);
    return 0;
  } catch (error) {
    const exitCode = error.exitCode
      || (error.code === 'TEMPLATE' ? EXIT.TEMPLATE : error.code === 'USER_CONFIG_JSON' ? EXIT.USER_CONFIG : EXIT.GENERAL);
    if (opts?.verbose && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    } else {
      process.stderr.write(`${error.message || String(error)}\n`);
    }
    return exitCode;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  VERSION,
  EXIT,
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
  apiKeyPromptText,
  loadTemplate,
  findOnPath,
  main,
};
