#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const APP = 'learn-ssh';
const DATA_DIR = path.join(process.cwd(), '.learn-ssh');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const VAULT_PATH = path.join(DATA_DIR, 'vault.json');
const LOCAL_KEY_PATH = path.join(DATA_DIR, 'master.key');
const AAD = Buffer.from('learn-ssh:v1');
const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const BOOLEAN_OPTIONS = new Set([
  'ask-passphrase',
  'embed-key',
  'help',
  'json',
  'local-key',
  'no-daemon',
  'no-login',
  'stdin',
  'update',
]);
const COMMAND_OPTIONS = {
  init: ['localKey'],
  add: ['alias', 'host', 'user', 'username', 'auth', 'port', 'description', 'tags', 'proxyJump', 'keyPath', 'embedKey', 'askPassphrase', 'update'],
  list: [],
  show: [],
  remove: [],
  exec: ['stdin', 'command', 'timeout', 'daemonIdleTimeout', 'noDaemon', 'noLogin'],
  daemon: ['idleTimeout', 'daemonIdleTimeout'],
  upload: [],
  download: [],
  tunnel: ['localPort', 'localHost', 'remotePort', 'remoteHost', 'idleTimeout'],
  paths: [],
};
const KNOWN_OPTIONS = new Set([
  ...BOOLEAN_OPTIONS,
  ...Object.values(COMMAND_OPTIONS).flat().map((key) => key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)),
]);
const SECRET_OPTIONS = new Set(['password', 'passphrase', 'private-key', 'privateKey', 'secret']);

function keychainService() {
  const projectHash = crypto.createHash('sha256').update(DATA_DIR).digest('hex').slice(0, 12);
  return `${APP}-${projectHash}`;
}

function usage() {
  return `learn-ssh

Usage:
  learn-ssh init [--local-key]
  learn-ssh add --alias <name> --host <host> --user <user> --auth <password|key|agent> [options]
  learn-ssh list
  learn-ssh show <alias>
  learn-ssh remove <alias>
  learn-ssh exec <alias> -- <command>
  learn-ssh exec <alias> --stdin
  learn-ssh daemon start <alias>
  learn-ssh daemon status [alias]
  learn-ssh daemon stop <alias>
  learn-ssh upload <alias> <local-path> <remote-path>
  learn-ssh download <alias> <remote-path> <local-path>
  learn-ssh tunnel <alias> --local-port <port> --remote-port <port> [--remote-host <host>] [--idle-timeout <seconds>]
  learn-ssh paths
  learn-ssh help [command]
  learn-ssh <command> --help

Add options:
  --port <port>             Default: 22
  --description <text>
  --tags <a,b,c>
  --proxy-jump <alias>
  --key-path <path>         For key auth
  --embed-key               Encrypt private key content into the vault
  --ask-passphrase          Prompt for encrypted private key passphrase
  --update                  Replace an existing alias

Tunnel options:
  --idle-timeout <seconds>  Close after idle seconds. Default: 3600. Use 0 to disable.

Exec options:
  --timeout <seconds>       Remote command timeout. Default: 30.
  --daemon-idle-timeout <seconds>
                            Reused SSH connection idle timeout. Default: 3600.
  --no-daemon               Run once without connection reuse.
  --no-login                Run raw without a login+interactive shell (skip bashrc/profile/nvm).

Output options:
  --json                    Print JSON. Tunnel mode streams one JSON event per line.

Secrets are never accepted as flags. Passwords and passphrases are terminal prompts only.`;
}

function addUsage() {
  return `learn-ssh add

Usage:
  learn-ssh add --alias <name> --host <host> --user <user> --auth <password|key|agent> [options]

Required options:
  --alias <name>            Server alias used by later commands
  --host <host>             SSH hostname or IP address
  --user <user>             SSH username
  --auth <mode>             Authentication mode: password, key, or agent

Other options:
  --port <port>             SSH port. Default: 22.
  --description <text>      Description shown with the alias
  --tags <a,b,c>            Comma-separated tags
  --proxy-jump <alias>      Connect through an existing server alias
  --key-path <path>         Private key path for key authentication
  --embed-key               Encrypt the private key content in the vault; requires --key-path
  --ask-passphrase          Prompt for the private key passphrase
  --update                  Replace an existing alias
  --json                    Print the machine-readable JSON response
  --help, -h                Show this help

Examples:
  learn-ssh add --alias web --host 203.0.113.10 --user root --auth password
  learn-ssh add --alias db --host 203.0.113.20 --user ubuntu --auth key --key-path ~/.ssh/id_ed25519 --embed-key --ask-passphrase
  learn-ssh add --alias bastion --host bastion.example.com --user ops --auth agent

Passwords and passphrases are entered at hidden terminal prompts, never as flags.`;
}

function commandUsage(command, args = []) {
  const commonOptions = `  --json                    Print the machine-readable JSON response
  --help, -h                Show this help`;

  if (command === 'add') return addUsage();
  if (command === 'init') return `learn-ssh init

Usage:
  learn-ssh init [--local-key] [--json]

Initialize project-local encrypted storage.

Options:
  --local-key               Store the master key in a local file instead of macOS Keychain
${commonOptions}`;
  if (command === 'list') return `learn-ssh list

Usage:
  learn-ssh list [--json]

List configured aliases and their non-secret metadata.

Options:
${commonOptions}`;
  if (command === 'show') return `learn-ssh show

Usage:
  learn-ssh show <alias> [--json]

Show one alias without displaying secrets.

Options:
${commonOptions}`;
  if (command === 'remove') return `learn-ssh remove

Usage:
  learn-ssh remove <alias> [--json]

Remove the alias and its encrypted secret.

Options:
${commonOptions}`;
  if (command === 'exec') return `learn-ssh exec

Usage:
  learn-ssh exec <alias> [options] -- <command>
  learn-ssh exec <alias> [options] --stdin

Run a remote command. By default, the connection is reused and the command runs through bash -lic.
PowerShell: only if $OutputEncoding is not UTF-8, set $OutputEncoding = New-Object System.Text.UTF8Encoding($false) once per session before piping to --stdin. PowerShell 7 defaults to UTF-8.

Options:
  --stdin                   Read the remote command from standard input
  --command <text>          Provide the remote command as an option
  --timeout <seconds>       Remote command timeout. Default: 30.
  --daemon-idle-timeout <seconds>
                            Reused connection idle timeout. Default: 3600. Use 0 to disable.
  --no-daemon               Run once without connection reuse
  --no-login                Run the command directly without loading login and interactive shell settings
${commonOptions}`;
  if (command === 'daemon') {
    let subcommand;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '--') break;
      if (arg === '--help' || arg === '-h' || arg.startsWith('--help=')) continue;
      if (arg.startsWith('--')) {
        if (!arg.includes('=') && !BOOLEAN_OPTIONS.has(arg.slice(2))) i += 1;
        continue;
      }
      subcommand = arg;
      break;
    }
    if (subcommand && !['start', 'status', 'stop'].includes(subcommand)) {
      throw new Error(`Unknown daemon subcommand: ${subcommand}. Run learn-ssh daemon --help.`);
    }
    if (!subcommand) return `learn-ssh daemon

Usage:
  learn-ssh daemon start <alias> [--idle-timeout <seconds>]
  learn-ssh daemon status [alias]
  learn-ssh daemon stop <alias>

Use "learn-ssh daemon <subcommand> --help" for details.

Options:
${commonOptions}`;
    if (subcommand === 'start') return `learn-ssh daemon start

Usage:
  learn-ssh daemon start <alias> [--idle-timeout <seconds>] [--json]

Start or reuse an SSH connection for the alias.

Options:
  --idle-timeout <seconds>   Stop after this many idle seconds. Default: 3600. Use 0 to disable.
  --daemon-idle-timeout <seconds>
                            Alternative to --idle-timeout
${commonOptions}`;
    if (subcommand === 'status') return `learn-ssh daemon status

Usage:
  learn-ssh daemon status [alias] [--json]

Show connection status for one alias or all configured aliases.

Options:
${commonOptions}`;
    if (subcommand === 'stop') return `learn-ssh daemon stop

Usage:
  learn-ssh daemon stop <alias> [--json]

Stop the alias's reusable SSH connection.

Options:
${commonOptions}`;
  }
  if (command === 'upload') return `learn-ssh upload

Usage:
  learn-ssh upload <alias> <local-path> <remote-path> [--json]

Upload a local file to the remote server over SFTP.

Options:
${commonOptions}`;
  if (command === 'download') return `learn-ssh download

Usage:
  learn-ssh download <alias> <remote-path> <local-path> [--json]

Download a remote file over SFTP.

Options:
${commonOptions}`;
  if (command === 'tunnel') return `learn-ssh tunnel

Usage:
  learn-ssh tunnel <alias> --local-port <port> --remote-port <port> [options]

Forward a local TCP port to a remote host through the SSH connection.

Options:
  --local-port <port>       Local listening port (required)
  --local-host <host>       Local listening address. Default: 127.0.0.1.
  --remote-port <port>      Destination port (required)
  --remote-host <host>      Destination address. Default: 127.0.0.1.
  --idle-timeout <seconds>  Close after this many idle seconds. Default: 3600. Use 0 to disable.
  --json                    Stream one JSON event per line (started, forward-error, closed)
  --help, -h                Show this help`;
  if (command === 'paths') return `learn-ssh paths

Usage:
  learn-ssh paths [--json]

Show script and project-local storage paths.

Options:
${commonOptions}`;
  throw new Error(`Unknown command: ${command}`);
}

