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

Verify the plugin is installed by checking for the latest `src/index.js`:

```bash
ls -td ~/.claude/plugins/cache/claude-tokmon/claude-tokmon/*/src/index.js 2>/dev/null | head -1
```

If empty, the plugin is not installed. Ask the user to install via `/plugin install claude-tokmon` first.

## Step 3: Generate and Test Command

The statusLine command uses a simple glob to find the latest plugin version at runtime (survives plugin updates without config changes):

```
bash -c 'exec {RUNTIME_PATH} "$(ls -td ~/.claude/plugins/cache/claude-tokmon/claude-tokmon/*/src/index.js 2>/dev/null | head -1)"'
```

Replace `{RUNTIME_PATH}` with the detected Node.js absolute path from Step 1.

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
