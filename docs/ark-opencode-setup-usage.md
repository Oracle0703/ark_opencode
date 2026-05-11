# Ark OpenCode 配置工具使用说明

这份文档用于帮助你快速配置 OpenCode 的火山方舟模型。

你只需要复制对应系统的命令到终端里运行，然后按提示输入你的火山订阅专属 API key。

## 运行前需要准备

请先确认电脑已经安装：

| 工具 | 要求 |
|---|---|
| Node.js | 版本需要 22 或更高 |
| OpenCode | 可以已安装；如果没有，脚本会提示安装 |

检查 Node.js 版本：

```bash
node -v
```

如果显示类似下面这样，就可以继续：

```text
v22.22.0
```

如果版本低于 22，请先升级 Node.js。

## macOS / Linux 使用方式

打开终端，复制下面命令运行：

```bash
curl -fsSL https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -o /tmp/ark-opencode-setup.js && node /tmp/ark-opencode-setup.js
```

如果你只想写入配置，不想让脚本自动安装 OpenCode，可以运行：

```bash
curl -fsSL https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -o /tmp/ark-opencode-setup.js && node /tmp/ark-opencode-setup.js --skip-install
```

## Windows 使用方式

打开 PowerShell，复制下面命令运行：

```powershell
iwr https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -OutFile $env:TEMP\ark-opencode-setup.js; node $env:TEMP\ark-opencode-setup.js
```

如果你只想写入配置，不想让脚本自动安装 OpenCode，可以运行：

```powershell
iwr https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -OutFile $env:TEMP\ark-opencode-setup.js; node $env:TEMP\ark-opencode-setup.js --skip-install
```

## 运行后会发生什么

脚本运行后，会提示你输入火山订阅专属 API key：

```text
请输入你的火山订阅专属 API key。
安全提示：输入内容不会显示在终端中，这是正常现象。
粘贴或输入完成后，请按回车继续。
API key：
```

这里是隐藏输入，你粘贴或输入 API key 时，终端不会显示任何字符。

这是正常现象。

输入完成后，直接按回车。

## 配置会写到哪里

| 系统 | 配置文件路径 |
|---|---|
| Windows | `C:\Users\你的用户名\.config\opencode\opencode.json` |
| macOS / Linux | `~/.config/opencode/opencode.json` |

如果你之前已经有 OpenCode 配置，脚本不会直接覆盖全部内容。

它会先创建备份文件，然后只新增或更新火山方舟相关配置。

## 常见问题

| 问题 | 处理方式 |
|---|---|
| 运行后提示 Node.js 版本太低 | 安装或升级到 Node.js 22+ |
| 输入 API key 时看不到字符 | 正常现象，输入被隐藏了，粘贴后按回车即可 |
| 没有安装 OpenCode | 可以让脚本自动安装，或者使用带 `--skip-install` 的命令只写配置 |
| npm 安装失败 | 可能是网络、权限或代理问题；可以先手动安装 OpenCode 后再运行带 `--skip-install` 的命令 |
| 担心覆盖已有配置 | 脚本会先备份，再合并配置，不会删除其它 provider |

## 推荐给内部用户的命令

如果你不确定用户电脑权限是否允许自动安装 OpenCode，建议统一发这个版本。

Windows PowerShell：

```powershell
iwr https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -OutFile $env:TEMP\ark-opencode-setup.js; node $env:TEMP\ark-opencode-setup.js --skip-install
```

macOS / Linux：

```bash
curl -fsSL https://github.com/Oracle0703/ark_opencode/releases/latest/download/index.js -o /tmp/ark-opencode-setup.js && node /tmp/ark-opencode-setup.js --skip-install
```

