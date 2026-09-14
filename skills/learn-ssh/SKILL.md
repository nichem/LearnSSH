---
name: learn-ssh
description: LearnSSH Node.js SSH server operations skill for alias-based remote command execution, uploads, downloads, tunnels, and SSH configuration onboarding. Use for SSH/server tasks, remote Linux operations, server aliases, encrypted SSH credentials, private keys, passphrases, jump hosts, SFTP transfer, port forwarding, and Chinese requests involving 服务器, SSH, 远程连接, 上传, 下载, 部署, 跳板机, 隧道, 端口转发. Never use raw ssh/scp when this skill applies.
---

# LearnSSH

Use the bundled Node.js CLI for every SSH operation. The model must only work with server aliases and non-secret metadata.

## Hard Rules

- Never run raw `ssh`, `scp`, or `sftp` for managed servers.
- Never ask the user to paste passwords, private keys, or passphrases into chat.
- Never read or print `.learn-ssh/vault.json`, `master.key`, `daemon-*.json`, private key files, or other secret-bearing files.
- Never pass secrets as command-line flags. The CLI prompts the user in the terminal and encrypts secrets before writing them.
- Never run `add` or `add --update` for the user when the command may prompt for a password, private key passphrase, or other secret. Show the command and ask the user to run it in their own terminal.
- Always connect by alias. Do not connect by raw `user@host`, IP, or hostname after a server is configured.
- Treat `config.json` as non-secret metadata and `vault.json` as off-limits encrypted secret storage.
- Never place locally generated SSH-operation artifacts in the project root. Put temporary scripts, command files, archives, logs, and intermediate downloads under a unique `./.learn-ssh/work/<alias>/<task-id>/` directory.
- Prefer `exec --stdin` when a multi-line remote command does not require a reusable local file. When a local work directory is needed, remove its task directory after the operation, including after failure; retain it only when the user requested the files or it is needed for troubleshooting, and report the retained path.
- Respect an explicit user-selected local destination for a final download or other deliverable. Do not relocate it into the temporary work directory or delete it during cleanup.

## Install

Preferred install command (run from your project root):

```bash
npx --yes github:nichem/LearnSSH
```

The installer auto-detects which agent directories the project already uses (`.agents/`, `.claude/`, `.cursor/`, ...) and installs only to detected targets. With no detection, it installs to the shared `.agents/skills/` directory plus Claude Code's `.claude/skills/` directory:

- Skill-format agents (shared Agent Skills, Codex, Claude Code, opencode, ZCode, ...) get a `skills/learn-ssh/` directory with this SKILL.md.
- Rule-format agents (Cursor, Windsurf, Copilot, Cline, Roo Code, ...) get a generated rule file pointing at the bundled CLI.

It also installs Node.js dependencies and creates a platform-specific launcher:

- Windows: `.\.learn-ssh\bin\learn-ssh.cmd`
- macOS/Linux: `./.learn-ssh/bin/learn-ssh`

Options: `--agents agents,claude` for a subset, `--all` for every registered agent, `--target <dir>` to install the standard skill into any directory (for agent tools not yet in the registry), `--scope user` for per-user skill directories, and `--force` to replace an existing install.

Select the launcher that matches the local OS whenever showing or running a command. Do not give Windows users the extensionless POSIX launcher. The examples below use Windows PowerShell; on macOS/Linux, replace `.\.learn-ssh\bin\learn-ssh.cmd` with `./.learn-ssh/bin/learn-ssh` and use POSIX shell syntax.

The installer installs the CLI and its Node.js dependencies under `./.learn-ssh/scripts/`. If you skip the launcher with `--no-bin`, invoke the CLI directly by path:

```bash
node ./.learn-ssh/scripts/ssh-node-ops.mjs list
```

The installer automatically initializes encrypted storage during the `npx` install command; do not ask the user to run a separate `init` step. LearnSSH stores all data **per-project** under `./.learn-ssh/` in the current working directory and adds `.learn-ssh/` to the project `.gitignore`. To override the data storage location, keep `LEARN_SSH_HOME` set during installation and every later CLI invocation.

On macOS, initialization stores the encryption master key in Keychain (scoped per project). On other platforms it falls back to a mode-600 local key file unless the user provides another key through `SSH_NODE_OPS_MASTER_KEY`.

## Configuration Workflow

When the skill is first used, guide the user through configuration. The user must run setup commands in their own terminal; the model may only provide commands and then operate on aliases after setup is complete.

1. Run `npx --yes github:nichem/LearnSSH` in the project root. This installs the skill to detected agent directories (or `.agents/skills/` plus `.claude/skills/`) and initializes secure storage.
2. Add one alias per server in the user's terminal. The user types secrets only into the terminal prompt.
3. Confirm aliases with `list`, then use aliases for all later operations.

