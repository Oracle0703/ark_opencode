# OpenCode Volcengine Setup Script Design (Revised)

> 本文档是对 `2026-05-10-opencode-volcengine-setup-design.md` 的审核与修订版本。
> 在保留原设计骨架的基础上，补齐了原子写入、备份、XDG 路径、隐藏输入实现细节、
> 幂等性、CI 模式、错误码、测试矩阵等关键缺失项。

## 1. Goal

提供一个跨平台、零依赖的 Node.js 脚本，用于把 Volcengine Ark 接入 OpenCode：

- 检查本地运行时前置条件。
- 在用户同意后可选地全局安装 OpenCode。
- 安全地收集 Ark API key（不回显、不落日志）。
- 把模板中的 `volcengine-plan` provider 合并进用户已有的 OpenCode 配置文件，
  **不破坏任何已有设置**。

## 2. Non-Goals

明确不在本脚本范围内：

- 模型选择 UI / 模型默认值的交互式切换。
- 卸载或升级既有 OpenCode。
- 配置回滚的交互式 UI（仅生成时间戳备份文件，留给用户手动回滚）。
- 校验 API key 在远端是否真实可用（不发起网络请求验证）。
- 编辑除 `volcengine-plan` 之外的任何 provider。

## 3. Inputs

- 项目根目录下的 `example.config.json`（OpenCode 模板）。
- 用户在终端中输入的 Volcengine Ark API key，或通过环境变量
  `ARK_API_KEY` 提供（用于 CI / 非交互模式）。

## 4. Supported Platforms

| 平台                                                      | 支持级别                       |
| --------------------------------------------------------- | ------------------------------ |
| Windows 10 / 11（PowerShell 5+ / Windows Terminal / cmd） | 一级支持                       |
| macOS（zsh / bash）                                       | 一级支持                       |
| Linux（bash）                                             | 同 macOS 实现路径，best-effort |

## 5. Runtime Requirements

- Node.js `>= 22.0.0`（脚本启动时通过 `process.versions.node` 解析校验）。
- npm 在 `PATH` 上可用（仅在需要安装 OpenCode 时强制要求）。
- **脚本本身零运行时依赖**——只使用 Node.js 标准库（`fs`, `path`, `os`,
  `readline`, `child_process`, `crypto`），用户克隆后可直接 `node setup-opencode.js` 运行。

## 6. CLI Surface

```
node setup-opencode.js [options]

Options:
  --yes, -y              非交互模式：不提示安装确认；遇到任何需要用户决策的分支直接按默认值前进。
  --api-key-env <NAME>   从指定环境变量读取 API key（默认 ARK_API_KEY）。
  --non-interactive      显式声明非交互；与 -y 同义，但要求 API key 必须来自环境变量。
  --skip-install         即使未检测到 OpenCode 也不安装，仅写配置。
  --dry-run              打印将要写入的最终配置 JSON（API key 字段以 *** 遮罩），不落盘。
  --config-path <PATH>   覆盖默认的 OpenCode 配置目标路径（用于测试 / 临时环境）。
  -h, --help             打印帮助。
```

退出码：

| Exit Code | 含义                                            |
| --------- | ----------------------------------------------- |
| 0         | 成功                                            |
| 1         | 通用错误（未捕获异常）                          |
| 2         | 运行时前置条件不满足（Node 版本、npm 缺失）     |
| 3         | OpenCode 安装失败                               |
| 4         | 模板 `example.config.json` 缺失或非法           |
| 5         | 用户既有配置文件 JSON 非法                      |
| 6         | 用户取消（SIGINT 或拒绝安装确认且无可继续路径） |
| 7         | 非交互模式下缺少 API key                        |

## 7. User Flow

1. 解析 CLI 参数。
2. 校验 Node.js 版本。
3. 读取并校验 `example.config.json`（结构必须包含
   `provider["volcengine-plan"].options.apiKey`）。
4. 解析 OpenCode 配置目标路径（见 §8）。
5. 若目标文件存在：读取 → 剥 BOM → `JSON.parse`；失败则以 exit 5 结束。
6. **可选**：检查 `opencode` 是否在 PATH。
   - 找不到且未传 `--skip-install`：检查 `npm`，提示用户确认全局安装。
   - 用户同意：执行 `npm install -g opencode-ai`，stdout/stderr 直通终端。
   - 用户拒绝：打印手动安装命令，**继续写配置**（不阻断，因为写配置不依赖 opencode 可执行文件）。
