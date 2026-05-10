# OpenCode Volcengine Setup Script Design (v2 — Dev-Ready)

> 本文档是对 `2026-05-10-opencode-volcengine-setup-design.review.md` 的第二轮修订。
> 在 v1 修订基础上做了 3 轮额外审查（接口与边界 / 文件系统 / 流程与可观测性），
> 解决全部已知歧义，目标是让实现者**无需再猜测任何行为**即可直接编码。
>
> 本版本与 v1 的差异已在文末 §18 Changelog 列出。

---

## 1. Goal

提供一个跨平台、零依赖的 Node.js 脚本，用于把 Volcengine Ark 接入 OpenCode：

- 检查本地运行时前置条件。
- 在用户同意后可选地全局安装 OpenCode。
- 安全地收集 Ark API key（不回显、不落日志、不进 `argv`）。
- 把模板中的 `volcengine-plan` provider 合并进用户既有的 OpenCode 配置文件，
  **不破坏任何已有设置**。

## 2. Non-Goals

- 模型选择 UI / 模型默认值的交互式切换。
- 卸载或升级既有 OpenCode。
- 配置回滚的交互式 UI（仅生成时间戳备份文件，留给用户手动回滚）。
- 在远端校验 API key 是否真实可用（不发起业务请求验证）。
- 编辑除 `volcengine-plan` 之外的任何 provider。
- 多实例并发执行（明确不支持，见 §11.5）。

## 3. Inputs

- 与脚本同目录的 `example.config.json`（OpenCode 模板）。
  - 查找方式：`path.join(__dirname, 'example.config.json')`，**不读 `process.cwd()`**，确保被全局安装或从其它目录调用时仍能定位模板。
- 用户的 Volcengine Ark API key，来源按 §7 step 5 的优先级。

## 4. Supported Platforms

| 平台                                                      | 支持级别    | 备注                                 |
| --------------------------------------------------------- | ----------- | ------------------------------------ |
| Windows 10 / 11（PowerShell 5+ / Windows Terminal / cmd） | 一级        | Node ≥ 22 自带 `renameSync` 覆盖语义 |
| macOS（zsh / bash）                                       | 一级        |                                      |
| Linux（bash）                                             | best-effort | 与 macOS 共用 POSIX 实现路径         |

## 5. Runtime Requirements

- Node.js `>= 22.0.0`（启动时通过 `process.versions.node` 解析校验，仅比较 major）。
- 当且仅当需要安装 OpenCode 时，要求 npm 在 `PATH` 上可用。
- **脚本零运行时依赖**：仅使用 Node 标准库（`fs`, `path`, `os`, `readline`,
  `child_process`, `crypto`, `tty`, `process`）。

## 6. CLI Surface

```
node setup-opencode.js [options]

Options:
  -h, --help              打印帮助并退出（exit 0）。
      --version           打印脚本语义化版本（与文件头常量一致）并退出（exit 0）。
  -y, --yes               跳过所有 [y/N] 确认，按"安全默认"前进（见 §6.1）。
                          仍可交互式 prompt API key（如未通过 env 提供）。
      --non-interactive   严格非交互：禁止任何 prompt；
                          API key 必须来自环境变量，否则 exit 7。
                          隐含 --yes 行为，但更严格。
      --api-key-env NAME  从指定环境变量读取 API key（默认 ARK_API_KEY）。
      --skip-install      即使未检测到 opencode 也不安装，仅写配置。
      --dry-run           不写盘；打印将要写入的最终 JSON，
                          其中 apiKey 字段固定遮罩为 "***"。
                          仍会按正常流程获取 API key（含 prompt）。
      --config-path PATH  覆盖默认的 OpenCode 配置目标路径（绝对或相对 cwd）。
      --verbose           打印调试级日志到 stderr。
      --quiet             仅打印错误；成功时只输出最终路径一行。
```

### 6.1 参数交互与默认值

