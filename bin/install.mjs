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
// 空项目默认写入跨工具共享目录，并为 Claude Code 保留专用目录。
const FALLBACK_AGENTS = ["agents", "claude"];
const USE_COLOR = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);

function highlightForce() {
  return USE_COLOR ? "\u001b[1;33m--force\u001b[0m" : "--force";
}

function usage() {
  console.log(`LearnSSH installer (project-local)

Usage:
  npx @learnaihubc/learn-ssh [options]

Installs the learn-ssh skill for AI coding agents. Supported agents are
defined in agents.json; current list: ${AGENT_KEYS.join(", ")}.
The same command also initializes project-local encrypted storage.

Skill-format agents get a SKILL.md directory (e.g. .agents/skills/learn-ssh/).
Rule-format agents (Cursor, Copilot, ...) get a generated rule file pointing
at the bundled CLI.

By default the installer auto-detects which agents the project already uses
(.agents/, .claude/, .cursor/, ...) and installs only for those; with no
detection it falls back to: ${FALLBACK_AGENTS.join(", ")}.

Options:
  ${highlightForce()}            Replace an existing LearnSSH skill installation
  --no-bin           Do not create the learn-ssh launcher
  --agents <list>    Comma-separated agent keys (see list above). Skips
                     auto-detection.
  --all              Install for every registered agent
  --target <dir>     Install the standard SKILL.md skill into an arbitrary
                     directory (works with any agent-compatible tool)
  --scope <scope>    project (default) or user. User scope installs skills
                     into per-user directories (~/.agents/skills, ...) where
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

function validateSkillDestination(dest) {
  if (fs.existsSync(dest) && !isLearnSshInstall(dest)) {
    throw new Error(`Destination exists and does not look like LearnSSH: ${dest}`);
  }
}

function validateRuleDestination(rulePath) {
  if (!fs.existsSync(rulePath)) return;
  const existing = fs.readFileSync(rulePath, "utf8");
  if (!existing.includes(RULE_MARKER)) {
    throw new Error(`Destination exists and does not look like LearnSSH: ${rulePath}`);
  }
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

function renderRule(agent, useLauncher) {
  const { desc, hardRules } = extractRuleContent();
  const platformLauncher = process.platform === "win32"
    ? ".\\.learn-ssh\\bin\\learn-ssh.cmd"
    : "./.learn-ssh/bin/learn-ssh";
  const cli = useLauncher ? platformLauncher : "node ./.learn-ssh/scripts/ssh-node-ops.mjs";
  let frontmatter = "";
  if (agent.ruleFrontmatter === "cursor") {
    frontmatter = `---\ndescription: LearnSSH\nalwaysApply: true\n---\n`;
  } else if (agent.ruleFrontmatter === "copilot") {
    frontmatter = `---\napplyTo: "**"\n---\n`;
  }
  return `${frontmatter}${RULE_MARKER}

# LearnSSH

${desc}

Use the bundled CLI at \`${cli}\` for every SSH operation. Work with server
aliases only; secrets live in encrypted per-project storage and are never
entered in chat.

## Hard Rules

${hardRules}

## Command Cheatsheet

\`\`\`text
${cli} add --alias <a> --host <h> --user <u> --auth password|key
${cli} list
${cli} show <alias>
${cli} exec <alias> -- "<cmd>"
${cli} upload <alias> <local> <remote>
${cli} download <alias> <remote> <local>
${cli} tunnel <alias> --local-port <lp> --remote-port <rp>
\`\`\`

Full documentation: https://github.com/nichem/LearnSSH
`;
}

function installDependencies(scriptsDir) {
  if (!fs.existsSync(path.join(scriptsDir, "package.json"))) return;
  const npmArgs = [
    "install",
    "--omit=dev",
    "--prefix",
    scriptsDir,
    "--no-audit",
    "--no-fund",
    "--no-progress",
    "--loglevel=error",
  ];
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const npmCli = npmCliCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (process.platform === "win32" && !npmCli) {
    throw new Error("Could not locate npm-cli.js in the current Node.js installation");
  }
  const command = npmCli ? process.execPath : "npm";
  const args = npmCli ? [npmCli, ...npmArgs] : npmArgs;
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    if (details) console.error(details);
    throw new Error(`npm install failed with exit code ${result.status}`);
  }
}

