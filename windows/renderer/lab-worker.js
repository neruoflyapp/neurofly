// lab-worker.js — the experiment rig, on a core of its own.
//
// Protocols from src/experiments.js run here on a separate virtual fly in a
// bare arena, as fast as the CPU allows, while the live fly carries on in the
// simulation worker. Every run is reproducible from its seed: the rig's
// individual, and every trial's neural noise, derive from it.

import { ClosedLoop } from '../src/closed-loop.js';
import { protocolById, seedStream, resultCSV } from '../src/experiments.js';
import { MODEL_VERSION } from '../src/provenance.js';

let data = null;
let cancelled = false;
let busy = false;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function runProtocol({ runId, protocolId, params, seed }) {
  const protocol = protocolById(protocolId);
  if (!protocol) { postMessage({ type: 'failed', runId, message: `unknown protocol ${protocolId}` }); return; }
  busy = true; cancelled = false;
  const started = performance.now();
  const rig = new ClosedLoop({ data, bounds: { width: 1100, height: 700 }, seed, empty: true, spikeBus: false, instruments: false, hour: 12 });
  rig.ambient = { typing: 0, sleepy: false, activity: 1 };
  const p = { ...protocol.defaults, ...params };
  const gen = protocol.run(rig, p, seedStream(seed ^ 0x5bd1e995));
  let step = gen.next();
  let lastPost = 0;
  while (!step.done) {
    if (cancelled) { busy = false; postMessage({ type: 'cancelled', runId }); return; }
    const now = performance.now();
    if (now - lastPost > 150) {
      const fraction = step.value;
      const elapsed = (now - started) / 1000;
      postMessage({ type: 'progress', runId, fraction, etaSeconds: fraction > 0.02 ? elapsed * (1 - fraction) / fraction : null });
      lastPost = now;
      await tick();
    }
    step = gen.next();
  }
  const result = step.value;
  busy = false;
  postMessage({ type: 'result', runId, result: {
    ...result,
    csv: resultCSV(result),
    meta: {
      protocolId, title: protocol.title, seed, params: p, modelVersion: MODEL_VERSION,
      startedAt: new Date(Date.now() - (performance.now() - started)).toISOString(), finishedAt: new Date().toISOString(),
      wallSeconds: (performance.now() - started) / 1000, simulatedSeconds: rig.simTime,
      brainBundleSHA256: data.provenance?.brainCircuitSHA256 ?? null,
      sensoryExtensionStatus: data.provenance?.sensoryExtensionStatus ?? 'absent',
      rig: 'bare arena, no objects, daytime (circadian activity 1), fresh neural noise per trial, one individual unless stated',
      pathwayWeight: rig.sim.pathwayWeight,
    },
  } });
}

onmessage = async (event) => {
  const m = event.data;
  if (m.type === 'init') { data = m.data; postMessage({ type: 'ready' }); return; }
  if (m.type === 'cancel') { cancelled = true; return; }
  if (m.type === 'run') {
    if (busy) { postMessage({ type: 'failed', runId: m.runId, message: 'busy' }); return; }
    try { await runProtocol(m); }
    catch (error) { busy = false; postMessage({ type: 'failed', runId: m.runId, message: error?.message ?? String(error) }); }
  }
};
