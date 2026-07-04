#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "learn-ssh";
const dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(dirname, "..");
const sourceSkillRoot = path.join(packageRoot, "skills", SKILL_NAME);

function usage() {
  console.log(`LearnSSH installer

Usage:
  npx @learnaihubc/learn-ssh [options]

Options:
  --force          Replace an existing LearnSSH skill installation
  --dest <dir>     Install into a custom skills directory
  --help           Show this help
`);
}

function parseArgs(argv) {
  const opts = { force: false };
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
    if (arg === "--dest") {
      if (i + 1 >= argv.length) throw new Error("Missing value for --dest");
      opts.dest = argv[++i];
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function defaultSkillsDir() {
  return path.join(codexHome(), "skills");
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

function copyFromRoot(name, destRoot) {
  const src = path.join(packageRoot, name);
  const dest = path.join(destRoot, name);
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true, force: true, verbatimSymlinks: false });
}

function copyFromSkill(name, destRoot) {
  const src = path.join(sourceSkillRoot, name);
  const dest = path.join(destRoot, name);
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true, force: true, verbatimSymlinks: false });
}

function installDependencies(dest) {
  const scriptsDir = path.join(dest, "scripts");
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log("Installing LearnSSH Node dependencies...");
  const result = spawnSync(npmBin, ["install", "--omit=dev", "--prefix", scriptsDir], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm install failed with exit code ${result.status}`);
  }
}

function install(opts) {
  ensurePackageLooksLikeSkill();
  const skillsDir = path.resolve(opts.dest || defaultSkillsDir());
  const dest = path.join(skillsDir, SKILL_NAME);
  fs.mkdirSync(skillsDir, { recursive: true });

  if (fs.existsSync(dest)) {
    if (!isLearnSshInstall(dest)) {
      throw new Error(`Destination exists and does not look like LearnSSH: ${dest}`);
    }
    if (!opts.force) {
      console.log(`LearnSSH is already installed at ${dest}`);
      console.log("Run again with --force to replace it with this package version.");
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.mkdirSync(dest, { recursive: true });
  for (const name of ["SKILL.md", "agents", "scripts"]) {
    copyFromSkill(name, dest);
  }
  for (const name of ["README.md", "README_CN.md", "LICENSE"]) {
    copyFromRoot(name, dest);
  }
  installDependencies(dest);

  console.log(`LearnSSH installed to ${dest}`);
  console.log("Restart Codex, then use $learn-ssh for SSH server operations.");
}

try {
  install(parseArgs(process.argv));
} catch (err) {
  console.error(`LearnSSH install failed: ${err.message || err}`);
  process.exit(1);
}
