---
name: learn-ssh
description: LearnSSH Node.js SSH server operations skill for alias-based remote command execution, uploads, downloads, tunnels, and SSH configuration onboarding. Use for SSH/server tasks, remote Linux operations, server aliases, encrypted SSH credentials, private keys, passphrases, jump hosts, SFTP transfer, port forwarding, and Chinese requests involving 服务器, SSH, 远程连接, 上传, 下载, 部署, 跳板机, 隧道, 端口转发. Never use raw ssh/scp when this skill applies.
---

# LearnSSH

Use the bundled Node.js CLI for every SSH operation. The model must only work with server aliases and non-secret metadata.

## Hard Rules

- Never run raw `ssh`, `scp`, or `sftp` for managed servers.
- Never ask the user to paste passwords, private keys, or passphrases into chat.
- Never read or print `~/.codex/ssh-node-ops/vault.json`, `master.key`, `daemon-*.json`, private key files, or other secret-bearing files.
- Never pass secrets as command-line flags. The CLI prompts the user in the terminal and encrypts secrets before writing them.
- Never run `init`, `add`, or `add --update` for the user when the command may prompt for a password, private key passphrase, or other secret. Show the command and ask the user to run it in their own terminal.
- Always connect by alias. Do not connect by raw `user@host`, IP, or hostname after a server is configured.
- Treat `config.json` as non-secret metadata and `vault.json` as off-limits encrypted secret storage.

## Install

From this skill directory:

```bash
npm install --prefix scripts
node scripts/ssh-node-ops.mjs init
```

On macOS, `init` stores the encryption master key in Keychain. On other platforms it falls back to a mode-600 local key file unless the user provides another key through `SSH_NODE_OPS_MASTER_KEY`.

## Configuration Workflow

When the skill is first used, guide the user through configuration. The user must run setup commands in their own terminal; the model may only provide commands and then operate on aliases after setup is complete.

1. Install dependencies with `npm install --prefix <skill>/scripts`.
2. Initialize secure storage with `node <skill>/scripts/ssh-node-ops.mjs init`.
3. Add one alias per server in the user's terminal. The user types secrets only into the terminal prompt.
4. Confirm aliases with `list`, then use aliases for all later operations.

Aliases may use Unicode letters or digits, including Chinese names, plus `.`, `_`, and `-`. Avoid spaces and slashes in aliases.

Password server:

```bash
node scripts/ssh-node-ops.mjs add --alias prod-web-1 --host 203.0.113.10 --user root --auth password --description "production web"
```

`--auth password` means password authentication mode. It is not the SSH password value. The real password is typed only into the hidden terminal prompt and may contain Unicode characters, spaces, and symbols except a newline.

Embedded encrypted private key:

```bash
node scripts/ssh-node-ops.mjs add --alias prod-db-1 --host 203.0.113.20 --user ubuntu --auth key --key-path ~/.ssh/id_ed25519 --embed-key --ask-passphrase
```

SSH agent server:

```bash
node scripts/ssh-node-ops.mjs add --alias bastion --host bastion.example.com --user ops --auth agent
```

Jump host:

```bash
node scripts/ssh-node-ops.mjs add --alias internal-api --host 10.0.1.15 --user app --auth key --key-path ~/.ssh/id_ed25519 --proxy-jump bastion
```

## Operations

List aliases:

```bash
node scripts/ssh-node-ops.mjs list
```

Show one alias without secrets:

```bash
node scripts/ssh-node-ops.mjs show prod-web-1
```

Execute a command:

```bash
node scripts/ssh-node-ops.mjs exec prod-web-1 -- "hostname && uptime && df -h"
```

`exec` uses a per-alias local daemon by default. If an SSH connection for that alias is already open and has been active within the idle timeout, the CLI reuses it. If no reusable daemon exists, the CLI starts one automatically. The daemon exits after 60 minutes without commands by default. The CLI hard-blocks `rm -rf /` style root deletion; other risky remote commands rely on the host tool permission flow.

For multi-line commands or commands containing `$`, backticks, or many quotes, prefer stdin so the local shell does not expand remote variables:

```bash
node scripts/ssh-node-ops.mjs exec prod-web-1 --stdin <<'EOF'
set -o pipefail
. /etc/os-release
echo "$PRETTY_NAME"
free -h
df -hT -x tmpfs -x devtmpfs
EOF
```

Daemon management:

```bash
node scripts/ssh-node-ops.mjs daemon status
node scripts/ssh-node-ops.mjs daemon status prod-web-1
node scripts/ssh-node-ops.mjs daemon stop prod-web-1
node scripts/ssh-node-ops.mjs exec prod-web-1 --no-daemon -- "hostname"
```

Upload a file:

```bash
node scripts/ssh-node-ops.mjs upload prod-web-1 ./app.tar.gz /tmp/app.tar.gz
```

Download a file:

```bash
node scripts/ssh-node-ops.mjs download prod-web-1 /var/log/syslog ./syslog
```

Start a local tunnel:

```bash
node scripts/ssh-node-ops.mjs tunnel prod-db-1 --local-port 15432 --remote-host 127.0.0.1 --remote-port 5432
```

Tunnels close automatically after 60 minutes without local connections or transferred data. Override with `--idle-timeout <seconds>`, or use `--idle-timeout 0` to disable automatic idle closure:

```bash
node scripts/ssh-node-ops.mjs tunnel prod-db-1 --local-port 15432 --remote-port 5432 --idle-timeout 1800
```

Remove an alias and its encrypted secret:

```bash
node scripts/ssh-node-ops.mjs remove prod-web-1
```

## Output

The CLI prints concise human-readable output by default. Add `--json` when automation needs structured data:

```bash
node scripts/ssh-node-ops.mjs list --json
node scripts/ssh-node-ops.mjs exec prod-web-1 --json -- "hostname"
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

Default storage:

- Non-secret aliases: `~/.codex/ssh-node-ops/config.json`
- Encrypted secrets: `~/.codex/ssh-node-ops/vault.json`
- Master key: macOS Keychain by default; local `master.key` fallback is mode 600

For the strongest private-key isolation, use `--embed-key` so the key content is encrypted into `vault.json` and the alias does not need to expose a reusable key path.
