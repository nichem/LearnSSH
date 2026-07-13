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
- 默认输出简洁的人类可读结果，使用 `--json` 输出结构化 JSON。
- 在建立 SSH 连接前硬拦截 `rm -rf /` 这类根目录强删命令。

## 安装

在项目根目录运行：

```bash
npx --yes github:nichem/LearnSSH
```

这会把 skill 装到项目级目录，同时支持 **Codex**、**Claude Code** 和 **opencode** 三个 agent：
- `.codex/skills/learn-ssh/`
- `.claude/skills/learn-ssh/`
- `.opencode/skills/learn-ssh/`

启动器创建在 `./.learn-ssh/bin/learn-ssh`。然后重启 agent，使用 `$learn-ssh`。

更新已有安装时运行：

```bash
npx --yes github:nichem/LearnSSH --force
```

只装部分 agent：

```bash
npx --yes github:nichem/LearnSSH --agents codex,claude
```

## 首次配置

初始化项目级加密存储(在项目根目录运行)：

```bash
./.learn-ssh/bin/learn-ssh init
```

这会在当前目录创建 `./.learn-ssh/`，并自动将其加入 `.gitignore`。可通过 `LEARN_SSH_HOME=/path/to/dir` 覆盖存储位置。

添加一个密码登录的服务器别名：

```bash
./.learn-ssh/bin/learn-ssh add \
  --alias prod-web-1 \
  --host 203.0.113.10 \
  --user root \
  --auth password
```

真实 SSH 密码只在终端隐藏提示里输入。不要把密码作为命令行参数，也不要粘贴到聊天里。

添加一个私钥登录的服务器别名：

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

## 常用命令

列出别名：

```bash
./.learn-ssh/bin/learn-ssh list
```

查看一个别名，不显示敏感信息：

```bash
./.learn-ssh/bin/learn-ssh show prod-web-1
```

执行远程命令：

```bash
./.learn-ssh/bin/learn-ssh exec prod-web-1 -- "hostname && uptime"
```

输出 JSON：

```bash
./.learn-ssh/bin/learn-ssh exec prod-web-1 --json -- "hostname"
```

上传文件：

```bash
./.learn-ssh/bin/learn-ssh upload prod-web-1 ./app.tar.gz /tmp/app.tar.gz
```

下载文件：

```bash
./.learn-ssh/bin/learn-ssh download prod-web-1 /var/log/syslog ./syslog
```

启动本地隧道：

```bash
./.learn-ssh/bin/learn-ssh tunnel prod-db-1 \
  --local-port 15432 \
  --remote-host 127.0.0.1 \
  --remote-port 5432
```

## 安全模型

LearnSSH 不实现一整套远程命令审核系统。高风险命令是否允许执行，应交给宿主工具层处理，例如 Codex 或 Claude CLI 的权限机制。

CLI 本身仍会在本地硬拦截 `rm -rf /` 这类根目录强删命令，并且会在打开 SSH 连接前拦截。

敏感信息不接受命令行参数。凭据通过终端提示输入，并在写入前加密。

## 项目结构

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

## 验证

验证 skill 元数据：

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/learn-ssh
```

检查 CLI 语法：

```bash
node --check skills/learn-ssh/scripts/ssh-node-ops.mjs
```

## 打包

预览 npm 包内容：

```bash
npm pack --dry-run
```

## 友情链接

- [LINUX DO](https://linux.do/) —— 新的理想型社区，技术爱好者的聚集地。

## 许可证

MIT License。见 [LICENSE](LICENSE)。
