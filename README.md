# LearnSSH

LearnSSH is a Codex skill for SSH-based server operations. It provides a bundled Node.js CLI for alias-based remote command execution, SFTP upload/download, local tunnels, jump hosts, and secure credential onboarding.

Read this in Chinese: [README_CN.md](README_CN.md)

## Features

- Manage SSH servers by alias instead of raw `user@host` strings.
- Store SSH passwords, private keys, and passphrases outside chat.
- Encrypt secrets per-project under `./.learn-ssh/`.
- Run remote commands with optional per-alias connection reuse.
- Upload and download files through SFTP.
- Start local SSH tunnels.
- Print concise human-readable output by default, or JSON with `--json`.
- Hard-block `rm -rf /` style root deletion before connecting.

## Install

Run from your project root:

```bash
npx --yes github:nichem/LearnSSH
```

This installs the skill into project-level directories for **Codex**, **Claude Code**, and **opencode**:
- `.codex/skills/learn-ssh/`
- `.claude/skills/learn-ssh/`
- `.opencode/skills/learn-ssh/`

A launcher is created at `./.learn-ssh/bin/learn-ssh`. Then restart your agent and use `$learn-ssh`.

To update an existing installation:

```bash
npx --yes github:nichem/LearnSSH --force
```

To install for a subset of agents:

```bash
npx --yes github:nichem/LearnSSH --agents codex,claude
```

## First-Time Setup

Initialize project-local encrypted storage (run from your project root):

```bash
./.learn-ssh/bin/learn-ssh init
```

This creates `./.learn-ssh/` in the current directory and automatically adds it to `.gitignore`. Override the storage location with `LEARN_SSH_HOME=/path/to/dir`.

Add a password-based server alias:

```bash
./.learn-ssh/bin/learn-ssh add \
  --alias prod-web-1 \
  --host 203.0.113.10 \
  --user root \
  --auth password
```

The real SSH password is typed only into the hidden terminal prompt. Do not pass secrets as command-line flags or paste them into chat.

Add a key-based server alias:

```bash
./.learn-ssh/bin/learn-ssh add \
  --alias prod-db-1 \
  --host 203.0.113.20 \
  --user ubuntu \
  --auth key \
  --key-path ~/.ssh/id_ed25519 \
  --embed-key \
  --ask-passphrase
```

## Common Commands

List aliases:

```bash
./.learn-ssh/bin/learn-ssh list
```

Show one alias without secrets:

```bash
./.learn-ssh/bin/learn-ssh show prod-web-1
```

Run a remote command:

```bash
./.learn-ssh/bin/learn-ssh exec prod-web-1 -- "hostname && uptime"
```

Get JSON output:

```bash
./.learn-ssh/bin/learn-ssh exec prod-web-1 --json -- "hostname"
```

Upload a file:

```bash
./.learn-ssh/bin/learn-ssh upload prod-web-1 ./app.tar.gz /tmp/app.tar.gz
```

Download a file:

```bash
./.learn-ssh/bin/learn-ssh download prod-web-1 /var/log/syslog ./syslog
```

Start a local tunnel:

```bash
./.learn-ssh/bin/learn-ssh tunnel prod-db-1 \
  --local-port 15432 \
  --remote-host 127.0.0.1 \
  --remote-port 5432
```

## Safety Model

LearnSSH deliberately does not implement a broad remote-command approval system. Risky command approval should come from the host tool layer, such as Codex or Claude CLI permissions.

The CLI still hard-blocks `rm -rf /` style root deletion locally before opening an SSH connection.

Secrets are not accepted as flags. Credentials are prompted in the terminal and encrypted before storage.

## Project Layout

```text
bin/install.mjs
package.json
skills/learn-ssh/
|-- SKILL.md
|-- agents/openai.yaml
`-- scripts/
    |-- package.json
    |-- package-lock.json
    `-- ssh-node-ops.mjs
```

## Validation

Validate the skill metadata:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/learn-ssh
```

Check the CLI syntax:

```bash
node --check skills/learn-ssh/scripts/ssh-node-ops.mjs
```

## Packaging

Preview the npm package contents:

```bash
npm pack --dry-run
```

## Friendly Links

- [LINUX DO](https://linux.do/) - A new ideal community and gathering place for technology enthusiasts.

## License

MIT License. See [LICENSE](LICENSE).
