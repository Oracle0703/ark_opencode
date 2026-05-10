# OpenCode Volcengine Setup Script Design

## Goal

提供一个跨平台、零依赖的 Node.js 脚本，用于把 Volcengine Ark 接入 OpenCode：

- 检查本地运行时前置条件。
- 在用户确认后可选地全局安装 OpenCode。
- 安全收集 Ark API key，不回显、不落日志。
- 把 `example.config.json` 中的 `volcengine-plan` provider 合并进用户已有的 OpenCode 配置文件。
- 尽量保护用户已有配置，不覆盖无关 provider、主题、快捷键、工具等设置。

## Non-Goals

| 不做的事 | 原因 |
|---|---|
| 检查或强制升级已有 OpenCode 到最新版 | 用户已确认“安装了就通过” |
| 模型选择 UI | 当前目标是初始化配置，不做交互式模型管理 |
| 远端校验 API key 是否可用 | 会引入额外网络请求和失败路径 |
| 自动使用 `sudo` 或静默提权 | 权限边界应由用户显式处理 |
| 卸载或回滚 UI | 仅生成备份文件，用户可手动回滚 |

## Inputs

| 输入 | 用途 |
|---|---|
| `example.config.json` | OpenCode Volcengine 配置模板 |
| 终端输入的 API key | 写入 `provider["volcengine-plan"].options.apiKey` |
| 环境变量 `ARK_API_KEY` | 非交互或 CI 场景下提供 API key |

## Supported Platforms

| 平台 | 支持级别 |
|---|---|
| Windows 10 / 11 | 一级支持 |
| macOS | 一级支持 |
| Linux | best-effort，复用 POSIX 路径逻辑 |

## Runtime Requirements

| 依赖 | 要求 |
|---|---|
| Node.js | `>= 22.0.0`，通过 `process.versions.node` 校验 |
| npm | 仅在需要自动安装 OpenCode 时强制要求 |
| OpenCode | 已安装则直接通过；未安装时询问是否执行 `npm install -g opencode-ai` |

脚本本身不引入第三方运行时依赖，只使用 Node.js 标准库：`fs`、`path`、`os`、`readline`、`child_process`、`crypto`。

## CLI Surface

```text
node setup-opencode.js [options]

Options:
  --yes, -y              使用默认确认项；未安装 OpenCode 时自动安装。
  --api-key-env <NAME>   从指定环境变量读取 API key，默认 ARK_API_KEY。
  --non-interactive      非交互模式，API key 必须来自环境变量。
  --skip-install         即使未检测到 OpenCode 也不安装，仅写配置。
  --dry-run              打印将写入的配置，apiKey 用 *** 遮罩，不落盘。
  --config-path <PATH>   覆盖默认 OpenCode 配置路径，主要用于测试。
  -h, --help             打印帮助信息。
```

## Exit Codes

| Exit Code | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 通用错误或写入/备份失败 |
| 2 | 运行时前置条件不满足，如 Node 版本过低、需要安装时 npm 缺失 |
| 3 | OpenCode 自动安装失败 |
| 4 | `example.config.json` 缺失、JSON 非法或结构不符合预期 |
| 5 | 用户已有 `opencode.json` JSON 非法 |
| 6 | 用户取消操作 |
| 7 | 非交互模式下缺少有效 API key |

## User Flow

1. 解析 CLI 参数。
2. 校验 Node.js 版本，低于 22 直接退出。
3. 读取并校验 `example.config.json`，必须包含 `provider["volcengine-plan"].options.apiKey`。
4. 解析目标 OpenCode 配置路径。
5. 如果目标配置已存在，读取并剥除 UTF-8 BOM 后解析 JSON。
6. 检测 `opencode` 是否在 `PATH`。
7. 如果未检测到 OpenCode 且未传 `--skip-install`：
   - 检查 npm 是否可用。
   - 询问用户是否执行 `npm install -g opencode-ai`。
   - 用户确认后打印“正在安装 OpenCode，请稍候...”，并将 npm stdout/stderr 实时输出到当前终端。
   - 用户拒绝时打印手动安装命令，但继续写配置，因为写配置本身不依赖 OpenCode 可执行文件。
8. 获取 API key，优先级为：
   - `--api-key-env <NAME>` 指定的环境变量。
   - 默认环境变量 `ARK_API_KEY`。
   - 交互式隐藏输入。
9. 校验 API key：trim 后不能为空，不能包含 `<` 或 `>`，不能仍是 `<ARK_API_KEY>`。
10. 合并模板与用户已有配置。
11. 如果目标文件已存在，先创建同目录备份。
12. 原子写入目标配置文件。
13. 打印目标路径和备份路径，不打印 API key。

## Config Path Resolution

按以下顺序确定目标路径：

| 优先级 | 路径 |
|---|---|
| 1 | `--config-path <PATH>` |
| 2 | `$XDG_CONFIG_HOME/opencode/opencode.json` |
| 3 Windows | `%USERPROFILE%\.config\opencode\opencode.json` |
| 3 macOS / Linux | `~/.config/opencode/opencode.json` |

父目录不存在时使用 `fs.mkdirSync(dir, { recursive: true })` 创建。尊重 `XDG_CONFIG_HOME` 可以避免用户系统中出现两个不同位置的 OpenCode 配置。

## Merge Strategy