function requestsHelp(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') break;
    if (arg === '--help' || arg === '-h' || arg === '--help=true' || arg === '--help=1') return true;
    if (arg.startsWith('--') && !arg.includes('=') && !BOOLEAN_OPTIONS.has(arg.slice(2)) && argv[i + 1] === '-h') {
      i += 1;
    }
  }
  return false;
}

function parseArgs(argv) {
  const out = Object.create(null);
  out._ = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const raw = token.slice(2);
      const eq = raw.indexOf('=');
      const key = eq >= 0 ? raw.slice(0, eq) : raw;
      if (SECRET_OPTIONS.has(key)) {
        throw new Error(`Do not pass --${key} as a flag; use the secure terminal prompt`);
      }
      if (!KNOWN_OPTIONS.has(key)) {
        throw new Error(`Unknown option: --${key}. Run learn-ssh --help for available options.`);
      }
      let value;
      if (eq >= 0) {
        value = raw.slice(eq + 1);
      } else {
        if (BOOLEAN_OPTIONS.has(key)) {
          value = true;
        } else {
          const next = argv[i + 1];
          if (!next || next.startsWith('--')) {
            throw new Error(`Missing value for --${key}`);
          }
          value = next;
          i += 1;
        }
      }
      if (BOOLEAN_OPTIONS.has(key) && eq >= 0) {
        if (value === 'true' || value === '1') value = true;
        else if (value === 'false' || value === '0') value = false;
        else throw new Error(`Invalid boolean value for --${key}: ${value}. Use true or false.`);
      }
      out[toCamel(key)] = value;
    } else {
      out._.push(token);
    }
  }
  return out;
}

function validateCommandArgs(command, opts) {
  if (!Object.hasOwn(COMMAND_OPTIONS, command)) {
    throw new Error(`Unknown command: ${command}. Run learn-ssh --help for available commands.`);
  }

  requireNoSecretFlags(opts);
  const allowed = new Set(['json', 'help', ...COMMAND_OPTIONS[command]]);
  if (command === 'daemon' && !['start', 'serve'].includes(opts._[0])) {
    allowed.delete('idleTimeout');
    allowed.delete('daemonIdleTimeout');
  }
  for (const key of Object.keys(opts)) {
    if (key === '_') continue;
    if (!allowed.has(key)) {
      const flag = key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
      throw new Error(`Unknown option for ${command}: --${flag}. Run learn-ssh ${command} --help.`);
    }
  }

  const count = opts._.length;
  const requireCount = (min, max, expected) => {
    if (count < min) throw new Error(`${command} requires ${expected}. Run learn-ssh ${command} --help.`);
    if (count > max) throw new Error(`${command} received unexpected extra arguments. Run learn-ssh ${command} --help.`);
  };
  if (['init', 'add', 'list', 'paths'].includes(command)) requireCount(0, 0, 'no positional arguments');
  if (['show', 'remove', 'tunnel'].includes(command)) requireCount(1, 1, '<alias>');
  if (['upload', 'download'].includes(command)) {
    requireCount(3, 3, command === 'upload'
      ? '<alias> <local-path> <remote-path>'
      : '<alias> <remote-path> <local-path>');
  }
  if (command === 'exec') {
    requireCount(1, opts.stdin || opts.command !== undefined ? 1 : Infinity, '<alias>');
  }
  if (command === 'daemon') {
    const subcommand = opts._[0];
    if (!['start', 'status', 'stop', 'serve'].includes(subcommand)) {
      throw new Error('daemon requires one of: start, status, stop. Run learn-ssh daemon --help.');
    }
    requireCount(subcommand === 'status' ? 1 : 2, subcommand === 'status' ? 2 : 2,
      subcommand === 'status' ? 'status [alias]' : `${subcommand} <alias>`);
  }
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printJsonLine(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function wantsJson(opts = {}) {
  return opts.json === true || opts.json === 'true' || opts.json === '1';
}

function argvWantsJson(argv) {
  const separatorIndex = argv.indexOf('--');
  const args = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  return args.some((arg) => arg === '--json' || /^--json=(true|1)?$/u.test(arg));
}

function writeHuman(text) {
  const value = String(text);
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
}

function printResult(opts, value, formatter) {
  if (wantsJson(opts)) {
    printJson(value);
    return;
  }
  writeHuman(formatter(value));
}

function formatServerLine(server) {
  const target = `${server.username}@${server.host}:${server.port}`;
  const parts = [`${server.alias}`, target, `auth=${server.auth}`];
  if (server.proxyJump) parts.push(`jump=${server.proxyJump}`);
  if (server.description) parts.push(server.description);
  return parts.join('  ');
}

function formatServerDetails(server) {
  const lines = [
    `${server.alias}`,
    `  target: ${server.username}@${server.host}:${server.port}`,
    `  auth: ${server.auth}`,
  ];
  if (server.description) lines.push(`  description: ${server.description}`);
  if (server.tags.length > 0) lines.push(`  tags: ${server.tags.join(', ')}`);
  if (server.proxyJump) lines.push(`  proxyJump: ${server.proxyJump}`);
  if (server.keyPath) lines.push(`  keyPath: ${server.keyPath}`);
  if (server.keyEmbedded) lines.push('  keyEmbedded: yes');
  lines.push(`  updatedAt: ${server.updatedAt}`);
  return lines.join('\n');
}

function formatDaemonLine(daemon) {
  if (!daemon.running) {
    return `${daemon.alias}: stopped${daemon.stale ? ' (stale entry removed)' : ''}`;
  }
  return `${daemon.alias}: running pid=${daemon.pid} active=${daemon.active} idle=${daemon.idleForSeconds}s uptime=${daemon.uptimeSeconds}s`;
}

function formatExecResult(value) {
  const lines = [
    `${value.alias} exec ${value.mode} reused=${value.reusedConnection ?? false} exit=${value.exitCode}`,
  ];
  if (value.signal) lines[0] += ` signal=${value.signal}`;
  if (value.stdout) lines.push(value.stdout.replace(/\s+$/u, ''));
  if (value.stderr) lines.push(`stderr:\n${value.stderr.replace(/\s+$/u, '')}`);
  return lines.join('\n');
}

function shellTokens(segment) {
  const tokens = [];
  let token = '';
  let quote = null;
  let escaping = false;

  for (const ch of segment) {
    if (escaping) {
      token += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else token += ch;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }
    token += ch;
  }

  if (token) tokens.push(token);
  return tokens;
}

function commandSegments(command) {
  return String(command).split(/\n|&&|\|\||[;|]/u).map((part) => part.trim()).filter(Boolean);
}

function stripCommandWrappers(tokens) {
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index])) index += 1;

  while (index < tokens.length && ['sudo', 'doas', 'env', 'command', 'builtin', 'time'].includes(tokens[index])) {
    const wrapper = tokens[index];
    index += 1;
    while (index < tokens.length && tokens[index].startsWith('-')) {
      const option = tokens[index];
      index += 1;
      if (wrapper === 'sudo' && /^-(?:u|g|h|p|C|T|t|U)$/u.test(option) && index < tokens.length) {
        index += 1;
      }
    }
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index])) index += 1;
  }

  return tokens.slice(index);
}

