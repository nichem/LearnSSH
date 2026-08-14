#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "learn-ssh";
const RULE_MARKER = "<!-- learn-ssh generated rule -->";
const dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(dirname, "..");
const sourceSkillRoot = path.join(packageRoot, "skills", SKILL_NAME);

function loadRegistry() {
  const registryPath = path.join(packageRoot, "agents.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const agents = {};
  for (const [key, value] of Object.entries(registry)) {
    if (key.startsWith("$")) continue;
    agents[key] = value;
  }
  return agents;
}

const REGISTRY = loadRegistry();
const AGENT_KEYS = Object.keys(REGISTRY);
// 一个都没探测到时的回退集合，保持与旧版行为一致
const FALLBACK_AGENTS = ["codex", "claude", "opencode"];

function usage() {
  console.log(`LearnSSH installer (project-local)

Usage:
  npx @learnaihubc/learn-ssh [options]

Installs the learn-ssh skill for AI coding agents. Supported agents are
defined in agents.json; current list: ${AGENT_KEYS.join(", ")}.

Skill-format agents get a SKILL.md directory (e.g. .claude/skills/learn-ssh/).
Rule-format agents (Cursor, Copilot, ...) get a generated rule file pointing
at the bundled CLI.

By default the installer auto-detects which agents the project already uses
(.codex/, .claude/, .cursor/, ...) and installs only for those; with no
detection it falls back to: ${FALLBACK_AGENTS.join(", ")}.

Options:
  --force            Replace an existing LearnSSH skill installation
  --no-bin           Do not create the learn-ssh launcher
  --agents <list>    Comma-separated agent keys (see list above). Skips
                     auto-detection.
  --all              Install for every registered agent
  --target <dir>     Install the standard SKILL.md skill into an arbitrary
                     directory (works with any agent-compatible tool)
  --scope <scope>    project (default) or user. User scope installs skills
                     into per-user directories (~/.claude/skills, ...) where
                     the agent supports it
  --help             Show this help
`);
}

function parseArgs(argv) {
  const opts = { force: false, bin: true, agents: null, all: false, target: null, scope: "project" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--force") {
      opts.force = true;
      continue;
    }
    if (arg === "--no-bin") {
      opts.bin = false;
      continue;
    }
    if (arg === "--all") {
      opts.all = true;
      continue;
    }
    if (arg === "--agents") {
      if (i + 1 >= argv.length) throw new Error("Missing value for --agents");
      opts.agents = argv[++i].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      continue;
    }
    if (arg === "--target") {
      if (i + 1 >= argv.length) throw new Error("Missing value for --target");
      opts.target = argv[++i];
      continue;
    }
    if (arg === "--scope") {
      if (i + 1 >= argv.length) throw new Error("Missing value for --scope");
      opts.scope = argv[++i].toLowerCase();
      if (opts.scope !== "project" && opts.scope !== "user") {
        throw new Error(`Invalid scope: ${opts.scope}. Valid: project, user`);
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.agents) {
    for (const a of opts.agents) {
      if (!AGENT_KEYS.includes(a)) {
        throw new Error(`Unknown agent: ${a}. Valid: ${AGENT_KEYS.join(", ")}`);
      }
    }
  }
  return opts;
}

function ensurePackageLooksLikeSkill() {
  const skillMd = path.join(sourceSkillRoot, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    throw new Error(`SKILL.md not found in package skill root: ${sourceSkillRoot}`);
  }
}

// 自动探测：默认探测标记是 projectDir 的第一段（.codex、.cursor ...），
// 共享目录（如 .github）需在注册表里用 detect 指定更精确的标记
function detectAgents(projectRoot) {
  const detected = [];
  for (const key of AGENT_KEYS) {
    const agent = REGISTRY[key];
    const markers = agent.detect || [agent.projectDir.split(/[\\/]/)[0]];
    if (markers.some((m) => fs.existsSync(path.join(projectRoot, m)))) {
      detected.push(key);
    }
  }
  return detected;
}

function isLearnSshInstall(dir) {
  const skillMd = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillMd)) return false;
  const body = fs.readFileSync(skillMd, "utf8");
  return /^name:\s*learn-ssh\s*$/m.test(body);
}

function copySkillMetadata(destRoot, agent) {
  const skillMdSrc = path.join(sourceSkillRoot, "SKILL.md");
  fs.cpSync(skillMdSrc, path.join(destRoot, "SKILL.md"), { force: true });
  if (agent && agent.extras && agent.extras.includes("agents")) {
    const agentsSrc = path.join(sourceSkillRoot, "agents");
    if (fs.existsSync(agentsSrc)) {
      fs.cpSync(agentsSrc, path.join(destRoot, "agents"), {
        recursive: true,
        force: true,
        verbatimSymlinks: false,
      });
    }
  }
}

