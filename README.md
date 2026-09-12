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

The installer auto-detects which agent directories the project already uses (`.agents/`, `.claude/`, `.cursor/`, ...) and installs only to detected targets. With no detection, it installs to both the shared `.agents/skills/` directory and Claude Code's `.claude/skills/` directory. This gives Codex and other tools that support the open Agent Skills location one shared copy while retaining Claude Code compatibility.

Supported agents are defined in the `agents.json` registry:

| Agent | Format | Location |
|-------|--------|----------|
| Agent Skills (shared) | skill | `.agents/skills/learn-ssh/` |
| Codex | skill | `.codex/skills/learn-ssh/` |
| Claude Code | skill | `.claude/skills/learn-ssh/` |
| opencode | skill | `.opencode/skills/learn-ssh/` |
| ZCode | skill | `.zcode/skills/learn-ssh/` |
| Cursor | rule | `.cursor/rules/learn-ssh.mdc` |
| Windsurf | rule | `.windsurf/rules/learn-ssh.md` |
| GitHub Copilot | rule | `.github/instructions/learn-ssh.instructions.md` |
| Cline | rule | `.clinerules/learn-ssh.md` |
| Roo Code | rule | `.roo/rules/learn-ssh.md` |

Skill-format agents get the standard `SKILL.md` directory. Rule-format agents get a small generated rule file (description + hard rules + CLI cheatsheet) pointing at the bundled CLI.

The installer creates a platform-specific launcher:

- Windows: `.\.learn-ssh\bin\learn-ssh.cmd`
- macOS/Linux: `./.learn-ssh/bin/learn-ssh`

Then restart your agent and use `$learn-ssh`. The examples below use **Windows PowerShell** and can be pasted directly from the project root. On macOS/Linux, replace the launcher path with `./.learn-ssh/bin/learn-ssh` and use Bash `\` line continuations.

Additional options:

```bash
npx --yes github:nichem/LearnSSH --force              # replace an existing install
npx --yes github:nichem/LearnSSH --agents agents,claude  # explicit subset, skips auto-detect
npx --yes github:nichem/LearnSSH --all                # every registered agent
npx --yes github:nichem/LearnSSH --target .myagent/skills  # any dir, standard SKILL.md format
npx --yes github:nichem/LearnSSH --scope user         # user dirs (~/.agents/skills, ~/.claude/skills)
```

Use `--agents agents` to install only the shared `.agents/skills/` copy. `--target` makes the installer work with any AI tool that loads the Agent Skills (`SKILL.md`) format, even before it is added to the registry. Adding a new agent to the registry is a one-line change in `agents.json` — no installer code changes needed.

## First-Time Setup

The preceding `npx` install command automatically initializes project-local encrypted storage, creates `.learn-ssh\` in the current directory, and adds it to `.gitignore`. You do not need to run `init` separately.

To override the data storage location, keep `LEARN_SSH_HOME` set both while running the `npx` installer and whenever you later run LearnSSH:

```powershell
$env:LEARN_SSH_HOME = "D:\path\to\learn-ssh-data"
```

PowerShell `$env:` assignments apply only to the current terminal session. If you want the override to survive new terminals, configure `LEARN_SSH_HOME` as a persistent user or system environment variable.

Add a password-based server alias:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd add `
  --alias prod-web-1 `
  --host 203.0.113.10 `
  --user root `
  --auth password
```

The real SSH password is typed only into the hidden terminal prompt. Do not pass secrets as command-line flags or paste them into chat.

Add a key-based server alias:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd add `
  --alias prod-db-1 `
  --host 203.0.113.20 `
  --user ubuntu `
  --auth key `
  --key-path "$HOME\.ssh\id_ed25519" `
  --embed-key `
  --ask-passphrase
```

## Common Commands

List aliases:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd list
```

Show one alias without secrets:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd show prod-web-1
```

Run a remote command:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 -- "hostname && uptime"
```

Get JSON output:

```powershell
.\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 --json -- "hostname"
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
.\.learn-ssh\bin\learn-ssh.cmd tunnel prod-db-1 `
  --local-port 15432 `
  --remote-host 127.0.0.1 `
  --remote-port 5432
```

## Safety Model

LearnSSH deliberately does not implement a broad remote-command approval system. Risky command approval should come from the host tool layer, such as Codex or Claude CLI permissions.

The CLI still hard-blocks `rm -rf /` style root deletion locally before opening an SSH connection.

Secrets are not accepted as flags. Credentials are prompted in the terminal and encrypted before storage.

## Project Layout

```text
agents.json
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

```powershell
uv run --with pyyaml "$HOME\.codex\skills\.system\skill-creator\scripts\quick_validate.py" skills\learn-ssh
```

Check the CLI syntax:

```powershell
node --check skills\learn-ssh\scripts\ssh-node-ops.mjs
```

## Packaging

Preview the npm package contents:

```powershell
npm pack --dry-run
```

## Friendly Links

- [LINUX DO](https://linux.do/) - A new ideal community and gathering place for technology enthusiasts.

## License

MIT License. See [LICENSE](LICENSE).