function rmTargets(args) {
  const targets = [];
  let afterDoubleDash = false;
  for (const arg of args) {
    if (afterDoubleDash) {
      targets.push(arg);
      continue;
    }
    if (arg === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (!arg.startsWith('-')) targets.push(arg);
  }
  return targets;
}

function isRootRmTarget(target) {
  return ['/', '/*', '/.', '/./'].includes(String(target).replace(/\/+$/u, '/'));
}

function hasRecursiveForceRm(args) {
  const shortOptions = args.filter((arg) => /^-[^-]/u.test(arg)).join('');
  const recursive = /r/iu.test(shortOptions) || args.includes('--recursive');
  const force = /f/iu.test(shortOptions) || args.includes('--force');
  return recursive && force;
}

function isForbiddenRootRemoval(command, depth = 0) {
  if (depth > 2) return false;
  for (const segment of commandSegments(command)) {
    const tokens = stripCommandWrappers(shellTokens(segment));
    if (tokens.length === 0) continue;

    const commandName = path.basename(tokens[0]);
    const args = tokens.slice(1);
    if (['bash', 'sh', 'dash', 'zsh'].includes(commandName) && args.includes('-c')) {
      const payload = args[args.indexOf('-c') + 1] || '';
      if (isForbiddenRootRemoval(payload, depth + 1)) return true;
    }
    if (commandName === 'rm' && hasRecursiveForceRm(args) && rmTargets(args).some(isRootRmTarget)) {
      return true;
    }
  }
  return false;
}

function assertNoForbiddenRootRemoval(command) {
  if (isForbiddenRootRemoval(command)) {
    throw new Error('Blocked forbidden remote command: rm -rf / is not allowed.');
  }
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(DATA_DIR, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonSecure(file, value) {
  ensureStorage();
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(temp, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
  fs.renameSync(temp, file);
}

function loadConfig() {
  return readJson(CONFIG_PATH, { version: 1, servers: {} });
}

function noServersMessage() {
  return fs.existsSync(CONFIG_PATH)
    ? 'No servers configured.'
    : `No servers configured: ${CONFIG_PATH} does not exist. Run LearnSSH from the project root.`;
}

function saveConfig(config) {
  writeJsonSecure(CONFIG_PATH, config);
}

function loadVault() {
  return readJson(VAULT_PATH, { version: 1, secrets: {} });
}

function saveVault(vault) {
  writeJsonSecure(VAULT_PATH, vault);
}

function vaultHasEncryptedSecrets() {
  if (!fs.existsSync(VAULT_PATH)) return false;
  const vault = loadVault();
  return Boolean(vault.secrets && typeof vault.secrets === 'object' && Object.keys(vault.secrets).length > 0);
}

function validateAlias(alias) {
  if (!alias || !/^[\p{L}\p{N}._-]{1,80}$/u.test(alias)) {
    throw new Error('Alias must be 1-80 characters: Unicode letters, digits, dot, underscore, or dash');
  }
}

function validateAliasDirectoryName(alias) {
  validateAlias(alias);
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
  if (alias === '.' || alias === '..' || alias.endsWith('.') || windowsReserved.test(alias)) {
    throw new Error('Alias must be a safe cross-platform directory name: not . or .., no trailing dot, and not a Windows reserved name');
  }
}

function aliasDirectoryKey(alias) {
  return alias.normalize('NFC').toLocaleLowerCase('en-US');
}

function findAliasDirectoryConflict(servers, alias) {
  const key = aliasDirectoryKey(alias);
  return Object.keys(servers || {}).find((configured) => (
    configured !== alias && aliasDirectoryKey(configured) === key
  ));
}

function requireKnownAlias(alias) {
  validateAliasDirectoryName(alias);
  const config = loadConfig();
  if (!config.servers || !config.servers[alias]) {
    throw new Error(`Unknown alias: ${alias}`);
  }
  const conflict = findAliasDirectoryConflict(config.servers, alias);
  if (conflict) {
    throw new Error(`Alias conflicts with existing alias on case-insensitive filesystems: ${conflict}`);
  }
}

function asPort(value, fallback = 22) {
  if (typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Invalid port: ${value}`);
  }
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function asTimeoutMs(value, fallbackSeconds = 30) {
  if (typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Invalid timeout seconds: ${value}`);
  }
  const seconds = value === undefined ? fallbackSeconds : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid timeout seconds: ${value}`);
  }
  return Math.ceil(seconds * 1000);
}

function asIdleTimeoutMs(value, fallbackSeconds = 3600) {
  if (typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Invalid idle timeout seconds: ${value}`);
  }
  const seconds = value === undefined ? fallbackSeconds : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Invalid idle timeout seconds: ${value}`);
  }
  return Math.ceil(seconds * 1000);
}

function daemonId(alias) {
  return crypto.createHash('sha256').update(alias).digest('hex').slice(0, 24);
}

function daemonInfoPath(alias) {
  return path.join(DATA_DIR, `daemon-${daemonId(alias)}.json`);
}

function readDaemonInfo(alias) {
  const file = daemonInfoPath(alias);
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file, null);
  } catch {
    return null;
  }
}

function writeDaemonInfo(alias, info) {
  writeJsonSecure(daemonInfoPath(alias), info);
}

function removeDaemonInfo(alias) {
  try {
    fs.unlinkSync(daemonInfoPath(alias));
  } catch {
    // Already gone.
  }
}

function parseTags(value) {
  if (!value) return [];
  return String(value).split(',').map((tag) => tag.trim()).filter(Boolean);
}

function readStdinText() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      // Normalize a leading UTF-8 BOM and CRLF after the source shell sends
      // UTF-8. PowerShell 5.1 needs $OutputEncoding set before piping: its
      // default ASCII encoding turns a BOM into '?' before stdin receives it.
      const normalized = data.replace(/^\uFEFF+/u, '').replace(/\r\n/g, '\n');
      resolve(normalized.replace(/\s+$/u, ''));
    });
    process.stdin.on('error', reject);
  });
}

function requireNoSecretFlags(opts) {
  const forbidden = ['password', 'passphrase', 'privateKey', 'secret'];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(opts, key)) {
      throw new Error(`Do not pass ${key} as a flag; use the secure terminal prompt`);
    }
  }
}

function commandExists(name) {
  const result = spawnSync(name, ['-h'], { stdio: 'ignore' });
  return result.status === 0 || result.status === 1 || result.status === 2;
}

function keychainGet() {
  if (process.platform !== 'darwin' || !commandExists('security')) return null;
  const result = spawnSync('security', [
    'find-generic-password',
    '-a',
    os.userInfo().username,
    '-s',
    keychainService(),
    '-w',
  ], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

function keychainSet(value) {
  const result = spawnSync('security', [
    'add-generic-password',
    '-a',
    os.userInfo().username,
    '-s',
    keychainService(),
    '-w',
    value,
    '-U',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Unable to write macOS Keychain item: ${result.stderr.trim()}`);
  }
}

