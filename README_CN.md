# LearnSSH

LearnSSH 是一个 Codex skill，用于通过 SSH 管理服务器。它内置 Node.js CLI，支持按别名执行远程命令、SFTP 上传/下载、本地隧道、跳板机，以及安全录入 SSH 凭据。

English version: [README.md](README.md)

## 功能

- 使用服务器别名，避免在对话里反复写 `user@host`。
- SSH 密码、私钥、passphrase 不进入聊天内容。
- 敏感信息按项目加密保存在 `./.learn-ssh/`。
- 执行远程命令，并支持按别名复用 SSH 连接。
- 通过 SFTP 上传和下载文件。
- 启动本地 SSH 隧道。
- 按服务器别名维护持久运维记录，并隔离本地任务临时文件。
- 默认输出简洁的人类可读结果，使用 `--json` 输出结构化 JSON。
- 在建立 SSH 连接前硬拦截 `rm -rf /` 这类根目录强删命令。

## 安装

在项目根目录运行：

```bash
npx --yes github:nichem/LearnSSH
```

安装器会自动探测项目里已经在用哪些 agent（`.agents/`、`.claude/`、`.cursor/` ...），只为探测到的目标安装。一个都没探测到时，默认同时安装到通用的 `.agents/skills/` 和 Claude Code 的 `.claude/skills/`。这样 Codex 等支持开放 Agent Skills 目录的工具可以共享一份 skill，同时兼容 Claude Code。安装器还会在项目根目录的 `AGENTS.md` 中幂等维护一段 LearnSSH 总规则；已有内容不会被覆盖。

支持的 agent 由 `agents.json` 注册表定义：

| Agent | 格式 | 位置 |
|-------|------|------|
| Agent Skills（通用） | skill | `.agents/skills/learn-ssh/` |
| Codex | skill | `.codex/skills/learn-ssh/` |
| Claude Code | skill | `.claude/skills/learn-ssh/` |
| opencode | skill | `.opencode/skills/learn-ssh/` |
| ZCode | skill | `.zcode/skills/learn-ssh/` |
| Cursor | rule | `.cursor/rules/learn-ssh.mdc` |
| Windsurf | rule | `.windsurf/rules/learn-ssh.md` |
| GitHub Copilot | rule | `.github/instructions/learn-ssh.instructions.md` |
| Cline | rule | `.clinerules/learn-ssh.md` |
| Roo Code | rule | `.roo/rules/learn-ssh.md` |

skill 格式的 agent 装标准 `SKILL.md` 目录；rule 格式的 agent 生成一个小规则文件（描述 + 硬性规则 + CLI 速查），指向内置 CLI。

安装器会按平台创建启动器：

- Windows：`.\.learn-ssh\bin\learn-ssh.cmd`
- macOS/Linux：`./.learn-ssh/bin/learn-ssh`

