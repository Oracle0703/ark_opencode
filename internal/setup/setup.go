package setup

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Options struct {
	ConfigPath string
}

type TargetPath struct {
	Target    string
	Real      string
	Exists    bool
	IsSymlink bool
}

func ValidateAPIKey(value string) error {
	key := strings.TrimSpace(value)
	if key == "" {
		return errors.New("API key 不能为空")
	}
	if strings.ContainsAny(key, "<>") {
		return errors.New("API key 不能包含尖括号")
	}
	if key == "<ARK_API_KEY>" {
		return errors.New("API key 不能是模板占位符")
	}
	if len(key) < 8 {
		return errors.New("API key 长度过短")
	}
	return nil
}

func NormalizeAPIKey(value string) (string, error) {
	key := strings.TrimSpace(value)
	if err := ValidateAPIKey(key); err != nil {
		return "", err
	}
	return key, nil
}

func ParseJSON(raw []byte) (map[string]any, error) {
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func ValidateTemplate(template map[string]any) error {
	provider, ok := asMap(template["provider"])
	if !ok {
		return errors.New(`模板缺少 provider`)
	}
	volc, ok := asMap(provider["volcengine-plan"])
	if !ok {
		return errors.New(`模板缺少 provider["volcengine-plan"]`)
	}
	options, ok := asMap(volc["options"])
	if !ok {
		return errors.New(`模板缺少 provider["volcengine-plan"].options`)
	}
	if _, ok := options["apiKey"].(string); !ok {
		return errors.New(`模板缺少 provider["volcengine-plan"].options.apiKey`)
	}
	return nil
}

func MergeConfig(existing map[string]any, template map[string]any, apiKey string) (map[string]any, error) {
	if err := ValidateTemplate(template); err != nil {
		return nil, err
	}
	if existing == nil {
		existing = map[string]any{}
	}

	templateProvider, _ := asMap(template["provider"])
	templateVolc, _ := asMap(templateProvider["volcengine-plan"])
	templateOptions, _ := asMap(templateVolc["options"])
	existingProvider, _ := asMap(existing["provider"])
	existingVolc, _ := asMap(existingProvider["volcengine-plan"])
	existingOptions, _ := asMap(existingVolc["options"])

	provider := map[string]any{}
	for key, value := range existingProvider {
		if key != "volcengine-plan" {
			provider[key] = clone(value)
		}
	}

	volc := map[string]any{
		"npm":     clone(templateVolc["npm"]),
		"name":    clone(templateVolc["name"]),
		"options": map[string]any{},
		"models":  clone(templateVolc["models"]),
	}
	options := volc["options"].(map[string]any)
	for key, value := range templateOptions {
		options[key] = clone(value)
	}
	for key, value := range existingOptions {
		if _, exists := templateOptions[key]; !exists {
			options[key] = clone(value)
		}
	}
	options["apiKey"] = apiKey

	for key, value := range existingVolc {
		if _, exists := volc[key]; !exists {
			volc[key] = clone(value)
		}
	}
	provider["volcengine-plan"] = volc

	result := map[string]any{}
	for key, value := range existing {
		switch key {
		case "provider":
			result[key] = provider
		case "model":
			if model, ok := value.(string); ok && model != "" {
				result[key] = model
			} else {
				result[key] = clone(template["model"])
			}
		default:
			result[key] = clone(value)
		}
	}
	if _, ok := result["$schema"]; !ok {
		if schema, ok := template["$schema"]; ok {
			result["$schema"] = clone(schema)
		}
	}
	if model, ok := result["model"].(string); !ok || model == "" {
		result["model"] = clone(template["model"])
	}
	if _, ok := result["provider"]; !ok {
		result["provider"] = provider
	}
	return result, nil
}

func MaskAPIKey(config map[string]any) (map[string]any, error) {
	cloned, ok := clone(config).(map[string]any)
	if !ok {
		return nil, errors.New("config must be object")
	}
	provider, ok := asMap(cloned["provider"])
	if !ok {
		return cloned, nil
	}
	volc, ok := asMap(provider["volcengine-plan"])
	if !ok {
		return cloned, nil
	}
	options, ok := asMap(volc["options"])
	if !ok {
		return cloned, nil
	}
	if _, exists := options["apiKey"]; exists {
		options["apiKey"] = "***"
	}
	return cloned, nil
}

func Serialize(config map[string]any) ([]byte, error) {
	raw, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func LoadExistingConfig(target string) (map[string]any, error) {
	info, err := os.Stat(target)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	if info.Size() == 0 {
		return nil, nil
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	return ParseJSON(raw)
}

func ResolveConfigPath(opts Options) (TargetPath, error) {
	var target string
	if opts.ConfigPath != "" {
		abs, err := filepath.Abs(opts.ConfigPath)
		if err != nil {
			return TargetPath{}, err
		}
		target = abs
	} else if xdg := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); xdg != "" {
		target = filepath.Join(xdg, "opencode", "opencode.json")
	} else if runtime.GOOS == "windows" {
		home := os.Getenv("USERPROFILE")
		if home == "" {
			var err error
			home, err = os.UserHomeDir()
			if err != nil {
				return TargetPath{}, err
			}
		}
		target = filepath.Join(home, ".config", "opencode", "opencode.json")
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return TargetPath{}, err
		}
		target = filepath.Join(home, ".config", "opencode", "opencode.json")
	}

	t := TargetPath{Target: target, Real: target}
	info, err := os.Lstat(target)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return t, nil
		}
		return TargetPath{}, err
	}
	t.Exists = true
	t.IsSymlink = info.Mode()&os.ModeSymlink != 0
	if t.IsSymlink {
		real, err := filepath.EvalSymlinks(target)
		if err != nil {
			return TargetPath{}, err
		}
		t.Real = real
	}
	return t, nil
}

func BackupExisting(target string) (string, error) {
	base := filepath.Base(target)
	dir := filepath.Dir(target)
	name := fmt.Sprintf("%s.bak-%s", base, time.Now().Format("20060102T150405"))
	backup := filepath.Join(dir, name)
	if err := copyFileExclusive(target, backup); err == nil {
		return backup, nil
	} else if !errors.Is(err, fs.ErrExist) {
		return "", err
	}
	backup = filepath.Join(dir, fmt.Sprintf("%s-%s", name, randHex(3)))
	if err := copyFileExclusive(target, backup); err != nil {
		return "", err
	}
	return backup, nil
}

func AtomicWrite(target string, content []byte) error {
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp := filepath.Join(dir, fmt.Sprintf("%s.%d.%s.tmp", filepath.Base(target), os.Getpid(), randHex(4)))
	file, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmp)
		}
	}()
	if _, err := file.Write(content); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, target); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		_ = os.Chmod(target, 0o600)
	}
	cleanup = false
	return nil
}

func SanitizePathForLog(value string) string {
	normalized := filepath.Clean(value)
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, normalized)
}

func copyFileExclusive(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := out.ReadFrom(in); err != nil {
		return err
	}
	return out.Sync()
}

func randHex(size int) string {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func asMap(value any) (map[string]any, bool) {
	m, ok := value.(map[string]any)
	return m, ok
}

func clone(value any) any {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