| 场景                                                     | 默认                                              | `--yes` 行为          | `--non-interactive` 行为           |
| -------------------------------------------------------- | ------------------------------------------------- | --------------------- | ---------------------------------- |
| "未检测到 opencode，是否 `npm install -g opencode-ai`？" | prompt `[y/N]`，默认 N                            | 视为 Y，自动安装      | 视为 Y，自动安装；无 npm 则 exit 2 |
| "已存在 `volcengine-plan`，是否覆盖？"                   | 仅打印将变更摘要，**不 prompt**（备份保护已足够） | 同左                  | 同左                               |
| API key 输入                                             | TTY 隐藏 prompt，重试至合法                       | 同左（TTY 仍 prompt） | **不 prompt**；env 缺失 → exit 7   |
| stdin 非 TTY 且无 env key                                | exit 7 + 提示如何提供                             | 同左                  | 同左                               |

冲突解析：

- `--non-interactive` 与 `--yes` 同时出现：等价于 `--non-interactive`（更严格胜出）。
- `--quiet` 与 `--verbose` 同时出现：以 `--verbose` 胜出，并向 stderr 打一条 warning。
- `--dry-run` 与 `--skip-install` 不冲突；`--dry-run` 隐含 `--skip-install`（不真实改变本机状态）。

### 6.2 退出码

| Exit | 含义                                                                 |
| ---- | -------------------------------------------------------------------- |
| 0    | 成功（含 dry-run 成功、用户拒绝安装但配置写入成功）                  |
| 1    | 通用错误 / 未捕获异常 / 文件系统 IO 失败                             |
| 2    | 运行时前置条件不满足（Node 版本过低、需要安装 opencode 时 npm 缺失） |
| 3    | OpenCode 安装失败（npm 进程非 0 退出）                               |
| 4    | 模板 `example.config.json` 缺失或非法                                |
| 5    | 用户既有配置 JSON 非法（注：0 字节文件视为不存在，**不**触发此码）   |
| 6    | 用户主动取消（SIGINT / SIGTERM；不再覆盖"拒绝安装"语义）             |
| 7    | 非交互模式缺少 API key                                               |

## 7. User Flow

> 顺序经过调整：**先完整确定 API key、再做耗时的安装动作**，
> 避免装完 opencode 后用户在密钥环节取消而留下副作用。

1. 解析 CLI 参数（§6）。挂载 SIGINT / SIGTERM 处理器（§12）。
2. 校验 Node.js 版本；不满足 → exit 2。
3. 读取并校验模板 `example.config.json`（§3）；非法或缺
   `provider["volcengine-plan"].options.apiKey` → exit 4。
4. 解析目标配置路径（§8），记录是否已存在 / 是否符号链接（§11.4）。
5. **确定** API key：
   1. `process.env[--api-key-env || 'ARK_API_KEY']` 非空 → 立即采用。
   2. 否则若 `--non-interactive` → exit 7。
   3. 否则若 `process.stdin.isTTY !== true` → exit 7，并提示使用环境变量提供。
   4. 否则立即进入 TTY 隐藏 prompt（§10），重试至合法或用户取消。
6. 读取既有用户配置（若存在）：
   - 0 字节 → 视为"不存在"，不报错。
   - 含 UTF-8 BOM → 自动剥除。
   - `JSON.parse` 失败 → exit 5，提示文件路径与建议手动备份。
7. OpenCode 探测与安装：
   - 探测方式：在 `PATH` 中查找 `opencode` / `opencode.cmd`（自实现 PATH 扫描，避免 spawn 副作用）。
   - 已存在 → 跳过本步。
   - 不存在 + `--skip-install` → 跳过，仅打印安装提示。
   - 不存在 + 用户同意（或 `--yes`/`--non-interactive`）：
     - 校验 npm 存在；缺失 → exit 2。
     - `spawn('npm', ['install', '-g', 'opencode-ai'], { stdio: 'inherit', shell: process.platform === 'win32' })`。
     - 非 0 退出 → exit 3，提示常见原因（权限 / 代理 / `npm config get prefix` 不在 PATH）。
   - 不存在 + 用户拒绝 → 打印手动安装命令，**继续后续流程**（不阻断）。
