# OpenCode Volcengine Ark Setup

这个仓库提供两种初始化方式，用于把火山方舟 OpenCode 配置合并到用户本机配置。

| 方式 | 适合人群 | 依赖 |
|---|---|---|
| Go 二进制 `ark-opencode-setup` | Go 后端、无需 Node 的用户 | 无运行时依赖 |
| Node 脚本 `setup-opencode.js` | 已有 Node 22+ 环境的用户 | Node.js 22+ |

## 推荐：Go 二进制

Go 版会把模板内嵌进二进制，用户下载后直接运行，不需要 Node/npm。

本地构建：

```bash
go build -o ark-opencode-setup ./cmd/ark-opencode-setup
```

Windows:

```powershell
go build -o ark-opencode-setup.exe ./cmd/ark-opencode-setup
$env:ARK_API_KEY="your_api_key"
.\ark-opencode-setup.exe --non-interactive
```

macOS / Linux:

```bash
go build -o ark-opencode-setup ./cmd/ark-opencode-setup
ARK_API_KEY=your_api_key ./ark-opencode-setup --non-interactive
```

预览写入内容：

```bash
ARK_API_KEY=your_api_key ./ark-opencode-setup --dry-run
```

发布时可以交叉编译：

```bash
GOOS=windows GOARCH=amd64 go build -o dist/ark-opencode-setup-windows-amd64.exe ./cmd/ark-opencode-setup
GOOS=darwin GOARCH=arm64 go build -o dist/ark-opencode-setup-darwin-arm64 ./cmd/ark-opencode-setup
GOOS=darwin GOARCH=amd64 go build -o dist/ark-opencode-setup-darwin-amd64 ./cmd/ark-opencode-setup
GOOS=linux GOARCH=amd64 go build -o dist/ark-opencode-setup-linux-amd64 ./cmd/ark-opencode-setup
```

OpenCode 未安装时，Go 版不会自动安装，只会写配置并提示对应系统的安装方式。

## Node 脚本

也可以直接从 GitHub Release 下载并执行最新版 `index.js`：

```bash
curl -fsSL https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -o /tmp/ark-opencode-setup.js && node /tmp/ark-opencode-setup.js
```

Windows PowerShell:

```powershell
iwr https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -OutFile $env:TEMP\ark-opencode-setup.js
node $env:TEMP\ark-opencode-setup.js
```

这种方式要求用户本机已安装 Node.js 22+。

## 使用方式

要求 Node.js 22 或更高版本。

```bash
node setup-opencode.js
```

脚本会：

1. 检查 Node.js 版本。
2. 检测 OpenCode 是否已安装。
3. 如果未安装 OpenCode，询问是否执行 `npm install -g opencode-ai`，并实时显示 npm 输出。
4. 隐藏输入火山订阅专属 API key。
5. 合并写入 OpenCode 配置。

## 非交互运行

```bash
ARK_API_KEY=your_api_key node setup-opencode.js --non-interactive
```

Windows PowerShell:

```powershell
$env:ARK_API_KEY="your_api_key"
node setup-opencode.js --non-interactive
```

## 预览配置

```bash
ARK_API_KEY=your_api_key node setup-opencode.js --dry-run
```

`--dry-run` 不会写入文件，也不会安装 OpenCode；输出里的 `apiKey` 会显示为 `***`。

## 写入路径

默认写入：

| 平台 | 路径 |
|---|---|
| Windows | `%USERPROFILE%\.config\opencode\opencode.json` |
| macOS / Linux | `~/.config/opencode/opencode.json` |

如果设置了 `XDG_CONFIG_HOME`，会优先写入：

```text
$XDG_CONFIG_HOME/opencode/opencode.json
```

也可以显式指定：

```bash
node setup-opencode.js --config-path ./tmp/opencode.json
```

## 保护已有配置

脚本会读取已有 `opencode.json` 并合并配置：

- 保留其它 provider。
- 保留已有顶层 `model`。
- 保留主题、快捷键、工具等其它设置。
- 更新或新增 `provider["volcengine-plan"]`。
- 始终把本次输入的 API key 写入 `provider["volcengine-plan"].options.apiKey`。

目标文件已存在时，会先创建同目录备份：

```text
opencode.json.bak-YYYYMMDDTHHMMSS
```

## 常用参数

| 参数 | 说明 |
|---|---|
| `--yes`, `-y` | OpenCode 未安装时自动确认安装 |
| `--skip-install` | 不安装 OpenCode，仅写配置 |
| `--non-interactive` | 禁止交互，API key 必须来自环境变量 |
| `--api-key-env NAME` | 从指定环境变量读取 API key |
| `--dry-run` | 只预览配置，不写文件 |
| `--config-path PATH` | 指定配置写入路径 |
| `--verbose` | 输出调试日志 |
| `--quiet` | 成功时只输出配置路径 |

## 权限说明

脚本不会自动使用 `sudo`，也不会静默提权。如果 `npm install -g opencode-ai` 因权限失败，请使用管理员终端、修正 npm 全局目录权限，或使用 nvm/fnm/volta 这类用户级 Node 管理工具。
