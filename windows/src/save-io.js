// The renderer supplies content, never a destination. One native save dialog
// owns every destination; an in-flight operation blocks all other exports.
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
const EXPORTS = {
  recording: { title: 'Aufzeichnung speichern', stem: 'neurofly', name: 'CSV', extension: 'csv', maxBytes: MAX_RECORDING_BYTES },
  experiment: { title: 'Versuchspaket speichern', stem: 'neurofly-experiment', name: 'NeuroFly Versuchspaket (JSON)', extension: 'json', maxBytes: MAX_RECORDING_BYTES },
  learning: { title: 'Lernspur speichern', stem: 'neurofly-learning', name: 'CSV', extension: 'csv', maxBytes: MAX_RECORDING_BYTES },
  manifest: { title: 'Versuchsmanifest speichern', stem: 'neurofly-manifest', name: 'JSON', extension: 'json', maxBytes: 1024 * 1024 },
  snapshot: { title: 'NeuroFly-Snapshot speichern', stem: 'neurofly', name: 'PNG-Bild', extension: 'png' },
};

// Stage in the selected file's directory, then replace atomically. A full disk,
// interrupted write or failed rename must not truncate the user's existing file.
// The random name is created exclusively; cleanup never touches the destination.
export async function atomicWriteFile(filePath, content) {
  const temporaryPath = path.join(path.dirname(filePath), `.neurofly-${randomUUID()}.tmp`);
  let handle;
  let created = false;
  try {
    handle = await open(temporaryPath, 'wx');
    created = true;
    await handle.writeFile(content, typeof content === 'string' ? 'utf8' : undefined);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (created) await unlink(temporaryPath).catch(() => {});
  }
}

export function createSaveService({ getWindow, showSaveDialog, writeFile = atomicWriteFile, now = () => new Date() }) {
  let busy = false;
  return async function save(kind, content) {
    const spec = EXPORTS[kind];
    if (!spec) return { ok: false, reason: 'unsupported-export' };
    if (busy) return { ok: false, reason: 'busy' };
    if (kind !== 'snapshot') {
      if (typeof content !== 'string' || content.length === 0) return { ok: false, reason: 'empty' };
      if (Buffer.byteLength(content, 'utf8') > spec.maxBytes) return { ok: false, reason: 'too-large' };
    }
    busy = true;
    try {
      const window = getWindow();
      if (!window || window.isDestroyed()) return { ok: false, reason: 'window-unavailable' };
      const stamp = now().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      if (kind === 'snapshot') {
        // Capture immediately: the simulation may keep running while the user
        // chooses a filename, so capturing after the dialog changes the observation.
        const image = await window.webContents.capturePage();
        if (image.isEmpty()) return { ok: false, reason: 'empty-snapshot' };
        content = image.toPNG();
        if (!content.length) return { ok: false, reason: 'empty-snapshot' };
      }
      if (window.isDestroyed()) return { ok: false, reason: 'window-unavailable' };
      const { canceled, filePath } = await showSaveDialog(window, {
        title: spec.title,
        defaultPath: `${spec.stem}-${stamp}.${spec.extension}`,
        filters: [{ name: spec.name, extensions: [spec.extension] }],
      });
      if (canceled || !filePath) return { ok: false, reason: 'canceled' };
      await writeFile(filePath, content);
      return { ok: true, path: filePath };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      busy = false;
    }
  };
}