// 从 SKILL.md 提取 frontmatter 的 description 和 Hard Rules 段，
// 规则类工具只需要这两部分 + CLI 速查，不维护第二份完整文档
function extractRuleContent() {
  // 规范化行尾：Windows checkout 可能是 CRLF，SKILL.md 的段落提取按 LF 匹配
  const body = fs.readFileSync(path.join(sourceSkillRoot, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  const descMatch = body.match(/^---\n([\s\S]*?)\n---/);
  const desc = descMatch ? (descMatch[1].match(/^description:\s*(.+)$/m)?.[1] || "").trim() : "";
  const hardRules = body.match(/^## Hard Rules\n\n([\s\S]*?)(?=\n^## )/m)?.[1] || "";
  return { desc, hardRules: hardRules.trim() };
}

function renderRule(agent) {
  const { desc, hardRules } = extractRuleContent();
  let frontmatter = "";
  if (agent.ruleFrontmatter === "cursor") {
    frontmatter = `---\ndescription: LearnSSH\nalwaysApply: true\n---\n`;
  } else if (agent.ruleFrontmatter === "copilot") {
    frontmatter = `---\napplyTo: "**"\n---\n`;
  }
  return `${frontmatter}${RULE_MARKER}

# LearnSSH

${desc}

Use the bundled Node.js CLI at \`./.learn-ssh/bin/learn-ssh\` (or set
\`LEARN_SSH="./.learn-ssh/bin/learn-ssh"\`) for every SSH operation. Work with
server aliases only; secrets live in encrypted per-project storage and are
never entered in chat.

## Hard Rules

${hardRules}

## Command Cheatsheet

\`\`\`bash
LEARN_SSH="./.learn-ssh/bin/learn-ssh"
$LEARN_SSH init                          # 初始化加密存储（用户自己在终端运行）
$LEARN_SSH add --alias <a> --host <h> --user <u> --auth password|key  # 用户自己运行
$LEARN_SSH list                          # 列出别名
$LEARN_SSH show <alias>                  # 查看别名（不含敏感信息）
$LEARN_SSH exec <alias> -- "<cmd>"       # 执行远程命令
$LEARN_SSH upload <alias> <local> <remote>
$LEARN_SSH download <alias> <remote> <local>
$LEARN_SSH tunnel <alias> --local-port <lp> --remote-port <rp>
\`\`\`

Full documentation: https://github.com/nichem/LearnSSH
`;
}

function installDependencies(scriptsDir) {
  if (!fs.existsSync(path.join(scriptsDir, "package.json"))) return;
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  // On Windows npm is a .cmd shim, so spawnSync needs shell: true. With a shell
  // the args are joined into one command line without quoting, so a prefix path
  // containing spaces (e.g. C:\Users\John Doe\proj) would be split. Quote it.
  // Windows paths cannot contain a double-quote, so wrapping is safe.
  const useShell = process.platform === "win32";
  const prefixArg = useShell ? `"${scriptsDir}"` : scriptsDir;
  console.log("Installing LearnSSH Node dependencies...");
  const result = spawnSync(npmBin, ["install", "--omit=dev", "--prefix", prefixArg], {
    stdio: "inherit",
    shell: useShell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm install failed with exit code ${result.status}`);
  }
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function writeLauncher() {
  const binDir = path.join(process.cwd(), ".learn-ssh", "bin");
  const target = path.join(process.cwd(), ".learn-ssh", "scripts", "ssh-node-ops.mjs");
  fs.mkdirSync(binDir, { recursive: true });

  const launcher = path.join(binDir, "learn-ssh");
  fs.writeFileSync(launcher, `#!/bin/sh
exec node ${shQuote(target)} "$@"
`);
  fs.chmodSync(launcher, 0o755);

  if (process.platform === "win32") {
    const cmdLauncher = path.join(binDir, "learn-ssh.cmd");
    fs.writeFileSync(cmdLauncher, `@echo off\r\nnode "${target}" %*\r\n`);
    return cmdLauncher;
  }

  return launcher;
}

function ensureGitignoreEntry(projectRoot) {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const entry = ".learn-ssh/";
  let existing = "";
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, "utf8");
  }
  if (existing.includes(entry)) return;
  const addition = existing && !existing.endsWith("\n") ? `\n${entry}\n` : `${entry}\n`;
  fs.appendFileSync(gitignorePath, addition);
}

function agentBaseDir(projectRoot, agent, scope) {
  if (scope === "user") {
    if (!agent.userDir) return null;
    return path.resolve(agent.userDir.replace(/^~(?=$|\/|\\)/, os.homedir()));
  }
  return path.join(projectRoot, agent.projectDir);
}

function installSkill(dest, agent, opts, installed) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    if (!isLearnSshInstall(dest)) {
      throw new Error(`Destination exists and does not look like LearnSSH: ${dest}`);
    }
    if (!opts.force) {
      console.log(`LearnSSH is already installed at ${dest}`);
      installed.push({ label: dest, skipped: true });
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.mkdirSync(dest, { recursive: true });
  copySkillMetadata(dest, agent);
  installed.push({ label: dest, skipped: false });
  console.log(`Skill metadata installed to ${dest}`);
}

function installRule(rulePath, agent, opts, installed) {
  fs.mkdirSync(path.dirname(rulePath), { recursive: true });

  if (fs.existsSync(rulePath)) {
    const existing = fs.readFileSync(rulePath, "utf8");
    if (!existing.includes(RULE_MARKER)) {
      throw new Error(`Destination exists and does not look like LearnSSH: ${rulePath}`);
    }
    if (!opts.force) {
      console.log(`LearnSSH rule already exists at ${rulePath}`);
      installed.push({ label: rulePath, skipped: true });
      return;
    }
  }

  fs.writeFileSync(rulePath, renderRule(agent));
  installed.push({ label: rulePath, skipped: false });
  console.log(`Rule file installed to ${rulePath}`);
}

function install(opts) {
  ensurePackageLooksLikeSkill();
  const projectRoot = process.cwd();
  const learnSshDir = path.join(projectRoot, ".learn-ssh");
  const scriptsDir = path.join(learnSshDir, "scripts");

  fs.mkdirSync(learnSshDir, { recursive: true });

  const scriptsSrc = path.join(sourceSkillRoot, "scripts");
  fs.cpSync(scriptsSrc, scriptsDir, { recursive: true, force: true, verbatimSymlinks: false });
  installDependencies(scriptsDir);
  console.log(`CLI installed to ${scriptsDir}`);

  let agentKeys;
  if (opts.agents) {
    agentKeys = opts.agents;
  } else if (opts.all) {
    agentKeys = AGENT_KEYS;
  } else {
    agentKeys = detectAgents(projectRoot);
    if (agentKeys.length === 0) {
      agentKeys = FALLBACK_AGENTS;
      console.log(`No agent directories detected; falling back to: ${FALLBACK_AGENTS.join(", ")}`);
    } else {
      console.log(`Detected agents: ${agentKeys.join(", ")}`);
    }
  }

  const installed = [];
  for (const key of agentKeys) {
    const agent = REGISTRY[key];
    const baseDir = agentBaseDir(projectRoot, agent, opts.scope);
    if (!baseDir) {
      console.log(`Skipping ${agent.label}: no user-level directory in registry`);
      continue;
    }
    if (agent.format === "rule") {
      installRule(path.join(baseDir, agent.ruleFile), agent, opts, installed);
    } else {
      installSkill(path.join(baseDir, SKILL_NAME), agent, opts, installed);
    }
  }

  if (opts.target) {
    const targetDir = path.resolve(projectRoot, opts.target);
    installSkill(path.join(targetDir, SKILL_NAME), null, opts, installed);
  }

  let launcher = null;
  const activeInstalls = installed.filter((a) => !a.skipped);
  if (opts.bin && activeInstalls.length > 0) {
    launcher = writeLauncher();
    console.log(`Launcher installed to ${launcher}`);
    console.log(`Run: ${launcher} list`);
  }

  if (opts.scope === "project") {
    ensureGitignoreEntry(projectRoot);
    console.log(`Added .learn-ssh/ to ${path.join(projectRoot, ".gitignore")}`);
  }

  console.log(`\nDone. Skill installed for: ${installed.map((a) => a.label).join(", ")}.`);
  console.log("Restart your agent(s), then use $learn-ssh for SSH server operations.");
  console.log("Run `$LEARN_SSH init` in the project to initialize encrypted storage.");
}

try {
  install(parseArgs(process.argv));
} catch (err) {
  console.error(`LearnSSH install failed: ${err.message || err}`);
  process.exit(1);
}