7. 获取 API key（按优先级）：
   1. `--api-key-env` 指定的环境变量；
   2. 默认环境变量 `ARK_API_KEY`；
   3. 交互式隐藏输入（见 §10）。
   - trim 后为空、含 `<` / `>`、或仍等于模板占位 `<ARK_API_KEY>` 时拒绝并重试（非交互模式直接以 exit 7 结束）。
8. 执行合并（见 §9）。
9. 若目标文件已存在：先生成
   `opencode.json.bak-YYYYMMDD-HHMMSS` 备份；备份失败则中止，不写入。
10. 原子写入：写临时文件 `opencode.json.<pid>.<rand>.tmp` → `fs.fsyncSync` →
    `fs.renameSync` 到目标路径；POSIX 下额外 `chmod 0600`。
11. 打印目标路径与备份路径（如果有）；**不打印 API key**；退出码 0。

## 8. Config Path Resolution

按以下顺序确定目标路径：

1. 命令行 `--config-path`。
2. 环境变量 `XDG_CONFIG_HOME`：`$XDG_CONFIG_HOME/opencode/opencode.json`。
3. 平台默认：

   | 平台          | 默认路径                                       |
   | ------------- | ---------------------------------------------- |
   | Windows       | `%USERPROFILE%\.config\opencode\opencode.json` |
   | macOS / Linux | `~/.config/opencode/opencode.json`             |

> 说明：OpenCode 官方支持 XDG 规范，硬编码 `~/.config` 会让设置了
> `XDG_CONFIG_HOME` 的用户出现"两个孤儿配置"的问题，因此优先尊重该变量。

父目录不存在时使用 `fs.mkdirSync(..., { recursive: true })` 创建。

## 9. Merge Strategy

合并以"用户已有配置优先"为基本原则，仅对必须由模板控制的 key 强写。