function decodeMasterKey(value) {
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== 32) {
    throw new Error('Master key must be base64-encoded 32 bytes');
  }
  return buf;
}

function localKeyGet() {
  if (!fs.existsSync(LOCAL_KEY_PATH)) return null;
  return fs.readFileSync(LOCAL_KEY_PATH, 'utf8').trim();
}

function localKeySet(value) {
  ensureStorage();
  fs.writeFileSync(LOCAL_KEY_PATH, `${value}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(LOCAL_KEY_PATH, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
}

function getMasterKey({ create = false, forceLocal = false } = {}) {
  if (process.env.SSH_NODE_OPS_MASTER_KEY) {
    return { key: decodeMasterKey(process.env.SSH_NODE_OPS_MASTER_KEY), provider: 'env:SSH_NODE_OPS_MASTER_KEY' };
  }

  if (!forceLocal) {
    const keychainValue = keychainGet();
    if (keychainValue) {
      return { key: decodeMasterKey(keychainValue), provider: 'macos-keychain' };
    }
  }

  const localValue = localKeyGet();
  if (localValue) {
    return { key: decodeMasterKey(localValue), provider: 'local-file' };
  }

  if (!create) {
    throw new Error('Secure storage is not initialized. Run: learn-ssh init');
  }

  if (vaultHasEncryptedSecrets()) {
    throw new Error(`Encrypted credentials exist in ${VAULT_PATH}, but no master key is available. Restore master.key, the macOS Keychain entry, or SSH_NODE_OPS_MASTER_KEY; refusing to generate a new key`);
  }

  const value = crypto.randomBytes(32).toString('base64');
  if (process.platform === 'darwin' && !forceLocal) {
    keychainSet(value);
    return { key: decodeMasterKey(value), provider: 'macos-keychain' };
  }

  localKeySet(value);
  return { key: decodeMasterKey(value), provider: 'local-file' };
}

function encryptObject(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const input = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptObject(envelope, key) {
  if (!envelope || envelope.alg !== 'aes-256-gcm') {
    throw new Error('Unsupported secret envelope');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

async function promptHidden(label) {
  if (!process.stdin.isTTY) {
    throw new Error('Secret prompts require an interactive terminal');
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const decoder = new StringDecoder('utf8');
    let value = '';

    function cleanup() {
      stdin.off('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      process.stdout.write('\n');
    }

    function onData(chunk) {
      const text = decoder.write(chunk);
      for (const ch of text) {
        if (ch === '\u0003') {
          cleanup();
          reject(new Error('Interrupted'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    }

    process.stdout.write(label);
    stdin.resume();
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

async function promptConfirmedSecret(label) {
  const first = await promptHidden(label);
  const second = await promptHidden(`Confirm ${label}`);
  if (first !== second) {
    throw new Error('Secret confirmation did not match');
  }
  if (!first) throw new Error('Secret cannot be empty');
  return first;
}

function gitignoreHasEntry(existing, entry) {
  return existing.split(/\r?\n/).some((line) => line.trim() === entry);
}

function ensureProjectGitignore() {
  const entry = '.learn-ssh/';
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  }
  if (gitignoreHasEntry(existing, entry)) return { entry, added: false };
  const addition = existing && !existing.endsWith('\n') ? `\n${entry}\n` : `${entry}\n`;
  fs.appendFileSync(gitignorePath, addition);
  return { entry, added: true };
}

async function initCommand(opts) {
  ensureStorage();
  const provider = getMasterKey({ create: true, forceLocal: Boolean(opts.localKey) }).provider;
  if (!fs.existsSync(CONFIG_PATH)) saveConfig(loadConfig());
  if (!fs.existsSync(VAULT_PATH)) saveVault(loadVault());
  const gitignore = ensureProjectGitignore();
  const result = {
    success: true,
    storageDir: DATA_DIR,
    configPath: CONFIG_PATH,
    vaultPath: VAULT_PATH,
    masterKeyProvider: provider,
    projectLocal: true,
    gitignoreEntry: gitignore.entry,
    gitignoreAdded: gitignore.added,
  };
  printResult(opts, result, (value) => {
    const lines = [
      `Initialized project-local secure storage (${value.masterKeyProvider})`,
      `storage: ${value.storageDir}`,
      `config: ${value.configPath}`,
      `vault: ${value.vaultPath}`,
    ];
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    lines.push(value.gitignoreAdded
      ? `gitignore: added ${value.gitignoreEntry} to ${gitignorePath}`
      : `gitignore: ${gitignorePath} already contains ${value.gitignoreEntry}`);
    return lines.join('\n');
  });
}

async function addCommand(opts) {
  requireNoSecretFlags(opts);
  const alias = opts.alias;
  if (!alias) throw new Error('--alias is required. Run learn-ssh add --help.');
  validateAliasDirectoryName(alias);
  if (!opts.host) throw new Error('--host is required. Run learn-ssh add --help.');
  const username = opts.user || opts.username;
  if (!username) throw new Error('--user is required. Run learn-ssh add --help.');
  const auth = opts.auth;
  if (!auth) throw new Error('--auth is required. Use password, key, or agent. Run learn-ssh add --help.');
  if (!['password', 'key', 'agent'].includes(auth)) {
    throw new Error('--auth is the authentication mode, not the SSH password. Use --auth password, then type the real password into the hidden terminal prompt. Allowed values: password, key, agent');
  }
  const port = asPort(opts.port, 22);

  const config = loadConfig();
  const directoryConflict = findAliasDirectoryConflict(config.servers, alias);
  if (directoryConflict) {
    throw new Error(`Alias conflicts with existing alias on case-insensitive filesystems: ${directoryConflict}`);
  }
  const oldServer = config.servers[alias];
  const exists = Boolean(oldServer);
  if (exists && !opts.update) {
    throw new Error(`Alias already exists: ${alias}. Use --update to replace it.`);
  }

  const secret = {};
  let hasNewSecret = false;
  let keyPath = opts.keyPath ? expandHome(String(opts.keyPath)) : undefined;
  let keyEmbedded = false;

  if (auth === 'password') {
    secret.password = await promptConfirmedSecret('SSH password: ');
    hasNewSecret = true;
  }

  if (auth === 'key') {
    if (opts.embedKey) {
      if (!keyPath) throw new Error('--key-path is required with --embed-key');
      secret.privateKey = fs.readFileSync(keyPath, 'utf8');
      hasNewSecret = true;
      keyEmbedded = true;
      keyPath = undefined;
    } else if (!keyPath && !(exists && config.servers[alias].keyEmbedded)) {
      throw new Error('--key-path is required for key auth unless an existing embedded key is being updated');
    }

    if (opts.askPassphrase) {
      secret.passphrase = await promptConfirmedSecret('SSH key passphrase: ');
      hasNewSecret = true;
    }
  }

  if (auth === 'agent' && opts.keyPath) {
    throw new Error('--key-path is not used with agent auth');
  }

  const now = new Date().toISOString();
  config.version = 1;
  config.servers[alias] = {
    alias,
    host: String(opts.host),
    port,
    username: String(username),
    auth,
    description: opts.description ? String(opts.description) : '',
    tags: parseTags(opts.tags),
    proxyJump: opts.proxyJump ? String(opts.proxyJump) : '',
    keyPath: keyPath || '',
    keyEmbedded: keyEmbedded || Boolean(exists && config.servers[alias].keyEmbedded && !keyPath),
    createdAt: exists ? config.servers[alias].createdAt : now,
    updatedAt: now,
  };

  const vault = loadVault();
  if (hasNewSecret) {
    const { key } = getMasterKey({ create: true });
    const oldSecret = exists && oldServer.auth === auth && vault.secrets[alias]
      ? decryptObject(vault.secrets[alias], key)
      : {};
    vault.secrets[alias] = encryptObject({ ...oldSecret, ...secret }, key);
  } else if (!exists || oldServer.auth !== auth) {
    delete vault.secrets[alias];
  }

  saveConfig(config);
  saveVault(vault);
  const result = {
    success: true,
    alias,
    auth,
    secretWritten: hasNewSecret,
    keyEmbedded: config.servers[alias].keyEmbedded,
  };
  printResult(opts, result, (value) => {
    const action = exists ? 'Updated' : 'Added';
    const secret = value.secretWritten ? 'secret written' : 'no new secret';
    return `${action} ${value.alias} auth=${value.auth} ${secret} keyEmbedded=${value.keyEmbedded ? 'yes' : 'no'}`;
  });
}

function sanitizeServer(server) {
  return {
    alias: server.alias,
    host: server.host,
    port: server.port,
    username: server.username,
    auth: server.auth,
    description: server.description,
    tags: server.tags || [],
    proxyJump: server.proxyJump || '',
    keyPath: server.keyPath ? '[configured]' : '',
    keyEmbedded: Boolean(server.keyEmbedded),
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

async function listCommand(opts) {
  const config = loadConfig();
  const aliases = Object.keys(config.servers).sort();
  const result = {
    success: true,
    storageInitialized: fs.existsSync(CONFIG_PATH),
    count: aliases.length,
    servers: aliases.map((alias) => sanitizeServer(config.servers[alias])),
  };
  printResult(opts, result, (value) => {
    if (value.count === 0) return noServersMessage();
    return [`${value.count} server(s):`, ...value.servers.map((server) => `- ${formatServerLine(server)}`)].join('\n');
  });
}

async function showCommand(alias, opts) {
  validateAlias(alias);
  const config = loadConfig();
  const server = config.servers[alias];
  if (!server) throw new Error(`Alias not found: ${alias}`);
  printResult(opts, { success: true, server: sanitizeServer(server) }, (value) => formatServerDetails(value.server));
}

async function removeCommand(alias, opts) {
  validateAlias(alias);
  const config = loadConfig();
  const vault = loadVault();
  const existed = Boolean(config.servers[alias]);
  delete config.servers[alias];
  delete vault.secrets[alias];
  saveConfig(config);
  saveVault(vault);
  printResult(opts, { success: true, alias, removed: existed }, (value) => (
    value.removed ? `Removed alias: ${value.alias}` : `Alias already absent: ${value.alias}`
  ));
}

function getSecret(alias) {
  const vault = loadVault();
  const envelope = vault.secrets[alias];
  if (!envelope) return {};
  const { key } = getMasterKey();
  return decryptObject(envelope, key);
}

async function loadSsh2() {
  try {
    const mod = await import('ssh2');
    return mod.Client;
  } catch (err) {
    throw new Error(`Missing dependency ssh2. Run: npm install --prefix ${SCRIPT_DIR}`);
  }
}

async function buildConnectOptions(server) {
  const secret = getSecret(server.alias);
  const options = {
    host: server.host,
    port: server.port || 22,
    username: server.username,
    readyTimeout: 30000,
    keepaliveInterval: 15000,
  };

  if (server.auth === 'password') {
    if (!secret.password) throw new Error(`Missing encrypted password for alias: ${server.alias}`);
    options.password = secret.password;
  } else if (server.auth === 'key') {
    if (secret.privateKey) {
      options.privateKey = secret.privateKey;
    } else if (server.keyPath) {
      options.privateKey = fs.readFileSync(expandHome(server.keyPath));
    } else {
      throw new Error(`Missing private key for alias: ${server.alias}`);
    }
    if (secret.passphrase) options.passphrase = secret.passphrase;
  } else if (server.auth === 'agent') {
    if (process.platform === 'win32') {
      options.agent = process.env.SSH_AUTH_SOCK || 'pageant';
    } else {
      if (!process.env.SSH_AUTH_SOCK) throw new Error('SSH_AUTH_SOCK is not set for agent auth');
      options.agent = process.env.SSH_AUTH_SOCK;
    }
  } else {
    throw new Error(`Unsupported auth type: ${server.auth}`);
  }

  return options;
}

async function connectAlias(alias, context = { clients: [], stack: [] }) {
  validateAlias(alias);
  if (context.stack.includes(alias)) {
    throw new Error(`ProxyJump cycle detected: ${[...context.stack, alias].join(' -> ')}`);
  }
  const config = loadConfig();
  const server = config.servers[alias];
  if (!server) throw new Error(`Alias not found: ${alias}`);

  const Client = await loadSsh2();
  const options = await buildConnectOptions(server);

  if (server.proxyJump) {
    const jump = await connectAlias(server.proxyJump, {
      clients: context.clients,
      stack: [...context.stack, alias],
    });
    const stream = await forwardOut(jump, server.host, server.port || 22);
    delete options.host;
    delete options.port;
    options.sock = stream;
  }

  const client = new Client();
  context.clients.push(client);
  await new Promise((resolve, reject) => {
    let settled = false;
    client.once('ready', () => {
      settled = true;
      resolve();
    });
    client.once('error', (err) => {
      if (!settled) reject(err);
    });
    client.connect(options);
  });
  return client;
}

function closeClients(context) {
  for (const client of [...context.clients].reverse()) {
    try {
      client.end();
    } catch {
      // Ignore cleanup errors.
    }
  }
}

function forwardOut(client, host, port) {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err) reject(err);
      else resolve(stream);
    });
  });
}

function daemonRequest(alias, action, payload = {}, timeoutMs = 5000) {
  const info = readDaemonInfo(alias);
  if (!info || !info.port || !info.token) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: info.port });
    let data = '';
    let settled = false;

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    }

    const timer = setTimeout(() => {
      finish(new Error(`Daemon request timed out for alias: ${alias}`));
    }, timeoutMs);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: info.token, action, ...payload })}\n`);
    });
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => {
      try {
        finish(null, JSON.parse(data));
      } catch (err) {
        finish(err);
      }
    });
    socket.on('error', (err) => {
      removeDaemonInfo(alias);
      finish(err);
    });
  });
}