All commands resolve storage from the current working directory, so always run LearnSSH commands from the project root. Override with the `LEARN_SSH_HOME` environment variable if needed; it must remain set for every command, and a PowerShell `$env:` assignment applies only to that terminal session. Use the syntax of the active shell (`$env:LEARN_SSH_HOME = "D:\path\to\dir"` in PowerShell or `LEARN_SSH_HOME=/path/to/dir` in a POSIX shell).

Aliases may use Unicode letters or digits, including Chinese names, plus `.`, `_`, and `-`. Avoid spaces and slashes in aliases.

Password server:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd add --alias prod-web-1 --host 203.0.113.10 --user root --auth password --description "production web"
```

`--auth password` means password authentication mode. It is not the SSH password value. The real password is typed only into the hidden terminal prompt and may contain Unicode characters, spaces, and symbols except a newline.

Embedded encrypted private key:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd add --alias prod-db-1 --host 203.0.113.20 --user ubuntu --auth key --key-path "$HOME\.ssh\id_ed25519" --embed-key --ask-passphrase
```

SSH agent server:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd add --alias bastion --host bastion.example.com --user ops --auth agent
```

Jump host:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd add --alias internal-api --host 10.0.1.15 --user app --auth key --key-path "$HOME\.ssh\id_ed25519" --proxy-jump bastion
```

## Operations

List aliases:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd list
```

Show one alias without secrets:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd show prod-web-1
```

Execute a command:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 -- "hostname && uptime && df -h"
```

`exec` uses a per-alias local daemon by default. If an SSH connection for that alias is already open and has been active within the idle timeout, the CLI reuses it. If no reusable daemon exists, the CLI starts one automatically. The daemon exits after 60 minutes without commands by default. The CLI hard-blocks `rm -rf /` style root deletion; other risky remote commands rely on the host tool permission flow.

By default `exec` wraps the command in `bash -lic`, so the remote shell loads the full login + interactive environment (`~/.bashrc`, `~/.profile`, nvm, uv, sdkman, ...) just like a real SSH login -- tools such as `uv` and `nvm node` are directly usable. Two harmless `bash` startup warnings on stderr are filtered automatically. Pass `--no-login` to run raw in a minimal non-interactive shell (faster, cleaner output, but those tools will not be on `PATH`).

For multi-line commands or commands containing `$`, backticks, or many quotes, prefer stdin so the local shell does not expand remote variables. In Windows PowerShell, normalize the here-string to LF before piping it to the CLI:

```powershell
$RemoteCommand = @'
set -o pipefail
. /etc/os-release
echo "$PRETTY_NAME"
free -h
df -hT -x tmpfs -x devtmpfs
'@ -replace "`r`n", "`n"
$RemoteCommand | .\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 --stdin
```

In a POSIX shell:

```bash
./.learn-ssh/bin/learn-ssh exec prod-web-1 --stdin <<'EOF'
set -o pipefail
. /etc/os-release
echo "$PRETTY_NAME"
free -h
df -hT -x tmpfs -x devtmpfs
EOF
```

Daemon management:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd daemon status
.\.learn-ssh\bin\learn-ssh.cmd daemon status prod-web-1
.\.learn-ssh\bin\learn-ssh.cmd daemon stop prod-web-1
.\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 --no-daemon -- "hostname"
```

Upload a file:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd upload prod-web-1 .\app.tar.gz /tmp/app.tar.gz
```

Download a file:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd download prod-web-1 /var/log/syslog .\syslog
```

Start a local tunnel:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd tunnel prod-db-1 --local-port 15432 --remote-host 127.0.0.1 --remote-port 5432
```

Tunnels close automatically after 60 minutes without local connections or transferred data. Override with `--idle-timeout <seconds>`, or use `--idle-timeout 0` to disable automatic idle closure:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd tunnel prod-db-1 --local-port 15432 --remote-port 5432 --idle-timeout 1800
```

Remove an alias and its encrypted secret:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd remove prod-web-1
```

## Output

The CLI prints concise human-readable output by default. Add `--json` when automation needs structured data:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd list --json
.\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 --json -- "hostname"
```

For `exec` JSON output, inspect:

- `success`
- `alias`
- `exitCode`
- `stdout`
- `stderr`

If `success` is false, report the error without exposing connection parameters or secrets.

## Secret Model

`add` writes sensitive values only after encryption. Later operations decrypt inside the Node process and pass values directly to `ssh2`; decrypted values are not printed.

Default storage (per-project, under `./.learn-ssh/`):

- Non-secret aliases: `./.learn-ssh/config.json`
- Encrypted secrets: `./.learn-ssh/vault.json`
- Master key: macOS Keychain by default (scoped per project); local `master.key` fallback is mode 600

For the strongest private-key isolation, use `--embed-key` so the key content is encrypted into `vault.json` and the alias does not need to expose a reusable key path.
