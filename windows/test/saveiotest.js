import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicWriteFile, createSaveService } from '../src/save-io.js';

let checks = 0;
async function check(name, test) {
  await test();
  checks++;
  console.log(`PASS  ${name}`);
}

function fixture(overrides = {}) {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      capturePage: async () => {
        calls.push('capture');
        return { isEmpty: () => false, toPNG: () => { calls.push('png'); return Buffer.from('frame-at-click'); } };
      },
    },
  };
  const save = createSaveService({
    getWindow: () => window,
    now: () => new Date('2026-09-15T12:34:56.789Z'),
    showSaveDialog: async (_window, options) => {
      calls.push(['dialog', options]);
      return { canceled: false, filePath: 'user-selected-file' };
    },
    writeFile: async (...args) => { calls.push(['write', ...args]); },
    ...overrides,
  });
  return { calls, window, save };
}

await check('text exports use the selected destination and their own file type', async () => {
  for (const [kind, extension] of [['recording', 'csv'], ['learning', 'csv'], ['manifest', 'json'], ['experiment', 'json']]) {
    const { save, calls } = fixture();
    assert.deepEqual(await save(kind, 'content'), { ok: true, path: 'user-selected-file' });
    assert.equal(calls[0][1].defaultPath.endsWith(`2026-09-15T12-34-56.${extension}`), true);
    assert.deepEqual(calls[0][1].filters[0].extensions, [extension]);
    assert.deepEqual(calls[1], ['write', 'user-selected-file', 'content']);
  }
});

await check('validation rejects empty, unsupported and oversized UTF-8 content without a dialog', async () => {
  const { save, calls } = fixture();
  assert.equal((await save('recording', '')).reason, 'empty');
  assert.equal((await save('learning', {})).reason, 'empty');
  assert.equal((await save('unknown', 'x')).reason, 'unsupported-export');
  assert.equal((await save('manifest', 'é'.repeat(524289))).reason, 'too-large');
  assert.equal(calls.length, 0);
});

await check('cancel or absent destination never writes', async () => {
  for (const response of [{ canceled: true, filePath: 'ignored' }, { canceled: false }]) {
    const { save, calls } = fixture({ showSaveDialog: async () => response });
    assert.deepEqual(await save('recording', 'retained in renderer'), { ok: false, reason: 'canceled' });
    assert.equal(calls.length, 0);
  }
});

await check('dialog errors are returned and release the shared lock', async () => {
  let attempts = 0;
  const { save } = fixture({ showSaveDialog: async () => {
    if (++attempts === 1) throw new Error('dialog unavailable');
    return { canceled: true };
  } });
  assert.equal((await save('recording', 'data')).reason, 'dialog unavailable');
  assert.equal((await save('learning', 'data')).reason, 'canceled');
});

await check('write errors are returned and release the shared lock', async () => {
  let attempts = 0;
  const { save } = fixture({ writeFile: async () => {
    if (++attempts === 1) throw new Error('disk full');
  } });
  assert.equal((await save('recording', 'data')).reason, 'disk full');
  assert.equal((await save('manifest', '{}')).ok, true);
});

await check('snapshot pixels are captured and frozen before the save dialog', async () => {
  const { save, calls } = fixture();
  assert.equal((await save('snapshot')).ok, true);
  assert.deepEqual(calls.slice(0, 2), ['capture', 'png']);
  assert.equal(calls[2][0], 'dialog');
  assert.equal(calls[3][2].toString(), 'frame-at-click');
});

await check('concurrent exports are rejected until the write completes', async () => {
  let complete;
  let started;
  const written = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { complete = resolve; });
  const { save } = fixture({ writeFile: async () => { started(); await pending; } });
  const first = save('recording', 'data');
  await written;
  assert.deepEqual(await save('snapshot'), { ok: false, reason: 'busy' });
  assert.deepEqual(await save('learning', 'data'), { ok: false, reason: 'busy' });
  complete();
  assert.equal((await first).ok, true);
  assert.equal((await save('learning', 'data')).ok, true);
});

await check('snapshot capture failures and empty frames never open a dialog', async () => {
  const { save, calls, window } = fixture();
  window.webContents.capturePage = async () => { throw new Error('capture failed'); };
  assert.equal((await save('snapshot')).reason, 'capture failed');
  window.webContents.capturePage = async () => ({ isEmpty: () => true });
  assert.equal((await save('snapshot')).reason, 'empty-snapshot');
  window.webContents.capturePage = async () => ({ isEmpty: () => false, toPNG: () => Buffer.alloc(0) });
  assert.equal((await save('snapshot')).reason, 'empty-snapshot');
  assert.equal(calls.length, 0);
  assert.equal((await save('recording', 'data')).ok, true);
});

await check('a missing or destroyed parent window is handled without a dialog', async () => {
  const missing = fixture({ getWindow: () => null });
  assert.equal((await missing.save('manifest', '{}')).reason, 'window-unavailable');
  const { save, window, calls } = fixture();
  window.webContents.capturePage = async () => {
    window.isDestroyed = () => true;
    return { isEmpty: () => false, toPNG: () => Buffer.from('png') };
  };
  assert.equal((await save('snapshot')).reason, 'window-unavailable');
  assert.equal(calls.length, 0);
});

await check('atomic saves preserve existing data on failure and remove only their staging files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'neurofly-save-test-'));
  const target = path.join(directory, 'record.csv');
  try {
    await atomicWriteFile(target, 'original');
    await assert.rejects(atomicWriteFile(target, {}));
    assert.equal(await readFile(target, 'utf8'), 'original');
    assert.deepEqual(await readdir(directory), ['record.csv']);
    await atomicWriteFile(target, 'replacement ä');
    assert.equal(await readFile(target, 'utf8'), 'replacement ä');
    await atomicWriteFile(target, Buffer.from([1, 2, 3]));
    assert.deepEqual(await readFile(target), Buffer.from([1, 2, 3]));
    assert.deepEqual(await readdir(directory), ['record.csv']);
  } finally {
    await unlink(target).catch(() => {});
    await rmdir(directory);
  }
});

console.log(`${checks} save I/O checks passed.`);
