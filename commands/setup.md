---
description: Configure claude-tokmon as your statusline
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

## Step 1: Detect Runtime

Detect Node.js runtime path:

```bash
command -v node 2>/dev/null
```

If empty, ask the user to install Node.js LTS from https://nodejs.org/ and restart their shell.

## Step 2: Find Plugin Path

**macOS/Linux**:
```bash
ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-tokmon/*/ 2>/dev/null | awk -F/ '{ print $(NF-1) "\t" $(0) }' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-
```

If empty, the plugin is not installed. Ask the user to install via `/plugin install claude-tokmon` first.

## Step 3: Generate and Test Command

Generate the statusLine command:

```
bash -c 'plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-tokmon/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | grep -E '"'"'^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "{RUNTIME_PATH}" "${plugin_dir}src/index.js"'
```

Replace `{RUNTIME_PATH}` with the detected Node.js absolute path.

Test the command - it should produce multi-line output within a few seconds:
```bash
echo '{"model":{"id":"test"},"context_window":{"used_percentage":42},"workspace":{"current_dir":"/tmp"}}' | {GENERATED_COMMAND}
```

If it errors, do not proceed.

## Step 4: Apply Configuration

Read `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`, merge in the statusLine config preserving all existing settings:

```json
{
  "statusLine": {
    "type": "command",
    "command": "{GENERATED_COMMAND}"
  }
}
```

If the file doesn't exist, create it. If it contains invalid JSON, report the error and do not overwrite.

After writing, tell the user:

> Config written. **Please restart Claude Code now** — quit and run `claude` again in your terminal.

## Step 5: Verify

Ask the user if the statusline is working after restart.

If not working:
1. Verify settings.json was written correctly
2. Test the command manually with error output
3. Check that Node.js is accessible: `ls -la {RUNTIME_PATH}`