function initializeStorage(scriptsDir, projectRoot) {
  const cliPath = path.join(scriptsDir, "ssh-node-ops.mjs");
  const result = spawnSync(process.execPath, [cliPath, "init", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    if (details) console.error(details);
    throw new Error(`LearnSSH initialization failed with exit code ${result.status}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("LearnSSH initialization returned an invalid response");
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
  if (existing.includes(entry)) return false;
  const addition = existing && !existing.endsWith("\n") ? `\n${entry}\n` : `${entry}\n`;
  fs.appendFileSync(gitignorePath, addition);
  return true;
}

function displayPath(target, projectRoot = process.cwd()) {
  const relative = path.relative(projectRoot, target);
  const isOutside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!isOutside) return relative ? `.${path.sep}${relative}` : ".";
  return target;
}

function installLabel(agent, destination) {
  return agent?.label || displayPath(destination);
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
    validateSkillDestination(dest);
    if (!opts.force) {
      installed.push({ label: installLabel(agent, dest), skipped: true });
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.mkdirSync(dest, { recursive: true });
  copySkillMetadata(dest, agent);
  installed.push({ label: installLabel(agent, dest), skipped: false });
}

function installRule(rulePath, agent, opts, installed) {
  fs.mkdirSync(path.dirname(rulePath), { recursive: true });

  if (fs.existsSync(rulePath)) {
    validateRuleDestination(rulePath);
    if (!opts.force) {
      installed.push({ label: installLabel(agent, rulePath), skipped: true });
      return;
    }
  }

  fs.writeFileSync(rulePath, renderRule(agent, opts.bin));
  installed.push({ label: installLabel(agent, rulePath), skipped: false });
}

function install(opts) {
  ensurePackageLooksLikeSkill();
  const projectRoot = process.cwd();
  const learnSshDir = path.join(projectRoot, ".learn-ssh");
  const scriptsDir = path.join(learnSshDir, "scripts");

  let agentKeys;
  if (opts.agents) {
    agentKeys = opts.agents;
  } else if (opts.all) {
    agentKeys = AGENT_KEYS;
  } else {
    agentKeys = detectAgents(projectRoot);
    if (agentKeys.length === 0) {
      agentKeys = FALLBACK_AGENTS;
    }
  }

  const targets = [];
  for (const key of agentKeys) {
    const agent = REGISTRY[key];
    const baseDir = agentBaseDir(projectRoot, agent, opts.scope);
    if (!baseDir) {
      console.log(`Skipping ${agent.label}: no user-level directory in registry`);
      continue;
    }
    if (agent.format === "rule") {
      targets.push({ format: "rule", destination: path.join(baseDir, agent.ruleFile), agent });
    } else {
      targets.push({ format: "skill", destination: path.join(baseDir, SKILL_NAME), agent });
    }
  }

  if (opts.target) {
    const targetDir = path.resolve(projectRoot, opts.target);
    targets.push({ format: "skill", destination: path.join(targetDir, SKILL_NAME), agent: null });
  }

  for (const target of targets) {
    if (target.format === "rule") {
      validateRuleDestination(target.destination);
    } else {
      validateSkillDestination(target.destination);
    }
  }

  fs.mkdirSync(learnSshDir, { recursive: true });
  const scriptsSrc = path.join(sourceSkillRoot, "scripts");
  fs.cpSync(scriptsSrc, scriptsDir, { recursive: true, force: true, verbatimSymlinks: false });
  installDependencies(scriptsDir);
  const storage = initializeStorage(scriptsDir, projectRoot);

  const installed = [];
  for (const target of targets) {
    if (target.format === "rule") {
      installRule(target.destination, target.agent, opts, installed);
    } else {
      installSkill(target.destination, target.agent, opts, installed);
    }
  }

  const launcher = opts.bin ? writeLauncher() : null;
  const launcherCommand = process.platform === "win32"
    ? ".\\.learn-ssh\\bin\\learn-ssh.cmd"
    : "./.learn-ssh/bin/learn-ssh";

  if (opts.scope === "project") {
    ensureGitignoreEntry(projectRoot);
  }

  const changed = installed.filter((item) => !item.skipped).map((item) => item.label);
  const kept = installed.filter((item) => item.skipped).map((item) => item.label);
  console.log("LearnSSH ready");
  console.log(`CLI: ${displayPath(scriptsDir, projectRoot)}`);
  console.log(`Storage: ${displayPath(storage.storageDir, projectRoot)} (${storage.masterKeyProvider})`);
  if (changed.length) console.log(`Skills installed: ${changed.join(", ")}`);
  if (kept.length) console.log(`Skills kept: ${kept.join(", ")}`);
  if (launcher) console.log(`Launcher: ${displayPath(launcher, projectRoot)}`);
  if (!opts.force && kept.length) {
    console.log(`Tip: re-run with ${highlightForce()} to replace existing skill installations.`);
  }
  if (launcher) console.log(`Run: ${launcherCommand} list`);
  console.log("Restart your agent(s) to reload the skill.");
}

try {
  install(parseArgs(process.argv));
} catch (err) {
  console.error(`LearnSSH install failed: ${err.message || err}`);
  process.exit(1);
}