async function pingDaemon(alias) {
  try {
    const response = await daemonRequest(alias, 'ping');
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}

// SSH connect can exceed 10s on slow links; keep parent waiting long enough.
const DAEMON_START_TIMEOUT_MS = 60000;

function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore.
    }
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore.
    }
  }
}

function quoteWindowsCommandArg(arg) {
  const value = String(arg);
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

// Spawn the daemon so it does NOT inherit the caller's pipe handles.
//
// On Windows, when the CLI chain is started by PowerShell with piped output
// (as agent tools do), the pipe handles are inheritable and get copied into
// every descendant created via CreateProcess(bInheritHandles=TRUE) - which is
// how Node's spawn works, regardless of `stdio: 'ignore'`. A long-lived daemon
// then keeps the pipe write end open, the tool never sees EOF and "loads"
// forever. Verified fix: create the daemon via PowerShell Start-Process
// (ShellExecute path, bInheritHandles=FALSE), so its handle table never
// contains the caller's pipes.
function spawnDaemonViaStartProcess(args, startupErrorFile) {
  const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const argLine = args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
  const script = [
    `$env:LEARN_SSH_DAEMON_STARTUP_ERROR_FILE = ${psQuote(startupErrorFile)}`,
    `$p = Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(argLine)} -WorkingDirectory ${psQuote(path.dirname(DATA_DIR))} -WindowStyle Hidden -PassThru`,
    'if ($null -eq $p) { exit 1 }',
    'Write-Output $p.Id',
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  );
  const pid = Number.parseInt(String(result.stdout || '').trim(), 10);
  if (result.status === 0 && Number.isFinite(pid) && pid > 0) {
    return {
      pid,
      kill() {
        killProcessTree(pid);
      },
    };
  }
  return null;
}

function spawnDetachedDaemon(args, startupErrorFile) {
  if (process.platform === 'win32') {
    const viaStartProcess = spawnDaemonViaStartProcess(args, startupErrorFile);
    if (viaStartProcess) return viaStartProcess;
    process.stderr.write('learn-ssh: Start-Process launch failed, falling back to plain spawn (cold start may keep the calling tool busy)\n');
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LEARN_SSH_DAEMON_STARTUP_ERROR_FILE: startupErrorFile },
    cwd: path.dirname(DATA_DIR),
    windowsHide: true,
  });
  child.unref();
  return {
    pid: child.pid,
    kill() {
      killProcessTree(child.pid);
    },
  };
}

