import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(ROOT, 'skills', 'learn-ssh', 'scripts', 'ssh-node-ops.mjs');
const INSTALLER = path.join(ROOT, 'bin', 'install.mjs');

function withStorage(callback) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const storage = fs.mkdtempSync(path.join(tempRoot, 'learn-ssh-cli-test-'));
  try {
    return callback(storage);
  } finally {
    const resolved = fs.realpathSync(storage);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.match(path.basename(resolved), /^learn-ssh-cli-test-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function withStorageAsync(callback) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const storage = fs.mkdtempSync(path.join(tempRoot, 'learn-ssh-cli-test-'));
  try {
    return await callback(storage);
  } finally {
    const resolved = fs.realpathSync(storage);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.match(path.basename(resolved), /^learn-ssh-cli-test-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function runCli(storage, args, extra = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, LEARN_SSH_HOME: storage },
    encoding: 'utf8',
    timeout: 15000,
    ...extra,
  });
}

function writeAgentAlias(storage) {
  fs.writeFileSync(path.join(storage, 'config.json'), JSON.stringify({
    version: 1,
    servers: {
      demo: { alias: 'demo', host: 'example.invalid', port: 22, username: 'root', auth: 'agent' },
    },
  }));
}

test('unknown options, extra arguments, and secret flags fail before a command runs', () => withStorage((storage) => {
  for (const [args, message] of [
    [['paths', '--prot=2222'], /Unknown option: --prot/],
    [['paths', '--port=2222'], /Unknown option for paths: --port/],
    [['paths', 'extra'], /unexpected extra arguments/],
    [['paths', '--password=example'], /Do not pass --password as a flag/],
  ]) {
    const result = runCli(storage, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
  assert.deepEqual(fs.readdirSync(storage), []);
}));

test('boolean values and help are handled explicitly', () => withStorage((storage) => {
  const help = runCli(storage, ['paths', '--help=true']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^learn-ssh paths\n/);

  const removeHelp = runCli(storage, ['remove', 'missing', '--help=true']);
  assert.equal(removeHelp.status, 0);
  assert.match(removeHelp.stdout, /^learn-ssh remove\n/);
  assert.deepEqual(fs.readdirSync(storage), []);

  const human = runCli(storage, ['list', '--json=false']);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /config\.json does not exist/);

  const json = runCli(storage, ['list', '--json=true']);
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).storageInitialized, false);

  const invalidBoolean = runCli(storage, ['list', '--json=maybe']);
  assert.equal(invalidBoolean.status, 1);
  assert.match(invalidBoolean.stderr, /Invalid boolean value for --json/);
}));

test('missing arguments point to the relevant command', () => withStorage((storage) => {
  for (const command of ['show', 'remove', 'exec', 'upload', 'download', 'tunnel']) {
    const result = runCli(storage, [command]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${command} requires`));
  }
  const add = runCli(storage, ['add', '--alias', 'demo', '--host', 'example.invalid', '--user', 'root']);
  assert.equal(add.status, 1);
  assert.match(add.stderr, /--auth/);
}));

test('false update does not replace an existing alias', () => withStorage((storage) => {
  writeAgentAlias(storage);
  const before = fs.readFileSync(path.join(storage, 'config.json'), 'utf8');
  const result = runCli(storage, [
    'add', '--alias', 'demo', '--host', 'example.invalid', '--user', 'root', '--auth', 'agent', '--update=false',
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Alias already exists/);
  assert.equal(fs.readFileSync(path.join(storage, 'config.json'), 'utf8'), before);
}));

test('valid add and show options still work', () => withStorage((storage) => {
  const added = runCli(storage, [
    'add', '--alias', 'demo', '--host', 'example.invalid', '--user', 'root', '--auth', 'agent', '--tags', 'ops,test', '--json',
  ]);
  assert.equal(added.status, 0);
  assert.equal(JSON.parse(added.stdout).alias, 'demo');

  const shown = runCli(storage, ['show', 'demo', '--json']);
  assert.equal(shown.status, 0);
  assert.deepEqual(JSON.parse(shown.stdout).server.tags, ['ops', 'test']);
}));

test('empty stdin and an absent alias have clear results', () => withStorage((storage) => {
  writeAgentAlias(storage);
  const empty = runCli(storage, ['exec', 'demo', '--stdin'], { input: '' });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /standard input with --stdin/);

  const removed = runCli(storage, ['remove', 'missing']);
  assert.equal(removed.status, 0);
  assert.match(removed.stdout, /Alias already absent: missing/);
}));

test('help topics and installer help reject or explain the right input', () => withStorage((storage) => {
  const invalidTopic = runCli(storage, ['help', 'daemon', 'frob']);
  assert.equal(invalidTopic.status, 1);
  assert.match(invalidTopic.stderr, /Unknown daemon subcommand: frob/);

  const installer = spawnSync(process.execPath, [INSTALLER, '--scope', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(installer.status, 0);
  assert.match(installer.stdout, /^LearnSSH installer/);
}));

test('paths reports external storage accurately', () => withStorage((storage) => {
  const result = runCli(storage, ['paths', '--json']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).projectLocal, false);
}));

test('tunnel JSON output is a line-delimited event stream', () => withStorageAsync(async (root) => {
  const storage = path.join(root, 'data');
  fs.mkdirSync(storage);
  writeAgentAlias(storage);
  const cliCopy = path.join(root, 'ssh-node-ops.mjs');
  fs.copyFileSync(CLI, cliCopy);
  const moduleDir = path.join(root, 'node_modules', 'ssh2');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ name: 'ssh2', type: 'module', main: './index.js' }));
  fs.writeFileSync(path.join(moduleDir, 'index.js'), `import { EventEmitter } from 'node:events';
export class Client extends EventEmitter {
  connect() { queueMicrotask(() => this.emit('ready')); }
  end() {}
}\n`);

  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));

  const result = spawnSync(process.execPath, [
    cliCopy, 'tunnel', 'demo', '--local-port', String(port), '--remote-port', '5432', '--idle-timeout', '0.2', '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, LEARN_SSH_HOME: storage },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.event), ['started', 'closed']);
  assert.equal(events[1].reason, 'idle-timeout');
}));

test('daemon startup includes the child failure reason', () => withStorage((storage) => {
  writeAgentAlias(storage);
  const configPath = path.join(storage, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.servers.demo.auth = 'unsupported';
  fs.writeFileSync(configPath, JSON.stringify(config));

  const result = runCli(storage, ['daemon', 'start', 'demo']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to start daemon for alias: demo/);
  assert.match(result.stderr, /Missing dependency ssh2|Unsupported auth type/);
  assert.equal(fs.readdirSync(storage).some((name) => name.startsWith('daemon-startup-')), false);
}));
