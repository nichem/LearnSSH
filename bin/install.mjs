#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "learn-ssh";
const dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(dirname, "..");
const sourceSkillRoot = path.join(packageRoot, "skills", SKILL_NAME);

const AGENT_DIRS = [
  { dir: ".codex", label: "Codex", needsAgentsYaml: true },
  { dir: ".claude", label: "Claude Code", needsAgentsYaml: false },
  { dir: ".opencode", label: "opencode", needsAgentsYaml: false },
];

function usage() {
  console.log(`LearnSSH installer (project-local)

Usage:
  npx @learnaihubc/learn-ssh [options]

Installs the learn-ssh skill into project-level directories for Codex,
Claude Code, and opencode:
  .codex/skills/learn-ssh/
  .claude/skills/learn-ssh/
  .opencode/skills/learn-ssh/

A launcher is created at .learn-ssh/bin/learn-ssh.

Options:
  --force          Replace an existing LearnSSH skill installation
  --no-bin         Do not create the learn-ssh launcher
  --agents <list>  Comma-separated list of agents to install for
                   (codex,claude,opencode). Default: all three.
  --help           Show this help
`);
}

function parseArgs(argv) {
  const opts = { force: false, bin: true, agents: ["codex", "claude", "opencode"] };
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
    if (arg === "--agents") {
      if (i + 1 >= argv.length) throw new Error("Missing value for --agents");
      opts.agents = argv[++i].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  const valid = ["codex", "claude", "opencode"];
  for (const a of opts.agents) {
    if (!valid.includes(a)) throw new Error(`Unknown agent: ${a}. Valid: ${valid.join(", ")}`);
  }
  return opts;
}

function ensurePackageLooksLikeSkill() {
  const skillMd = path.join(sourceSkillRoot, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    throw new Error(`SKILL.md not found in package skill root: ${sourceSkillRoot}`);
  }
}

function isLearnSshInstall(dir) {
  const skillMd = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillMd)) return false;
  const body = fs.readFileSync(skillMd, "utf8");
  return /^name:\s*learn-ssh\s*$/m.test(body);
}

function copySkillMetadata(destRoot, needsAgentsYaml) {
  const skillMdSrc = path.join(sourceSkillRoot, "SKILL.md");
  fs.cpSync(skillMdSrc, path.join(destRoot, "SKILL.md"), { force: true });
  if (needsAgentsYaml) {
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

  const installedAgents = [];
  for (const agent of AGENT_DIRS) {
    const agentKey = agent.dir.slice(1);
    if (!opts.agents.includes(agentKey)) continue;

    const skillsDir = path.join(projectRoot, agent.dir, "skills");
    const dest = path.join(skillsDir, SKILL_NAME);
    fs.mkdirSync(skillsDir, { recursive: true });

    if (fs.existsSync(dest)) {
      if (!isLearnSshInstall(dest)) {
        throw new Error(`Destination exists and does not look like LearnSSH: ${dest}`);
      }
      if (!opts.force) {
        console.log(`LearnSSH is already installed at ${dest} (${agent.label})`);
        installedAgents.push({ ...agent, dest, skipped: true });
        continue;
      }
      fs.rmSync(dest, { recursive: true, force: true });
    }

    fs.mkdirSync(dest, { recursive: true });
    copySkillMetadata(dest, agent.needsAgentsYaml);
    installedAgents.push({ ...agent, dest, skipped: false });
    console.log(`Skill metadata installed to ${dest} (${agent.label})`);
  }

  let launcher = null;
  const activeAgents = installedAgents.filter((a) => !a.skipped);
  if (opts.bin && activeAgents.length > 0) {
    launcher = writeLauncher();
    console.log(`Launcher installed to ${launcher}`);
    console.log(`Run: ${launcher} list`);
  }

  ensureGitignoreEntry(projectRoot);
  console.log(`Added .learn-ssh/ to ${path.join(projectRoot, ".gitignore")}`);

  const agentNames = installedAgents.map((a) => a.label).join(", ");
  console.log(`\nDone. Skill installed for: ${agentNames}.`);
  console.log("Restart your agent(s), then use $learn-ssh for SSH server operations.");
  console.log("Run `$LEARN_SSH init` in the project to initialize encrypted storage.");
}

try {
  install(parseArgs(process.argv));
} catch (err) {
  console.error(`LearnSSH install failed: ${err.message || err}`);
  process.exit(1);
}
