import { Worker } from 'node:worker_threads';

// Lazy singleton worker. Bounded queue, explicit failures, idle release of the
// graph cache, and no worker at all until the anatomy workspace is opened.
export function createSpecimenService({ dir, idleMs = 120000, timeoutMs = 60000 } = {}) {
  let worker = null, idle = null, next = 0, closed = false;
  const pending = new Map();
  function fail(error) {
    const old = worker; worker = null; clearTimeout(idle);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
    return old?.terminate();
  }
  function armIdle() {
    clearTimeout(idle);
    if (!pending.size) { idle = setTimeout(() => fail(new Error('Anatomy cache released')), idleMs); idle.unref?.(); }
  }
  function ensure() {
    if (worker) return;
    const current = worker = new Worker(new URL('./specimen-worker.js', import.meta.url), { workerData: { dir } });
    current.on('message', message => {
      if (worker !== current) return;
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(message.error)); else p.resolve(message.result);
      armIdle();
    });
    current.on('error', error => { if (worker === current) fail(error); });
    current.on('exit', () => { if (worker === current) fail(new Error('Anatomy worker stopped; retry the request')); });
  }
  function call(method, ...args) {
    if (closed) return Promise.reject(new Error('Anatomy service is closed'));
    if (pending.size >= 32) return Promise.reject(new Error('Too many anatomy requests; wait for loading to finish'));
    clearTimeout(idle);
    return new Promise((resolve, reject) => {
      try {
        ensure();
        const id = ++next;
        const timer = setTimeout(() => fail(new Error('Anatomy request timed out; retry loading')), timeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, method, args });
      } catch (error) { fail(error); reject(error); }
    });
  }
  return {
    catalog: () => call('catalog'), load: id => call('overview', id),
    cell: (id, neuron, sha256) => call('cell', id, neuron, sha256),
    path: (id, query, sha256) => call('path', id, query, sha256),
    morphology: (id, profileId) => call('morphology', id, profileId),
    async close() { closed = true; await fail(new Error('Anatomy service closed')); },
  };
}
