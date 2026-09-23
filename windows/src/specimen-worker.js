// Disk reads, hashing, JSON parsing and graph queries never occupy Electron's UI thread.
import { parentPort, workerData } from 'node:worker_threads';
import { createSpecimenStore } from './specimen-data.js';
const store = createSpecimenStore(workerData?.dir);
const allowed = new Set(['catalog', 'overview', 'cell', 'path', 'morphology']);
parentPort.on('message', ({ id, method, args }) => {
  try {
    if (!allowed.has(method)) throw new Error('Unknown specimen operation');
    parentPort.postMessage({ id, result: store[method](...args) });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
