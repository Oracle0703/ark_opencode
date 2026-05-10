package setup

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func templateConfig(t *testing.T) map[string]any {
	t.Helper()
	var cfg map[string]any
	raw := []byte(`{
	  "$schema": "https://opencode.ai/config.json",
	  "model": "volcengine-plan/ark-code-latest",
	  "provider": {
	    "volcengine-plan": {
	      "npm": "@ai-sdk/openai-compatible",
	      "name": "Volcano Engine",
	      "options": {
	        "baseURL": "https://example.test",
	        "apiKey": "<ARK_API_KEY>"
	      },
	      "models": {
	        "ark-code-latest": { "name": "ark-code-latest" }
	      }
	    }
	  }
	}`)
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestValidateAPIKey(t *testing.T) {
	if got := ValidateAPIKey("  valid-key-123  "); got != nil {
		t.Fatalf("expected valid key, got %v", got)
	}
	for _, key := range []string{"", "abc", "<ARK_API_KEY>", "abc<defghi"} {
		if got := ValidateAPIKey(key); got == nil {
			t.Fatalf("expected invalid key %q", key)
		}
	}
}

func TestMergeConfigPreservesExistingSettings(t *testing.T) {
	existing := map[string]any{
		"model": "anthropic/claude",
		"theme": "dark",
		"provider": map[string]any{
			"anthropic": map[string]any{
				"options": map[string]any{"apiKey": "keep-secret"},
			},
			"volcengine-plan": map[string]any{
				"options":  map[string]any{"apiKey": "old", "customOption": true},
				"extraRoot": "keep",
			},
		},
	}

	merged, err := MergeConfig(existing, templateConfig(t), "new-secret-key")
	if err != nil {
		t.Fatal(err)
	}

	if merged["model"] != "anthropic/claude" {
		t.Fatalf("model was overwritten: %v", merged["model"])
	}
	if merged["theme"] != "dark" {
		t.Fatalf("theme was not preserved")
	}
	provider := merged["provider"].(map[string]any)
	anthropic := provider["anthropic"].(map[string]any)
	if anthropic["options"].(map[string]any)["apiKey"] != "keep-secret" {
		t.Fatalf("other provider secret was changed")
	}
	volc := provider["volcengine-plan"].(map[string]any)
	options := volc["options"].(map[string]any)
	if options["apiKey"] != "new-secret-key" {
		t.Fatalf("api key not updated: %v", options["apiKey"])
	}
	if options["customOption"] != true {
		t.Fatalf("custom option was not preserved")
	}
	if volc["extraRoot"] != "keep" {
		t.Fatalf("extra root field was not preserved")
	}
}

func TestMaskAPIKeyDoesNotMutateInput(t *testing.T) {
	cfg := map[string]any{
		"provider": map[string]any{
			"volcengine-plan": map[string]any{
				"options": map[string]any{"apiKey": "secret"},
			},
		},
	}
	masked, err := MaskAPIKey(cfg)
	if err != nil {
		t.Fatal(err)
	}
	got := masked["provider"].(map[string]any)["volcengine-plan"].(map[string]any)["options"].(map[string]any)["apiKey"]
	if got != "***" {
		t.Fatalf("expected masked key, got %v", got)
	}
	original := cfg["provider"].(map[string]any)["volcengine-plan"].(map[string]any)["options"].(map[string]any)["apiKey"]
	if original != "secret" {
		t.Fatalf("input mutated")
	}
}

func TestLoadExistingConfigHandlesEmptyAndBOM(t *testing.T) {
	dir := t.TempDir()
	empty := filepath.Join(dir, "empty.json")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadExistingConfig(empty)
	if err != nil {
		t.Fatal(err)
	}
	if cfg != nil {
		t.Fatalf("expected nil for empty config")
	}

	bom := filepath.Join(dir, "bom.json")
	if err := os.WriteFile(bom, append([]byte{0xEF, 0xBB, 0xBF}, []byte(`{"theme":"dark"}`)...), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err = LoadExistingConfig(bom)
	if err != nil {
		t.Fatal(err)
	}
	if cfg["theme"] != "dark" {
		t.Fatalf("BOM config not parsed")
	}
}

func TestBackupAndAtomicWrite(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "opencode.json")
	if err := os.WriteFile(target, []byte(`{"theme":"dark"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	backup, err := BackupExisting(target)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(backup) != dir {
		t.Fatalf("backup in wrong dir: %s", backup)
	}
	if !strings.Contains(filepath.Base(backup), "opencode.json.bak-") {
		t.Fatalf("unexpected backup name: %s", backup)
	}
	if err := AtomicWrite(target, []byte(`{"ok":true}`+"\n")); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"ok":true}`+"\n" {
		t.Fatalf("unexpected target content: %q", raw)
	}
	matches, err := filepath.Glob(filepath.Join(dir, "*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temp files left behind: %v", matches)
	}
}

func TestResolveConfigPath(t *testing.T) {
	dir := t.TempDir()
	target, err := ResolveConfigPath(Options{ConfigPath: filepath.Join(dir, "opencode.json")})
	if err != nil {
		t.Fatal(err)
	}
	if target.Target != filepath.Join(dir, "opencode.json") {
		t.Fatalf("unexpected target: %s", target.Target)
	}
}

