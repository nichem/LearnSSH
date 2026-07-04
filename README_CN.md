# LearnSSH

LearnSSH 是一个 Codex skill，用于通过 SSH 管理服务器。它内置 Node.js CLI，支持按别名执行远程命令、SFTP 上传/下载、本地隧道、跳板机，以及安全录入 SSH 凭据。

English version: [README.md](README.md)

## 功能

- 使用服务器别名，避免在对话里反复写 `user@host`。
- SSH 密码、私钥、passphrase 不进入聊天内容。
- 敏感信息加密保存在 `~/.codex/ssh-node-ops`。
- 执行远程命令，并支持按别名复用 SSH 连接。
- 通过 SFTP 上传和下载文件。
- 启动本地 SSH 隧道。
- 默认输出简洁的人类可读结果，使用 `--json` 输出结构化 JSON。
- 在建立 SSH 连接前硬拦截 `rm -rf /` 这类根目录强删命令。

## 安装到 Codex

把 skill 目录复制到 Codex skills 目录：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/learn-ssh "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh"
npm install --prefix "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts"
```

Codex 内部 skill 名是 `learn-ssh`，界面显示名是 `LearnSSH`。

安装后，如果 Codex 没有立刻刷新 skill 列表，开一个新线程或重启 Codex。

## 首次配置

初始化本地加密存储：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" init
```

添加一个密码登录的服务器别名：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" add \
  --alias prod-web-1 \
  --host 203.0.113.10 \
  --user root \
  --auth password
```

真实 SSH 密码只在终端隐藏提示里输入。不要把密码作为命令行参数，也不要粘贴到聊天里。

添加一个私钥登录的服务器别名：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" add \
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
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" list
```

查看一个别名，不显示敏感信息：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" show prod-web-1
```

执行远程命令：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" exec prod-web-1 -- "hostname && uptime"
```

输出 JSON：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" exec prod-web-1 --json -- "hostname"
```

上传文件：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" upload prod-web-1 ./app.tar.gz /tmp/app.tar.gz
```

下载文件：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" download prod-web-1 /var/log/syslog ./syslog
```

启动本地隧道：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/learn-ssh/scripts/ssh-node-ops.mjs" tunnel prod-db-1 \
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
skills/learn-ssh/
├── SKILL.md
├── agents/openai.yaml
└── scripts/
    ├── package.json
    ├── package-lock.json
    └── ssh-node-ops.mjs
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

创建不包含本地凭据或 `node_modules` 的源码包：

```bash
mkdir -p dist
tar --exclude='node_modules' \
  --exclude='.DS_Store' \
  -czf dist/LearnSSH-1.0.0.tar.gz \
  README.md README_CN.md LICENSE .gitignore skills/learn-ssh
```

## 许可证

MIT License。见 [LICENSE](LICENSE)。