| Key                                                | 行为                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`                                          | 用户已有则保留；否则填入模板值                                                                                                                          |
| `provider`（其它 provider）                        | 全部保留                                                                                                                                                |
| `provider["volcengine-plan"]`                      | 用模板替换其结构（`npm` / `name` / `options` / `models`），但 `options.apiKey` 写入用户输入；其它子键深合并：模板里没出现的子键（用户自定义的扩展）保留 |
| `provider["volcengine-plan"].options.apiKey`       | **始终写入本次输入的 key**（这正是脚本的目的）                                                                                                          |
| `model`（顶层）                                    | 用户已设置则不动；未设置时填模板值 `volcengine-plan/ark-code-latest`                                                                                    |
| 任何其它根级键（theme, keybinds, agents, tools …） | 一律保留不动                                                                                                                                            |

幂等性：重复运行只会刷新 `volcengine-plan` 的结构 + apiKey，并生成新的备份文件；
其它配置不变，可安全反复运行。

## 10. Hidden Input Implementation

跨平台一致地遮罩 API key 输入，不依赖第三方包。

- 当 `process.stdin.isTTY` 为真时：
  - `readline.createInterface` + 在 `_writeToOutput` 上覆盖输出，使每个字符回写为 `*`（或空字符串）。
  - 进入 raw mode 以避免在 Windows 下出现"输入末尾才回显"的问题。
- 非 TTY（被管道喂入）：直接按行读取，不遮罩，但仍不回显到 stdout 之外的地方。
- SIGINT 时，恢复终端 raw mode 后再退出，避免终端进入怪异状态。

## 11. Atomic Write & Backup

- 备份命名：`opencode.json.bak-YYYYMMDD-HHMMSS`，与目标同目录。
- 备份方式：`fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL)`；
  时间戳碰撞时附加 `-<6 字符随机串>`。
- 写入方式：
  1. 把最终 JSON 序列化为字符串（`JSON.stringify(obj, null, 2) + '\n'`）。
  2. 写到同目录临时文件，`fsyncSync` 确保落盘。
  3. `renameSync` 原子覆盖目标。
  4. POSIX 平台 `chmod 0600`。
- 任意一步失败：删除临时文件，原文件保持原样，错误以 exit 1 退出并指明阶段。

## 12. Error Handling

| 失败                                   | 行为                                                                                                                     | Exit            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Node.js < 22                           | 提示升级到 22+                                                                                                           | 2               |
| npm 缺失（且需要安装时）               | 提示安装 Node.js/npm                                                                                                     | 2               |
| OpenCode 缺失 + 用户拒绝安装           | 打印手动命令，**继续写配置**                                                                                             | 0（若后续成功） |
| OpenCode 缺失 + 安装失败               | 直通 npm 输出，提示 `npm install -g opencode-ai` 重试，并提示常见原因（权限 / 代理 / `npm config get prefix` 未在 PATH） | 3               |
| 模板 JSON 非法或缺关键字段             | 指出 `example.config.json` 问题位置                                                                                      | 4               |
| 既有用户配置 JSON 非法                 | 指出文件路径，建议用户备份并修复                                                                                         | 5               |
| 既有用户配置含 BOM                     | 自动剥除，正常解析；不报错                                                                                               |                 |
| 输入 API key 为空 / 含 `<>` / 等于占位 | 重新提示                                                                                                                 | —               |
| 非交互模式且环境变量未提供 key         | 错误退出                                                                                                                 | 7               |
| 用户 Ctrl+C                            | 恢复终端，删除临时文件，不动既有配置                                                                                     | 6               |
| 备份文件创建失败（磁盘满 / 权限）      | 中止，不写新配置                                                                                                         | 1               |

## 13. Security Notes

- API key 不打印到 stdout / stderr；不写入临时日志；不存进程参数。
- `--dry-run` 输出中 apiKey 字段以 `***` 遮罩。
- 不使用 `sudo`；不静默全局安装；安装前必须显式确认（除非 `--yes`）。
- 写入完成后 POSIX 下文件权限收紧到 `0600`。
- 不读取或回显既有配置中的其它 provider 密钥。
- 不向第三方端点发请求；网络访问仅在用户同意 `npm install` 时由 npm 发起。

## 14. Proposed Files

| File                    | Purpose                       |
| ----------------------- | ----------------------------- |
| `setup-opencode.js`     | 跨平台 Node.js 脚本（零依赖） |
| `example.config.json`   | 现有 OpenCode Volcengine 模板 |
| `README.md`（追加片段） | 使用说明、CLI 参数、故障排查  |

## 15. Verification / Test Matrix

人工或脚本化验证下列场景，每条都应得到符合 §12 表格的结果。

| 场景                                                  | 期望                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| 全新环境，无配置目录                                  | 创建目录，写新文件，权限正确                                     |
| 已有 `opencode.json`，仅含 theme                      | 保留 theme，新增 `volcengine-plan`，不动 `model`（如果用户没设） |
| 已有 `opencode.json`，含其它 provider（如 anthropic） | 该 provider 完整保留                                             |
| 已有 `volcengine-plan` 且 apiKey 不同                 | 仅刷新 apiKey，其它字段按模板更新；旧文件被备份                  |
| 已有顶层 `model: openai/gpt-x`                        | 不被覆盖                                                         |
| 配置文件含 UTF-8 BOM                                  | 正常解析、写回时不带 BOM                                         |
| 配置文件 JSON 非法                                    | exit 5，不动文件                                                 |
| 模板 `example.config.json` 被删除                     | exit 4                                                           |
| 模板缺 `provider["volcengine-plan"].options.apiKey`   | exit 4                                                           |
| Node 20 运行                                          | exit 2，提示升级                                                 |
| `--dry-run`                                           | 不写文件，apiKey 遮罩输出                                        |
| `--non-interactive` 无环境变量                        | exit 7                                                           |
| `--non-interactive` + `ARK_API_KEY=...`               | 成功，无任何提示                                                 |
| 写入过程中 SIGINT                                     | 既有配置完好，无 `.tmp` 残留                                     |
| Windows 下隐藏输入                                    | 输入字符不回显，回车后清屏式确认                                 |
| `XDG_CONFIG_HOME` 已设置                              | 写入到 `$XDG_CONFIG_HOME/opencode/opencode.json`                 |
| `--config-path` 指定到 tmp 目录                       | 写入指定路径，便于自动化测试                                     |

## 16. Open Questions

1. 是否需要在写入前打印 diff（保留 / 新增 / 替换）让用户确认？默认实现倾向于"打印摘要 + 直接写"，
   但可在 `--yes` 关闭时增加 `[y/N]` 二次确认。
2. 模板里 `models` 列表是否需要在合并时与用户既有的同名 provider models 求并集？
   当前设计是"模板覆盖整个 models map"，更简单且和模板版本演进一致；如需保留用户自定义模型，可后续加 `--keep-extra-models` 选项。
3. 是否需要提供卸载脚本（移除 `volcengine-plan`、还原备份）？目前划入 Non-Goals。
