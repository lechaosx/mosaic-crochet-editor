import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const { scripts } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const worker = `
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const role = process.argv[2];
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
console.log('READY', role, process.pid, child.pid);
const timer = setInterval(() => {
  if (!existsSync(role + '.stop')) return;
  clearInterval(timer);
  child.once('exit', () => process.exit(Number(process.argv[3])));
  child.kill();
}, 20);
`;

async function waitFor(predicate, output) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await setTimeout(25);
  }
  assert.fail(`Timed out waiting for dev process lifecycle\n${output()}`);
}

async function running(pid) {
  try {
    process.kill(pid, 0);
    // Orphaned children can remain zombies until the host init reaps them.
    if (process.platform === 'linux') {
      return !(await readFile(`/proc/${pid}/stat`, 'utf8')).includes(') Z ');
    }
    return true;
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return false;
    throw error;
  }
}

async function withDev(run, { shellMode, exitCodes = { rust: 7, web: 8 } }) {
  const cwd = await mkdtemp(join(tmpdir(), 'mosaic-dev-test-'));
  let dev;
  let output = '';
  const workers = {};
  let result;
  let spawnError;
  try {
    await writeFile(join(cwd, 'worker.mjs'), worker);
    await writeFile(join(cwd, 'package.json'), JSON.stringify({
      private: true,
      scripts: {
        dev: scripts.dev,
        'dev:rust': `node worker.mjs rust ${exitCodes.rust}`,
        'dev:web': `node worker.mjs web ${exitCodes.web}`,
      },
    }));
    await symlink(join(root, 'node_modules'), join(cwd, 'node_modules'));
    const env = { ...process.env };
    if (shellMode === 'waiting') {
      // A trailing builtin prevents shells from implicitly execing their final command.
      env.npm_config_script_shell = join(cwd, 'script-shell');
      await writeFile(env.npm_config_script_shell,
        String.raw`#!/bin/sh
exec /bin/sh -c "$2; status=\$?; exit \"\$status\""
`,
        { mode: 0o755 });
    }
    dev = spawn('npm', ['run', 'dev'], { cwd, detached: true, env });
    dev.on('error', error => { spawnError = error; });
    for (const stream of [dev.stdout, dev.stderr]) {
      stream.on('data', data => {
        output += data;
        for (const match of output.matchAll(/READY (rust|web) (\d+) (\d+)/g)) {
          workers[match[1]] = match.slice(2).map(Number);
        }
      });
    }
    dev.on('exit', (code, signal) => { result = { code, signal }; });
    await waitFor(() => {
      assert.ifError(spawnError);
      return workers.rust && workers.web;
    }, () => output);
    await run({ dev, workers, cwd, output: () => output, result: () => result });
  } finally {
    if (dev?.pid) {
      try { process.kill(-dev.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      await waitFor(() => dev.exitCode !== null || dev.signalCode !== null, () => output);
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const shellMode of ['default', 'waiting']) {
  for (const role of ['rust', 'web']) {
    test(`npm run dev propagates ${role} failure and stops the other process tree (${shellMode} shell)`, async () => {
      await withDev(async ({ workers, cwd, result, output }) => {
        await writeFile(join(cwd, `${role}.stop`), '');
        await waitFor(() => result(), output);
        assert.notEqual(result().code, 0, output());
        for (const pid of workers[role === 'rust' ? 'web' : 'rust']) {
          await waitFor(async () => !(await running(pid)), output);
        }
      }, { shellMode });
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    test(`npm run dev stops both process trees on ${signal} (${shellMode} shell)`, async () => {
      await withDev(async ({ dev, workers, result, output }) => {
        dev.kill(signal);
        await waitFor(() => result(), output);
        for (const pid of Object.values(workers).flat()) {
          await waitFor(async () => !(await running(pid)), output);
        }
      }, { shellMode });
    });
  }

  for (const role of ['rust', 'web']) {
    test(`npm run dev stops the other process tree when ${role} finishes successfully (${shellMode} shell)`, async () => {
      await withDev(async ({ workers, cwd, result, output }) => {
        await writeFile(join(cwd, `${role}.stop`), '');
        await waitFor(() => result(), output);
        assert.equal(result().code, 0, output());
        for (const pid of workers[role === 'rust' ? 'web' : 'rust']) {
          await waitFor(async () => !(await running(pid)), output);
        }
      }, { shellMode, exitCodes: { rust: 0, web: 0 } });
    });
  }
}