8. 执行合并（§9），生成最终 JSON 对象。
9. `--dry-run`：打印遮罩后的 JSON，exit 0；否则继续。
10. 落盘（§11）：
    1. 如目标已存在，先生成备份。
    2. 写临时文件 → fsync → rename 覆盖。
    3. POSIX 下 `chmod 0600`。
11. 打印目标路径与备份路径（如有）；**绝不打印 API key**；exit 0。

## 8. Config Path Resolution

按以下顺序确定目标路径：

1. CLI `--config-path`（绝对或相对 cwd 解析为绝对路径）。
2. 环境变量 `XDG_CONFIG_HOME`（且非空字符串）：
   `path.join(XDG_CONFIG_HOME, 'opencode', 'opencode.json')`。
3. 平台默认：

   | 平台          | 默认路径                                       |
   | ------------- | ---------------------------------------------- |
   | Windows       | `%USERPROFILE%\.config\opencode\opencode.json` |
   | macOS / Linux | `~/.config/opencode/opencode.json`             |

> 说明：OpenCode 官方支持 XDG，硬编码 `~/.config` 会让设置了
> `XDG_CONFIG_HOME` 的用户出现"两个孤儿配置"。

父目录不存在时使用 `fs.mkdirSync(..., { recursive: true })` 创建（POSIX 下 mode `0700`）。

## 9. Merge Strategy

合并以"用户已有配置优先"为基本原则，仅对必须由模板控制的 key 强写。

### 9.1 字段规则