然后重启 agent，使用 `$learn-ssh`。下文命令默认使用 **Windows PowerShell**，可直接在项目根目录运行；macOS/Linux 用户将启动器路径替换为 `./.learn-ssh/bin/learn-ssh`，并使用 Bash 的 `\` 续行即可。

更多选项：

```bash
npx --yes github:nichem/LearnSSH --force              # 覆盖已有安装
npx --yes github:nichem/LearnSSH --agents agents,claude  # 指定子集，跳过自动探测
npx --yes github:nichem/LearnSSH --all                # 装全部注册的 agent
npx --yes github:nichem/LearnSSH --target .myagent/skills  # 任意目录，标准 SKILL.md 格式
npx --yes github:nichem/LearnSSH --scope user         # 用户级目录（~/.agents/skills、~/.claude/skills）
```

`--agents agents` 可只安装通用 `.agents/skills/` 版本。`--target` 让安装器可以适配任何支持 Agent Skills（`SKILL.md`）格式的 AI 工具，即使它还没进注册表。要支持新 agent，只需在 `agents.json` 里加一条，不用改安装代码。

## 首次配置

运行前面的 `npx` 安装命令时，安装器会自动初始化项目级加密存储，在当前目录创建 `.learn-ssh\` 和 `.learn-ssh\servers\`，并将 `.learn-ssh\` 加入 `.gitignore`，无需再手动执行 `init`。

如需覆盖数据存储位置，运行 `npx` 安装命令以及后续每次运行 LearnSSH 时，都必须保持 `LEARN_SSH_HOME` 已设置：

```powershell
$env:LEARN_SSH_HOME = "D:\path\to\learn-ssh-data"
```

PowerShell 的 `$env:` 赋值只在当前终端会话中有效。如需在新终端中继续使用该目录，请将 `LEARN_SSH_HOME` 配置为持久的用户或系统环境变量。

服务器别名可使用 Unicode 字母或数字（包括中文）以及 `.`、`_`、`-`。别名必须能安全用作跨平台目录名：不能是 `.`、`..`，不能以 `.` 结尾，不能使用 Windows 保留名，也不能与现有别名仅有规范化后的大小写差异。

添加一个密码登录的服务器别名：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd add `
  --alias prod-web-1 `
  --host 203.0.113.10 `
  --user root `
  --auth password
```

真实 SSH 密码只在终端隐藏提示里输入。不要把密码作为命令行参数，也不要粘贴到聊天里。

添加一个私钥登录的服务器别名：

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

## 服务器记录与本地工作目录

项目根目录的 `AGENTS.md` 会告诉 agent：每次任务首次操作某个服务器别名前，先读取 `.learn-ssh/servers/<别名>/AGENTS.md`。对应文件不存在时由 agent 创建；用户要求记录服务器情况时必须更新，agent 也可以主动保存对后续运维有长期价值的信息。记录中不得包含密码、私钥、passphrase、令牌等秘密。

本地临时文件与长期记录按服务器隔离：

```text
.learn-ssh/
`-- servers/
    `-- <别名>/
        |-- AGENTS.md
        `-- work/
            `-- <任务ID>/
```

临时脚本、日志、压缩包和中间下载放在任务目录中，任务结束后只清理该任务目录，保留服务器级 `AGENTS.md`。用户明确指定位置的最终下载文件仍写入用户选择的路径。

## 常用命令

列出别名：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd list
```

查看一个别名，不显示敏感信息：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd show prod-web-1
```

执行远程命令：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 -- "hostname && uptime"
```

输出 JSON：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd exec prod-web-1 --json -- "hostname"
```

上传文件：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd upload prod-web-1 .\app.tar.gz /tmp/app.tar.gz
```

下载文件：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd download prod-web-1 /var/log/syslog .\syslog
```

启动本地隧道：

```powershell
.\.learn-ssh\bin\learn-ssh.cmd tunnel prod-db-1 `
  --local-port 15432 `
  --remote-host 127.0.0.1 `
  --remote-port 5432
```

## 安全模型

LearnSSH 不实现一整套远程命令审核系统。高风险命令是否允许执行，应交给宿主工具层处理，例如 Codex 或 Claude CLI 的权限机制。

CLI 本身仍会在本地硬拦截 `rm -rf /` 这类根目录强删命令，并且会在打开 SSH 连接前拦截。

敏感信息不接受命令行参数。凭据通过终端提示输入，并在写入前加密。

## 项目结构

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

## 验证

验证 skill 元数据：

```powershell
uv run --with pyyaml "$HOME\.codex\skills\.system\skill-creator\scripts\quick_validate.py" skills\learn-ssh
```

检查 CLI 语法：

```powershell
node --check skills\learn-ssh\scripts\ssh-node-ops.mjs
```

## 打包

预览 npm 包内容：

```powershell
npm pack --dry-run
```

## 友情链接

- [LINUX DO](https://linux.do/) —— 新的理想型社区，技术爱好者的聚集地。

## 许可证

MIT License。见 [LICENSE](LICENSE)。