合并原则：用户已有配置优先，只强写脚本必须维护的 Volcengine provider 和本次输入的 API key。

| Key | 行为 |
|---|---|
| `$schema` | 用户已有则保留；否则使用模板值 |
| `provider` 中的其它 provider | 完整保留 |
| `provider["volcengine-plan"]` | 以模板为基准更新结构 |
| `provider["volcengine-plan"].options.apiKey` | 始终写入本次输入的 API key |
| `provider["volcengine-plan"]` 中模板未出现的扩展子键 | 保留 |
| 顶层 `model` | 用户已有则不动；没有时使用模板值 |
| 其它根级键，如 `theme`、`keybinds`、`agents`、`tools` | 一律保留 |

幂等性：重复运行只会刷新 `volcengine-plan` 的模板结构和 apiKey，并生成新的备份文件；其它配置保持稳定。

## Hidden Input

| 场景 | 行为 |
|---|---|
| TTY 输入 | 使用 `readline`，覆盖输出逻辑，使输入字符显示为 `*` 或不显示 |
| Windows 终端 | 尽量使用 raw mode，避免输入结束才回显的问题 |
| 非 TTY 输入 | 按行读取，不主动回显 |
| Ctrl+C | 恢复终端状态后退出，不写配置 |

## Backup And Atomic Write

| 步骤 | 行为 |
|---|---|
| 备份命名 | `opencode.json.bak-YYYYMMDD-HHMMSS`，与目标文件同目录 |
| 备份创建 | 使用排他复制；如果时间戳碰撞，追加 6 位随机串 |
| 临时文件 | 写到同目录 `opencode.json.<pid>.<random>.tmp` |
| 落盘 | 写入后 `fsyncSync`，再 `renameSync` 覆盖目标 |
| POSIX 权限 | 写入完成后 `chmod 0600` |
| 失败处理 | 删除临时文件，保留原配置不动 |

## Error Handling

| 失败 | 行为 | Exit |
|---|---|---|
| Node.js < 22 | 提示升级 Node.js 22+ | 2 |
| 需要安装 OpenCode 但 npm 缺失 | 提示安装 Node.js/npm | 2 |
| OpenCode 缺失且用户拒绝安装 | 打印手动命令，继续写配置 | 后续成功则 0 |
| OpenCode 安装失败 | 保留 npm 输出，提示手动运行 `npm install -g opencode-ai` | 3 |
| 模板文件缺失或非法 | 指出 `example.config.json` 问题 | 4 |
| 模板缺少 `provider["volcengine-plan"].options.apiKey` | 指出模板结构不支持 | 4 |
| 用户已有配置 JSON 非法 | 指出具体文件路径，要求用户先修复 | 5 |
| API key 为空、含 `< >` 或等于占位符 | 交互模式重新提示；非交互模式退出 | 7 |
| 用户 Ctrl+C | 恢复终端状态，不写配置 | 6 |
| 备份或写入失败 | 保留原文件，报告失败阶段 | 1 |

## Security Notes

- API key 不打印到 stdout 或 stderr。
- API key 不通过命令行参数传入，避免进入 shell history 或进程列表。
- `--dry-run` 输出中 apiKey 字段必须遮罩为 `***`。
- 不使用 `sudo`，不静默安装。
- 全局 npm 安装只在用户确认后执行，除非显式传入 `--yes`。
- 不读取或回显其它 provider 的密钥。
- 除用户确认的 npm install 外，不主动发起网络请求。

## Proposed Files

| File | Purpose |
|---|---|
| `setup-opencode.js` | 跨平台 Node.js 脚本，零依赖 |
| `example.config.json` | 现有 OpenCode Volcengine 模板 |
| `README.md` | 使用说明、CLI 参数、故障排查 |

## Verification Matrix

| 场景 | 期望 |
|---|---|
| 全新环境，无配置目录 | 创建目录并写入新配置 |
| 已有 `opencode.json` 仅含 `theme` | 保留 `theme`，新增 `volcengine-plan` |
| 已有其它 provider | 完整保留其它 provider |
| 已有 `volcengine-plan` 且 API key 不同 | 刷新 API key，创建备份 |
| 已有顶层 `model` | 不覆盖 |
| 配置文件含 UTF-8 BOM | 正常解析，写回时不带 BOM |
| 配置文件 JSON 非法 | exit 5，不写文件 |
| 模板文件缺失 | exit 4 |
| 模板缺关键字段 | exit 4 |
| Node 20 运行 | exit 2 |
| `--dry-run` | 不写文件，apiKey 遮罩 |
| `--non-interactive` 无环境变量 | exit 7 |
| `--non-interactive` + `ARK_API_KEY` | 成功且不提示输入 |
| Windows 隐藏输入 | 输入不明文回显 |
| 设置 `XDG_CONFIG_HOME` | 写入 `$XDG_CONFIG_HOME/opencode/opencode.json` |
| 指定 `--config-path` | 写入指定路径，便于测试 |

## Final Decisions

| 问题 | 决策 |
|---|---|
| 是否写入前展示 diff 并二次确认 | 暂不做；提供 `--dry-run` 供预览 |
| 是否保留用户自定义的 `volcengine-plan.models` | 模板中的 models 由模板控制；模板未覆盖的 provider 扩展子键保留 |
| 是否提供卸载或自动回滚脚本 | 暂不做；依赖备份文件手动回滚 |