| Key                                                    | 行为                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$schema`                                              | 用户已有则保留；否则填模板值                                                                                                                                                               |
| `provider`（其它 provider）                            | 全部保留                                                                                                                                                                                   |
| `provider["volcengine-plan"]`                          | 用模板的 `npm` / `name` / `models` **整体替换**；`options` 做浅合并：模板中的 `options` 字段全部写入，但用户在 `options` 中存在而模板中没有的扩展字段保留；`options.apiKey` 必写为本次输入 |
| `provider["volcengine-plan"]` 的额外子键（不在模板中） | 保留                                                                                                                                                                                       |
| `model`（顶层）                                        | 用户已设置（即使值为空字符串以外的有效字符串）则不动；未设置或非字符串时填模板值                                                                                                           |
| 其它根级键（theme, keybinds, agents, tools, mcp, …）   | 一律保留不动                                                                                                                                                                               |

幂等性：重复运行只会刷新 `volcengine-plan` 的结构 + apiKey，并产生新备份；
其它配置不变。

### 9.2 输出键序

为减少 diff 噪音，最终对象按"用户原序优先 + 新增键追加"组织：

1. 先按用户原配置 key 的插入顺序拷贝键值。
2. 用户没有但模板提供的根级键（如新建场景下的 `$schema`、`model`、`provider`）按以下固定顺序追加：
   `$schema`, `model`, `provider`。
3. `provider` 内部：先用户原顺序，再追加 `volcengine-plan`（若新增）。
4. `provider["volcengine-plan"]` 内部固定顺序：`npm`, `name`, `options`, `models`。
5. `models` 内部按模板原顺序，**不做合并**（模板视为唯一真相源；如需保留用户自定义模型，可后续加 `--keep-extra-models`）。

## 10. Hidden Input Implementation

跨平台一致地遮罩 API key 输入，不依赖第三方包。

- TTY 检测：`process.stdin.isTTY === true`。
- 实现要点：
  - 创建 `readline.Interface` 后覆盖其 `_writeToOutput`，所有非 ANSI 字符回写为空（不打 `*`，避免泄露长度）。
  - 进入 raw mode（`process.stdin.setRawMode(true)`）；处理函数手动收集字符直到回车，并自行处理 backspace / Ctrl+C / Ctrl+D。
  - 完成后恢复 raw mode 并 `rl.close()`，确保异常分支也走 `try/finally`。
- 非 TTY 且没有环境变量 API key：不读取 stdin 作为密钥，直接 exit 7；这避免在管道日志中意外暴露密钥。
- API key 校验链（按顺序，任一失败即重试）：
  1. trim 后非空。
  2. 不含 `<` 或 `>`（拒绝复制了带尖括号占位的整段）。
  3. 不等于模板里的占位字符串 `<ARK_API_KEY>`（兜底）。
  4. 长度 ≥ 8（轻量防误粘）。
- SIGINT / Ctrl+C：恢复 raw mode → 删除任何已建立的临时文件 → exit 6。

## 11. Atomic Write & Backup

### 11.1 备份

- 命名：`<basename>.bak-YYYYMMDDTHHMMSS`（ISO 风格、本地时区）。
- 时间戳碰撞：附加 `-<crypto.randomBytes(3).toString('hex')>`。
- 创建方式：`fs.copyFileSync(realTarget, backup, fs.constants.COPYFILE_EXCL)`。
  - 仅当目标已存在时创建备份；存在的 `realTarget` 取自 `fs.realpathSync(target)`（处理符号链接，见 §11.4）。
- 备份失败 → exit 1，不写新配置。
- 不做自动清理，文档中说明用户可定期清理 `*.bak-*`。

### 11.2 写入

1. 序列化：`JSON.stringify(obj, null, 2) + '\n'`，**始终使用 LF**（即使 Windows 也写 `\n`，与 OpenCode 仓库 / 多数编辑器一致）。
2. 临时文件：与 `realTarget` **同目录**，命名 `<basename>.<pid>.<rand>.tmp`。
3. `fs.openSync(tmp, 'w', 0o600)` → `fs.writeFileSync(fd, content)` → `fs.fsyncSync(fd)` → 关闭 fd。
4. `fs.renameSync(tmp, realTarget)`（同分区，原子；Node ≥ 22 在 Windows 上覆盖既有文件已稳定）。
5. POSIX 下再次 `fs.chmodSync(realTarget, 0o600)`；Windows 上跳过并在 verbose 日志中说明"文件 ACL 继承自用户目录"。

### 11.3 失败处理

任意一步失败：

- 删除临时文件（若存在），忽略 ENOENT。
- 既有文件保持原样（rename 之前不会被破坏）。
- 错误日志含阶段标签（`stage=backup|write|fsync|rename|chmod`）+ 原始 errno。

### 11.4 符号链接

- 若 `target` 是符号链接，取 `fs.realpathSync(target)` 作为 `realTarget`。
- 若 `target` 不存在，`realTarget` 等于解析后的绝对 `target` 路径。
- 备份与写入都针对 `realTarget`，符号链接本身不变。
- 父目录创建仍以原 `target` 的 dirname 进行（保证链接所在目录存在）。

### 11.5 并发与锁

- 不实现锁机制；多实例并发运行属未支持场景。
- 通过文件名中的 `<pid>` + 随机串规避临时文件命名冲突；rename 本身原子，最坏情况是后写者覆盖前写者的合并结果。
- README 中明确建议"同一时刻只跑一个 setup-opencode"。

## 12. Error Handling

| 失败                                        | 行为                                 | Exit                                       |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| Node.js < 22                                | 提示升级                             | 2                                          |
| 需要 npm 但未找到                           | 提示安装 Node/npm                    | 2                                          |
| OpenCode 缺失 + 用户拒绝安装                | 打印手动命令；继续写配置             | 0（写入成功）/ 5/1（其它后续失败按对应码） |
| OpenCode 缺失 + npm 安装非 0                | 直通 npm 输出；提示重试与常见原因    | 3                                          |
| 模板缺失 / JSON 非法 / 缺关键字段           | 指明 `example.config.json` 与原因    | 4                                          |
| 既有用户配置 JSON 非法（且非 0 字节空文件） | 指明文件路径，建议用户备份并修复     | 5                                          |
| 既有配置 0 字节                             | 视为不存在                           | —                                          |
| 既有配置含 BOM                              | 自动剥除                             | —                                          |
| API key 校验失败                            | TTY 模式重试；非交互模式 exit 7      | — / 7                                      |
| SIGINT / SIGTERM                            | 恢复终端、清理临时文件、不动既有配置 | 6                                          |
| 备份创建失败                                | 中止，不写新配置                     | 1                                          |
| rename 失败                                 | 删除 tmp，原文件不变                 | 1                                          |
| 任何未捕获异常                              | 打印 stack（verbose 时）或简短消息   | 1                                          |

## 13. Security Notes

- API key 永不出现在 stdout / stderr / 日志 / 进程参数；只出现在最终落盘的 JSON 中。
- `--dry-run` 输出固定将 apiKey 替换为 `***`。
- 不使用 `sudo`；不静默全局安装；安装前必须显式确认（`--yes`/`--non-interactive` 例外）。
- 写入文件 mode `0600`（POSIX）。Windows 上依赖用户目录默认 ACL。
- 不输出、不修改既有配置中的其它 provider 密钥（只对 `volcengine-plan.options.apiKey` 操作）。
- 不发任何业务网络请求；网络仅在 `npm install` 阶段、由 npm 自身发起。
- 所有错误消息中如包含路径，先 `path.normalize`，再移除 C0 控制字符后输出，避免终端控制字符注入。

## 14. Logging & Output Conventions

- 所有提示性 / 进度信息走 **stderr**。
- 仅"最终生效的配置路径"走 **stdout**（方便脚本 `PATH=$(node setup-opencode.js)` 取值）。
- `--quiet`：成功时仅 stdout 一行路径，stderr 仅打错误。
- `--verbose`：stderr 增加 `[debug]` 前缀的阶段日志、文件大小、是否符号链接等。
- 默认日志为简体中文；环境变量 `LANG` 以 `en` 开头时自动切换为英文（仅影响人类可读消息，不影响错误码）。

## 15. Implementation Sketch

建议把脚本拆为以下独立函数（同一文件内），便于单测：

```
parseArgs(argv) -> { yes, nonInteractive, apiKeyEnv, skipInstall,
                     dryRun, configPath, verbose, quiet, helpOrVersion }

