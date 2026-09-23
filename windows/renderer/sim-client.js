// sim-client.js — the page's handle on the simulation thread.
//
// Commands go out, snapshots come back. Requests that need an answer (a
// manifest, a recording's content, a neuron probe) return promises. The page
// never reads simulation state any other way, so there is exactly one source
// of truth for what the fly is doing: the latest snapshot.

export class SimClient {
  constructor(url) {
    this.worker = new Worker(url, { type: 'module' });
    this.latest = null;
    this.frameListeners = new Set();
    this.pending = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => { this._resolveReady = resolve; this._rejectReady = reject; });
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => {
      console.error('[sim-worker]', e.message || e);
      this._rejectReady?.(new Error(e.message || 'simulation worker failed'));
    };
  }

  _onMessage(m) {
    switch (m.type) {
      case 'ready': this.info = m; this._resolveReady(m); break;
      case 'frame':
        this.latest = m.snapshot;
        try { for (const fn of this.frameListeners) fn(m.snapshot); }
        finally { this.worker.postMessage({ type: 'frame-ack' }); }
        break;
      case 'reply': {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p(m.result); }
        break;
      }
      case 'error': console.error('[sim-worker]', m.message, m.stack); break;
      default: break;
    }
  }

  init(data, bounds, seed, ambient) {
    this.worker.postMessage({ type: 'init', data, bounds, seed, ambient });
    return this.ready;
  }

  onFrame(fn) { this.frameListeners.add(fn); return () => this.frameListeners.delete(fn); }

  input(fields) { this.worker.postMessage({ type: 'input', ...fields }); }

  // Fire-and-forget unless an answer is wanted.
  command(name, args = {}, { reply = false } = {}) {
    if (!reply) { this.worker.postMessage({ type: 'cmd', name, args }); return Promise.resolve(undefined); }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: 'cmd', name, args, id });
    });
  }

  request(what, args = {}) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ type: 'request', what, args, id });
    });
  }
}
