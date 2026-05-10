package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"ark-opencode-setup/internal/setup"
)

//go:embed example.config.json
var embedded embed.FS

const version = "0.1.0"

func main() {
	code := run()
	os.Exit(code)
}

func run() int {
	var (
		configPath     string
		apiKeyEnv      string
		nonInteractive bool
		dryRun         bool
		quiet          bool
		showVersion    bool
	)
	flag.StringVar(&configPath, "config-path", "", "覆盖 OpenCode 配置写入路径")
	flag.StringVar(&apiKeyEnv, "api-key-env", "ARK_API_KEY", "从指定环境变量读取 API key")
	flag.BoolVar(&nonInteractive, "non-interactive", false, "禁止交互，API key 必须来自环境变量")
	flag.BoolVar(&dryRun, "dry-run", false, "打印遮罩后的配置，不写入文件")
	flag.BoolVar(&quiet, "quiet", false, "成功时只输出配置路径")
	flag.BoolVar(&showVersion, "version", false, "打印版本")
	flag.Parse()

	if showVersion {
		fmt.Println(version)
		return 0
	}

	template, err := loadTemplate()
	if err != nil {
		errf("模板错误：%v\n", err)
		return 4
	}

	target, err := setup.ResolveConfigPath(setup.Options{ConfigPath: configPath})
	if err != nil {
		errf("解析配置路径失败：%v\n", err)
		return 1
	}

	apiKey, err := resolveAPIKey(apiKeyEnv, nonInteractive)
	if err != nil {
		errf("%v\n", err)
		return 7
	}

	existing, err := setup.LoadExistingConfig(target.Real)
	if err != nil {
		errf("用户已有配置不是合法 JSON：%s\n", setup.SanitizePathForLog(target.Real))
		return 5
	}

	merged, err := setup.MergeConfig(existing, template, apiKey)
	if err != nil {
		errf("合并配置失败：%v\n", err)
		return 4
	}

	if dryRun {
		masked, err := setup.MaskAPIKey(merged)
		if err != nil {
			errf("遮罩配置失败：%v\n", err)
			return 1
		}
		raw, err := setup.Serialize(masked)
		if err != nil {
			errf("序列化配置失败：%v\n", err)
			return 1
		}
		fmt.Print(string(raw))
		return 0
	}

	backup := ""
	if target.Exists {
		if info, statErr := os.Stat(target.Real); statErr == nil && info.Size() > 0 {
			backup, err = setup.BackupExisting(target.Real)
			if err != nil {
				errf("创建备份失败：%v\n", err)
				return 1
			}
		}
	}

	raw, err := setup.Serialize(merged)
	if err != nil {
		errf("序列化配置失败：%v\n", err)
		return 1
	}
	if err := setup.AtomicWrite(target.Real, raw); err != nil {
		errf("写入配置失败：%v\n", err)
		return 1
	}

	if !quiet {
		if _, err := exec.LookPath("opencode"); err != nil {
			errf("未检测到 OpenCode。配置已写入，可稍后安装 OpenCode。\n%s\n", installHint())
		}
		errf("配置已写入：%s\n", setup.SanitizePathForLog(target.Target))
		if backup != "" {
			errf("已创建备份：%s\n", setup.SanitizePathForLog(backup))
		}
	}
	fmt.Println(target.Target)
	return 0
}

func loadTemplate() (map[string]any, error) {
	raw, err := embedded.ReadFile("example.config.json")
	if err != nil {
		return nil, err
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	if err := setup.ValidateTemplate(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func resolveAPIKey(envName string, nonInteractive bool) (string, error) {
	if value := os.Getenv(envName); value != "" {
		return setup.NormalizeAPIKey(value)
	}
	if nonInteractive {
		return "", fmt.Errorf("非交互模式需要通过 %s 提供 API key", envName)
	}
	fmt.Fprint(os.Stderr, "请输入你的火山订阅专属 API key：")
	reader := bufio.NewReader(os.Stdin)
	value, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return setup.NormalizeAPIKey(value)
}

func installHint() string {
	switch runtime.GOOS {
	case "windows":
		return "Windows 可使用：scoop install opencode，或 choco install opencode，或前往 https://opencode.ai/download 下载。"
	case "darwin":
		return "macOS 可使用：curl -fsSL https://opencode.ai/install | bash，或 brew install anomalyco/tap/opencode。"
	default:
		return "Linux 可使用：curl -fsSL https://opencode.ai/install | bash。"
	}
}

func errf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, strings.TrimRight(format, "\n")+"\n", args...)
}