checkNode()                              // exit 2 on fail
loadTemplate(scriptDir)                  // exit 4 on fail
resolveTargetPath(opts)                  // returns { target, realTarget?, exists, isSymlink }
loadExistingConfig(realTarget)           // exit 5 / null / object
resolveApiKey(opts)                      // env -> ok | needPrompt | exit 7
ensureOpencode(opts)                     // detect + maybe install; exit 2/3
promptApiKey()                           // hidden TTY input, validated
mergeConfig(existing, template, apiKey)  // pure
serialize(obj)                           // JSON.stringify(...,2) + '\n'
backup(realTarget)                       // returns backupPath
atomicWrite(realTarget, content)         // tmp+fsync+rename+chmod
maskApiKey(obj)                          // for --dry-run
installSignalHandlers(cleanup)           // SIGINT/SIGTERM
log(level, msg)                          // respects --verbose/--quiet
```

`main()` 仅做编排，所有副作用集中在最外层；纯函数（`mergeConfig`, `serialize`,
`maskApiKey`, `parseArgs`）可在 `node --test` 下直接覆盖。

## 16. Verification / Test Matrix

| #   | 场景                                                | 期望                                               |
| --- | --------------------------------------------------- | -------------------------------------------------- |
| 1   | 全新环境，无配置目录                                | 创建目录（mode 0700）、写新文件（mode 0600）       |
| 2   | 已有 `opencode.json`，仅含 theme                    | 保留 theme，新增 `volcengine-plan`，model 取模板值 |
| 3   | 已有其它 provider（anthropic 等）                   | 完整保留                                           |
| 4   | 已有 `volcengine-plan` 且 apiKey 不同               | 刷新 apiKey + 模板字段；旧文件被备份               |
| 5   | 已有顶层 `model: openai/gpt-x`                      | 不被覆盖                                           |
| 6   | 配置文件含 UTF-8 BOM                                | 正常解析；写回不带 BOM                             |
| 7   | 配置文件 JSON 非法                                  | exit 5，原文件不动                                 |
| 8   | 配置文件 0 字节                                     | 视为新建，exit 0                                   |
| 9   | 模板缺失                                            | exit 4                                             |
| 10  | 模板缺 `provider["volcengine-plan"].options.apiKey` | exit 4                                             |
| 11  | Node 20 运行                                        | exit 2                                             |
| 12  | `--dry-run`                                         | 不写文件，apiKey=`***`                             |
| 13  | `--non-interactive` 无 env                          | exit 7                                             |
| 14  | `--non-interactive` + `ARK_API_KEY=...`             | exit 0，无 prompt                                  |
| 15  | 写入过程中 SIGINT                                   | 既有文件完好，无 `.tmp` 残留，exit 6               |
| 16  | Windows 下隐藏输入                                  | 字符不回显、长度不可见                             |
| 17  | `XDG_CONFIG_HOME` 已设置                            | 写入到 XDG 路径                                    |
| 18  | `--config-path` 指向 tmp                            | 写到指定路径                                       |
| 19  | 目标是符号链接                                      | realTarget 被备份与覆盖，链接保留                  |
| 20  | API key 含尖括号 / 长度 < 8 / 是占位符              | 重试或 exit 7                                      |
| 21  | 模板路径在脚本目录而非 cwd                          | 切换 cwd 后仍能找到                                |
| 22  | `npm install -g` 失败（mock npm 返回非 0）          | exit 3，输出包含 npm stderr                        |
| 23  | 用户拒绝安装 opencode                               | 写配置 + exit 0                                    |
| 24  | `--quiet` 成功路径                                  | stdout 单行路径，stderr 空                         |
| 25  | 同时 `--non-interactive --yes`                      | 与单独 `--non-interactive` 行为一致                |

## 17. Open Questions

1. 写入前是否打印 diff（保留 / 新增 / 替换）？默认实现：打印 1 行摘要
   "merged volcengine-plan into <path>，备份 <bak>"。详细 diff 留给 `--verbose`。
2. 是否需要 `--keep-extra-models`？当前不实现，留作后续。
3. 是否需要卸载脚本？目前 Non-Goals。
4. 中英文消息切换是否需要 `--lang`？暂以 `LANG` env 自动切换，必要时再补 CLI。

## 18. Changelog vs v1

新增 / 收紧的设计点：

- **§3** 模板路径定为 `__dirname`，避免 cwd 依赖。
- **§6** 新增 `--version` / `--verbose` / `--quiet`；`--dry-run` 隐含 `--skip-install`。
- **§6.1** 新增"参数交互与默认值"表，明确 `--yes` / `--non-interactive` 在每个分支的具体行为与冲突解析。
- **§6.2 / §12** 退出码 6 收敛为"用户主动取消"，"拒绝安装"不再算失败。
- **§7** 流程顺序调整：API key 在安装 opencode 之前先完整确定。
- **§7 / §11.4** 增加符号链接处理与 `realpathSync`。
- **§7 step 6** 既有配置 0 字节按"不存在"处理。
- **§7 / §10** OpenCode 探测改为自行扫描 PATH，不 spawn。
- **§9.2** 新增"输出键序"小节，固定字段排序，降低 diff 噪音。
- **§10** 隐藏输入改为不打 `*`（避免泄露长度）；增加最小长度 8 校验。
- **§11.1 / §11.2** 备份命名加 ISO 时间戳；写入显式 LF；mode 0600；fsync + rename。
- **§11.3** 失败时附带 `stage=` 标签与 errno。
- **§11.5** 明确不支持并发，并说明竞争行为。
- **§13** 路径输出做 `path.normalize` 并移除 C0 控制字符，避免终端控制字符注入。
- **§14** 新增日志规范：stderr / stdout 分流，便于脚本捕获最终路径。
- **§15** 新增实现伪代码，划分纯函数与副作用边界，便于单测。
- **§16** 测试矩阵从 17 项扩到 25 项，覆盖符号链接、0 字节、`--quiet`、参数冲突、模板路径解析等。