async function startDaemon(alias, idleTimeoutSeconds) {
  if (await pingDaemon(alias)) return { reused: true };

  removeDaemonInfo(alias);
  const args = [
    __filename,
    'daemon',
    'serve',
    alias,
    '--idle-timeout',
    String(idleTimeoutSeconds),
  ];
  ensureStorage();
  const startupErrorFile = path.join(DATA_DIR, `daemon-startup-${daemonId(alias)}-${process.pid}-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(startupErrorFile, '', { mode: 0o600, flag: 'wx' });
  const startupError = () => {
    try {
      return fs.readFileSync(startupErrorFile, 'utf8').trim().slice(0, 1000);
    } catch {
      return '';
    }
  };

  try {
    const child = spawnDetachedDaemon(args, startupErrorFile);
    const startedAt = Date.now();
    const deadline = startedAt + DAEMON_START_TIMEOUT_MS;
    let lastError = null;
    let lastProgressAt = 0;
    process.stderr.write(`learn-ssh: starting daemon for ${alias} (pid=${child.pid || '?'})...\n`);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (child.pid && !isPidAlive(child.pid)) {
        removeDaemonInfo(alias);
        const reason = startupError();
        throw new Error(`Unable to start daemon for alias: ${alias} (process exited early${reason ? `: ${reason}` : ''})`);
      }
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsedSec > 0 && elapsedSec % 5 === 0 && elapsedSec !== lastProgressAt) {
        lastProgressAt = elapsedSec;
        process.stderr.write(`learn-ssh: waiting for daemon ${alias}... ${elapsedSec}s\n`);
      }
      try {
        if (await pingDaemon(alias)) {
          process.stderr.write(`learn-ssh: daemon ready for ${alias} (${elapsedSec}s)\n`);
          return { reused: false };
        }
      } catch (err) {
        lastError = err;
      }
    }

    try {
      child.kill();
    } catch {
      // Best effort.
    }
    removeDaemonInfo(alias);
    const reason = startupError() || lastError?.message;
    throw new Error(`Unable to start daemon for alias: ${alias}${reason ? ` (${reason})` : ''}`);
  } finally {
    fs.rmSync(startupErrorFile, { force: true });
  }
}

// Wrap a command so the remote shell loads the full login + interactive
// environment (bashrc / profile / nvm / uv / sdkman ...), mirroring a real SSH
// login. sshd runs `exec` requests in a non-interactive, non-login shell, so
// ~/.bashrc's non-interactive early-return would skip nvm/uv setup. `bash -lic`
// forces login + interactive, loading the whole rc chain. The command is single
// quoted (inner quotes escaped) so it reaches the inner bash verbatim.
function wrapLoginShell(command) {
  const escaped = String(command).replace(/'/gu, "'\\''");
  return `bash -lic '${escaped}'`;
}

// `bash -lic` under a non-tty SSH exec prints harmless job-control warnings to
// stderr ("cannot set terminal process group" / "no job control in this
// shell" / "tcsetattr: Inappropriate ioctl for device"). Strip them so they
// don't pollute every exec result.
function filterLoginShellNoise(stderr) {
  if (!stderr) return stderr;
  const filtered = stderr
    .split('\n')
    .filter((line) => !/cannot set terminal process group|no job control in this shell|tcsetattr: Inappropriate ioctl for device/u.test(line))
    .join('\n');
  return filtered.replace(/\n+$/u, '');
}

function execRemote(client, command, timeoutMs, options = {}) {
  const login = options.login !== false;
  const remoteCommand = login ? wrapLoginShell(command) : command;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let exitCode = null;
    let signal = null;
    let streamRef = null;

    const timer = timeoutMs > 0 ? setTimeout(() => {
      try {
        if (streamRef) streamRef.signal('TERM');
      } catch {
        // Best effort.
      }
      reject(new Error(`Remote command timed out after ${timeoutMs} ms. Use --timeout <seconds> to allow more time (e.g. --timeout ${Math.max(300, Math.ceil(timeoutMs / 1000) * 2)}).`));
    }, timeoutMs) : null;

    client.exec(remoteCommand, (err, stream) => {
      if (err) {
        if (timer) clearTimeout(timer);
        reject(err);
        return;
      }
      streamRef = stream;
      stream.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      stream.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });
      stream.on('exit', (code, sig) => {
        exitCode = code;
        signal = sig || null;
      });
      stream.on('close', (code, sig) => {
        if (timer) clearTimeout(timer);
        resolve({
          exitCode: exitCode ?? code ?? 0,
          signal: signal || sig || null,
          stdout,
          stderr: login ? filterLoginShellNoise(stderr) : stderr,
        });
      });
    });
  });
}

async function daemonServeCommand(alias, opts) {
  requireKnownAlias(alias);
  const idleTimeoutMs = asIdleTimeoutMs(opts.idleTimeout);
  const context = { clients: [], stack: [] };
  const token = crypto.randomBytes(32).toString('base64url');
  const startedAt = Date.now();
  let lastActivity = startedAt;
  let active = 0;
  let stopping = false;
  let idleTimer = null;
  let server = null;

  function touch() {
    lastActivity = Date.now();
  }

  function send(socket, value, after) {
    socket.end(JSON.stringify(value), after);
  }

  function stop(reason = 'stopped') {
    if (stopping) return;
    stopping = true;
    if (idleTimer) clearInterval(idleTimer);
    removeDaemonInfo(alias);
    closeClients(context);
    if (server) {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    } else {
      process.exit(0);
    }
  }

  const client = await connectAlias(alias, context);
  for (const sshClient of context.clients) {
    sshClient.on('error', () => stop('ssh-error'));
    sshClient.on('end', () => stop('ssh-end'));
    sshClient.on('close', () => stop('ssh-close'));
  }

  server = net.createServer((socket) => {
    let data = '';
    let handled = false;
    socket.setEncoding('utf8');
    async function handleRequest(raw) {
      if (handled) return;
      handled = true;
      let request;
      try {
        request = JSON.parse(raw);
      } catch {
        send(socket, { ok: false, error: 'Invalid daemon request' });
        return;
      }

      if (request.token !== token) {
        send(socket, { ok: false, error: 'Unauthorized daemon request' });
        return;
      }

      if (request.action === 'ping') {
        send(socket, { ok: true });
        return;
      }

      if (request.action === 'status') {
        send(socket, {
          ok: true,
          status: {
            alias,
            pid: process.pid,
            active,
            idleTimeoutSeconds: idleTimeoutMs / 1000,
            idleForSeconds: Math.max(0, Math.floor((Date.now() - lastActivity) / 1000)),
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            startedAt: new Date(startedAt).toISOString(),
            lastActivityAt: new Date(lastActivity).toISOString(),
          },
        });
        return;
      }

      if (request.action === 'stop') {
        send(socket, { ok: true, stopped: true }, () => stop('requested'));
        return;
      }

      if (request.action === 'exec') {
        if (!request.command) {
          send(socket, { ok: false, error: 'Remote command is required' });
          return;
        }

        active += 1;
        touch();
        try {
          const result = await execRemote(client, String(request.command), Number(request.timeoutMs) || 30000, { login: request.login !== false });
          touch();
          send(socket, { ok: true, result });
        } catch (err) {
          touch();
          send(socket, { ok: false, error: err.message });
        } finally {
          active -= 1;
        }
        return;
      }

      send(socket, { ok: false, error: `Unknown daemon action: ${request.action}` });
    }

    socket.on('data', (chunk) => {
      data += chunk;
      const newlineIndex = data.indexOf('\n');
      if (newlineIndex >= 0) {
        const raw = data.slice(0, newlineIndex);
        handleRequest(raw);
      }
    });
    socket.on('end', () => {
      if (!handled && data.trim()) {
        handleRequest(data.trim());
      }
    });
    socket.on('error', () => {
      // Ignore per-request socket failures.
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  writeDaemonInfo(alias, {
    alias,
    pid: process.pid,
    port: address.port,
    token,
    idleTimeoutSeconds: idleTimeoutMs / 1000,
    startedAt: new Date(startedAt).toISOString(),
  });
  delete process.env.LEARN_SSH_DAEMON_STARTUP_ERROR_FILE;

  if (idleTimeoutMs > 0) {
    idleTimer = setInterval(() => {
      if (active === 0 && Date.now() - lastActivity >= idleTimeoutMs) {
        stop('idle-timeout');
      }
    }, Math.min(idleTimeoutMs, 60000));
    idleTimer.unref?.();
  }

  process.on('SIGINT', () => stop('signal'));
  process.on('SIGTERM', () => stop('signal'));
}

async function execViaDaemon(alias, command, opts) {
  const timeoutMs = asTimeoutMs(opts.timeout);
  const daemonIdleTimeoutMs = asIdleTimeoutMs(opts.daemonIdleTimeout);
  const start = await startDaemon(alias, daemonIdleTimeoutMs / 1000);
  const response = await daemonRequest(alias, 'exec', { command, timeoutMs, login: !opts.noLogin }, timeoutMs + 5000);
  if (!response) throw new Error(`Daemon did not respond for alias: ${alias}`);
  if (!response.ok) throw new Error(response.error || `Daemon exec failed for alias: ${alias}`);
  return { result: response.result, reused: start.reused };
}

async function execCommand(alias, command, opts) {
  if (!String(command || '').trim()) {
    const source = opts.stdin ? 'standard input with --stdin'
      : opts.command !== undefined ? '--command'
        : 'after --';
    throw new Error(`Remote command is required ${source}. Run learn-ssh exec --help.`);
  }
  assertNoForbiddenRootRemoval(command);
  if (!opts.noDaemon) {
    const { result, reused } = await execViaDaemon(alias, command, opts);
    const value = {
      success: result.exitCode === 0,
      alias,
      mode: 'daemon',
      reusedConnection: reused,
      command,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    printResult(opts, value, formatExecResult);
    process.exit(result.exitCode === 0 ? 0 : 1);
  }

  const context = { clients: [], stack: [] };
  try {
    const client = await connectAlias(alias, context);
    const timeoutMs = asTimeoutMs(opts.timeout);
    const result = await execRemote(client, command, timeoutMs, { login: !opts.noLogin });
    const value = {
      success: result.exitCode === 0,
      alias,
      mode: 'direct',
      reusedConnection: false,
      command,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    printResult(opts, value, formatExecResult);
    process.exit(result.exitCode === 0 ? 0 : 1);
  } finally {
    closeClients(context);
  }
}

function sftpSession(client) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

function sftpFastPut(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function sftpFastGet(sftp, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function uploadCommand(alias, localPath, remotePath, opts) {
  if (!localPath || !remotePath) throw new Error('upload requires <local-path> and <remote-path>');
  const resolvedLocal = path.resolve(expandHome(localPath));
  if (!fs.existsSync(resolvedLocal) || !fs.statSync(resolvedLocal).isFile()) {
    throw new Error(`Local file not found: ${localPath}`);
  }
  const context = { clients: [], stack: [] };
  try {
    const client = await connectAlias(alias, context);
    const sftp = await sftpSession(client);
    try {
      await sftpFastPut(sftp, resolvedLocal, remotePath);
    } finally {
      sftp.end();
    }
    printResult(opts, { success: true, alias, localPath: resolvedLocal, remotePath }, (value) => (
      `Uploaded ${value.localPath} -> ${value.alias}:${value.remotePath}`
    ));
  } finally {
    closeClients(context);
  }
}

async function downloadCommand(alias, remotePath, localPath, opts) {
  if (!remotePath || !localPath) throw new Error('download requires <remote-path> and <local-path>');
  const resolvedLocal = path.resolve(expandHome(localPath));
  fs.mkdirSync(path.dirname(resolvedLocal), { recursive: true });
  const context = { clients: [], stack: [] };
  try {
    const client = await connectAlias(alias, context);
    const sftp = await sftpSession(client);
    try {
      await sftpFastGet(sftp, remotePath, resolvedLocal);
    } finally {
      sftp.end();
    }
    printResult(opts, { success: true, alias, remotePath, localPath: resolvedLocal }, (value) => (
      `Downloaded ${value.alias}:${value.remotePath} -> ${value.localPath}`
    ));
  } finally {
    closeClients(context);
  }
}

async function tunnelCommand(alias, opts) {
  if (!opts.localPort || !opts.remotePort) {
    throw new Error('tunnel requires --local-port and --remote-port');
  }
  const localPort = asPort(opts.localPort);
  const remotePort = asPort(opts.remotePort);
  const localHost = opts.localHost ? String(opts.localHost) : '127.0.0.1';
  const remoteHost = opts.remoteHost ? String(opts.remoteHost) : '127.0.0.1';
  const idleTimeoutMs = asIdleTimeoutMs(opts.idleTimeout);
  const context = { clients: [], stack: [] };
  let client;
  try {
    client = await connectAlias(alias, context);
  } catch (err) {
    closeClients(context);
    throw err;
  }

  const sockets = new Set();
  let lastActivity = Date.now();
  let idleTimer = null;
  let stopping = false;

  function touch() {
    lastActivity = Date.now();
  }

  function reportForwardError(err) {
    const error = err instanceof Error ? err.message : String(err);
    const message = `Tunnel forwarding failed (${remoteHost}:${remotePort}): ${error}`;
    if (wantsJson(opts)) {
      printJsonLine({ event: 'forward-error', success: false, alias, localHost, localPort, remoteHost, remotePort, error: message });
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
  }

  const server = net.createServer((socket) => {
    // A client can send its first packet before SSH has opened the direct-tcpip
    // channel. Keep the socket paused so that packet remains buffered until the
    // two streams are piped together.
    socket.pause();
    touch();
    sockets.add(socket);
    let stream = null;
    socket.once('close', () => {
      sockets.delete(socket);
      touch();
      if (stream && !stream.destroyed) stream.destroy();
    });
    socket.on('error', () => {
      if (stream && !stream.destroyed) stream.destroy();
    });

    client.forwardOut(
      socket.remoteAddress || '127.0.0.1',
      socket.remotePort || 0,
      remoteHost,
      remotePort,
      (err, openedStream) => {
        if (err) {
          reportForwardError(err);
          socket.destroy();
          return;
        }
        stream = openedStream;
        if (stopping || socket.destroyed) {
          stream.destroy();
          return;
        }
        touch();
        socket.on('data', touch);
        stream.on('data', touch);
        stream.once('close', () => {
          touch();
          if (!socket.destroyed) socket.destroy();
        });
        stream.on('error', (streamError) => {
          reportForwardError(streamError);
          socket.destroy();
        });
        socket.pipe(stream).pipe(socket);
      },
    );
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(localPort, localHost, resolve);
    });
  } catch (err) {
    closeClients(context);
    throw err;
  }

  const value = {
    success: true,
    alias,
    localHost,
    localPort,
    remoteHost,
    remotePort,
    idleTimeoutSeconds: idleTimeoutMs / 1000,
    message: idleTimeoutMs > 0
      ? 'Tunnel is running until this process is stopped or idle timeout is reached.'
      : 'Tunnel is running until this process is stopped.',
  };
  if (wantsJson(opts)) {
    printJsonLine({ event: 'started', ...value });
  } else {
    printResult(opts, value, (result) => (
      `${result.alias} tunnel ${result.localHost}:${result.localPort} -> ${result.remoteHost}:${result.remotePort} idle=${result.idleTimeoutSeconds}s`
    ));
  }

  const stop = (reason = 'stopped', exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    if (idleTimer) clearInterval(idleTimer);
    for (const socket of sockets) {
      socket.destroy();
    }
    if (wantsJson(opts)) {
      printJsonLine({ event: 'closed', success: exitCode === 0, alias, closed: true, reason });
    } else if (reason === 'idle-timeout') {
      printResult(opts, { success: true, alias, closed: true, reason }, (result) => (
        `${result.alias} tunnel closed: ${result.reason}`
      ));
    }
    server.close();
    closeClients(context);
    process.exit(exitCode);
  };

  client.on('error', (err) => {
    if (stopping) return;
    reportForwardError(new Error(`SSH connection error: ${err.message}`));
    stop('ssh-error', 1);
  });
  client.once('end', () => {
    if (stopping) return;
    reportForwardError(new Error('SSH connection ended'));
    stop('ssh-end', 1);
  });
  client.once('close', () => {
    if (stopping) return;
    reportForwardError(new Error('SSH connection closed'));
    stop('ssh-close', 1);
  });

  if (idleTimeoutMs > 0) {
    idleTimer = setInterval(() => {
      if (sockets.size === 0 && Date.now() - lastActivity >= idleTimeoutMs) {
        stop('idle-timeout');
      }
    }, Math.min(idleTimeoutMs, 60000));
    idleTimer.unref?.();
  }

  process.on('SIGINT', () => stop('signal'));
  process.on('SIGTERM', () => stop('signal'));
}

async function daemonStatus(alias) {
  const info = readDaemonInfo(alias);
  if (!info) {
    return { alias, running: false };
  }

  try {
    const response = await daemonRequest(alias, 'status');
    if (!response || !response.ok) {
      removeDaemonInfo(alias);
      return { alias, running: false, stale: true };
    }
    return { alias, running: true, ...response.status };
  } catch {
    removeDaemonInfo(alias);
    return { alias, running: false, stale: true };
  }
}

async function daemonCommand(opts) {
  const subcommand = opts._[0];
  const alias = opts._[1];

  if (subcommand === 'serve') {
    return daemonServeCommand(alias, opts);
  }

  if (subcommand === 'start') {
    requireKnownAlias(alias);
    const idleTimeoutMs = asIdleTimeoutMs(opts.idleTimeout ?? opts.daemonIdleTimeout);
    const start = await startDaemon(alias, idleTimeoutMs / 1000);
    const status = await daemonStatus(alias);
    printResult(opts, { success: true, action: 'start', reusedConnection: start.reused, status }, (value) => (
      `${value.status.alias}: daemon running reused=${value.reusedConnection}`
    ));
    return;
  }

  if (subcommand === 'status') {
    if (alias) {
      validateAlias(alias);
      printResult(opts, { success: true, daemons: [await daemonStatus(alias)] }, (value) => (
        value.daemons.map(formatDaemonLine).join('\n')
      ));
      return;
    }

    const config = loadConfig();
    const aliases = Object.keys(config.servers).sort();
    const daemons = [];
    for (const configuredAlias of aliases) {
      daemons.push(await daemonStatus(configuredAlias));
    }
    printResult(opts, { success: true, storageInitialized: fs.existsSync(CONFIG_PATH), daemons }, (value) => (
      value.daemons.length > 0 ? value.daemons.map(formatDaemonLine).join('\n') : noServersMessage()
    ));
    return;
  }

  if (subcommand === 'stop') {
    validateAlias(alias);
    try {
      const response = await daemonRequest(alias, 'stop');
      removeDaemonInfo(alias);
      printResult(opts, { success: true, alias, stopped: Boolean(response && response.ok) }, (value) => (
        `${value.alias}: daemon ${value.stopped ? 'stopped' : 'not running'}`
      ));
    } catch {
      removeDaemonInfo(alias);
      printResult(opts, { success: true, alias, stopped: false, staleRemoved: true }, (value) => (
        `${value.alias}: stale daemon entry removed`
      ));
    }
    return;
  }

  throw new Error('daemon requires one of: start, status, stop');
}

async function pathsCommand(opts) {
  let provider = 'uninitialized';
  try {
    provider = getMasterKey().provider;
  } catch {
    // Leave provider as uninitialized.
  }
  const result = {
    success: true,
    scriptDir: SCRIPT_DIR,
    storageDir: DATA_DIR,
    configPath: CONFIG_PATH,
    vaultPath: VAULT_PATH,
    localKeyPath: LOCAL_KEY_PATH,
    masterKeyProvider: provider,
    projectLocal: true,
  };
  printResult(opts, result, (value) => [
    `script: ${value.scriptDir}`,
    `storage: ${value.storageDir}`,
    `config: ${value.configPath}`,
    `vault: ${value.vaultPath}`,
    `localKey: ${value.localKeyPath}`,
    `masterKeyProvider: ${value.masterKeyProvider}`,
    `projectLocal: ${value.projectLocal}`,
  ].join('\n'));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'help') {
    const [topic, ...topicArgs] = rest;
    process.stdout.write(`${topic && topic !== 'help' && topic !== '--help' && topic !== '-h' ? commandUsage(topic, topicArgs) : usage()}\n`);
    return;
  }

  if (requestsHelp(rest)) {
    process.stdout.write(`${commandUsage(command, rest)}\n`);
    return;
  }

  const opts = parseArgs(rest);
  validateCommandArgs(command, opts);

  if (command === 'init') return initCommand(opts);
  if (command === 'add') return addCommand(opts);
  if (command === 'list') return listCommand(opts);
  if (command === 'show') return showCommand(opts._[0], opts);
  if (command === 'remove') return removeCommand(opts._[0], opts);
  if (command === 'daemon') return daemonCommand(opts);
  if (command === 'paths') return pathsCommand(opts);

  if (command === 'exec') {
    const alias = opts._[0];
    requireKnownAlias(alias);
    const remoteCommand = opts.stdin ? await readStdinText()
      : opts.command !== undefined ? String(opts.command) : opts._.slice(1).join(' ');
    return execCommand(alias, remoteCommand, opts);
  }

  if (command === 'upload') {
    const [alias, localPath, remotePath] = opts._;
    requireKnownAlias(alias);
    return uploadCommand(alias, localPath, remotePath, opts);
  }

  if (command === 'download') {
    const [alias, remotePath, localPath] = opts._;
    requireKnownAlias(alias);
    return downloadCommand(alias, remotePath, localPath, opts);
  }

  if (command === 'tunnel') {
    const alias = opts._[0];
    requireKnownAlias(alias);
    return tunnelCommand(alias, opts);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  const startupErrorFile = process.env.LEARN_SSH_DAEMON_STARTUP_ERROR_FILE;
  if (process.argv[2] === 'daemon' && process.argv[3] === 'serve'
    && startupErrorFile && path.dirname(path.resolve(startupErrorFile)) === DATA_DIR
    && fs.existsSync(startupErrorFile)) {
    try {
      fs.writeFileSync(startupErrorFile, `${err.message}\n`, { mode: 0o600 });
    } catch {
      // The parent still has a generic startup error if this diagnostic cannot be written.
    }
  }
  if (argvWantsJson(process.argv.slice(2))) {
    printJson({ success: false, error: err.message });
  } else {
    process.stderr.write(`Error: ${err.message}\n`);
  }
  process.exit(1);
});
