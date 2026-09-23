// sim-worker.js — the live fly, on her own CPU core.
//
// The complete closed loop (brain, nerve cord, body, world, instruments; see
// src/closed-loop.js) runs here on its fixed 120 Hz clock, decoupled from the
// page's drawing. The page sends only what it alone can produce — the motion
// energy of the fly's rendered eye, the pointer on the ground, OS ambient
// signals — and the user's commands; this thread sends back one snapshot per
// displayed frame. Sensing, neural integration, motor output and body
// mechanics stay in lockstep inside tick(); the only thing that crosses the
// thread boundary with a delay is the rendered eye, which was already a
// throttled, one-frame-late readback.

import { ClosedLoop } from '../src/closed-loop.js';
import { nextSimulationWake } from '../src/worker-schedule.js';

let loop = null;
let last = 0;
let lastPost = 0;
let mapRequest = null;           // { field } while the page shows the spatial map
let frameBudgetMs = 1000 / 60;
let framePending = false;

function post(type, payload, transfer = []) { postMessage({ type, ...payload }, transfer); }

function snapshotAndPost(now) {
  const snap = loop.snapshot({ includeMap: Boolean(mapRequest), mapField: mapRequest?.field });
  const transfer = [];
  for (const p of snap.poses) transfer.push(p.buffer);
  if (snap.spikes) transfer.push(snap.spikes.buffer);
  transfer.push(snap.objects.buffer);
  post('frame', { snapshot: snap }, transfer);
  framePending = true;
  lastPost = now;
}

function run() {
  const now = performance.now();
  // ClosedLoop bounds catch-up and records any unsimulated time. Clipping
  // here would hide the longest stalls from the exported measurements.
  const elapsed = Math.max(0, (now - last) / 1000);
  last = now;
  if (loop) {
    try {
      loop.advance(elapsed);
      if (!framePending && now - lastPost >= frameBudgetMs) snapshotAndPost(now);
    } catch (error) {
      post('error', { message: error?.message ?? String(error), stack: error?.stack ?? '' });
    }
  }
  setTimeout(run, loop ? nextSimulationWake({ paused: loop.paused, accumulator: loop.clock.accumulator, speed: loop.speed, computeMs: performance.now() - now }) : 16);
}

function reply(id, result) { if (id) post('reply', { id, result }); }

onmessage = (event) => {
  const m = event.data;
  try {
    switch (m.type) {
      case 'frame-ack': framePending = false; break;
      case 'init': {
        loop = new ClosedLoop({ data: m.data, bounds: m.bounds, seed: m.seed });
        if (m.ambient) loop.ambient = { ...loop.ambient, ...m.ambient };
        post('ready', { layout: loop.world.layout(), populations: [...loop.populations().values()].map(({ key, label, indices }) => ({ key, label, count: indices.length })),
          seed: loop.neuralSeed, sessionId: loop.sessionId, hasTaste: loop.sim.hasTaste, hasGrooming: loop.sim.hasGroomingPathway });
        last = performance.now();
        run();
        break;
      }
      case 'input': {
        if (!loop) break;
        if ('pointer' in m) loop.pointer = m.pointer;
        if (m.vision) loop.vision = m.vision;
        if (m.ambient) loop.ambient = { ...loop.ambient, ...m.ambient };
        if ('map' in m) mapRequest = m.map;
        if (m.frameBudgetMs) frameBudgetMs = m.frameBudgetMs;
        break;
      }
      case 'cmd': {
        if (!loop) break;
        const result = loop.handle(m);
        if (m.name === 'pause') last = performance.now(); // paused wall time is not neural catch-up
        reply(m.id, result);
        break;
      }
      case 'request': {
        if (!loop) { reply(m.id, null); break; }
        const a = m.args || {};
        let result = null;
        switch (m.what) {
          case 'manifest': result = loop.manifest(); break;
          case 'stopRecording': result = loop.stopRecording(a); break;
          case 'clearRecording': loop.clearRecording(); result = true; break;
          case 'learningCSV': result = loop.learningCSV(); break;
          case 'mapCSV': result = loop.spatialMap.totalTime > 0 ? loop.spatialMap.toCSV() : null; break;
          case 'probe': result = loop.probe(a.index); break;
          case 'findNeuron': {
            const q = String(a.query || '').trim();
            let i = -1;
            if (/^#\d+$/.test(q)) i = Number(q.slice(1));
            else i = loop.data.circuit.neurons.findIndex((nr) => String(nr.id) === q);
            result = i >= 0 && i < loop.sim.n ? loop.probe(i) : null;
            break;
          }
          case 'cellTypes': result = loop.cellTypeSearch(a.query); break;
          case 'populationIndices': {
            const pop = loop.resolvePopulation(a.population);
            result = pop ? Array.from(pop.indices) : null;
            break;
          }
          case 'journal': result = loop.journal.snapshot(); break;
          case 'events': result = loop.events.slice(); break;
          default: result = null;
        }
        reply(m.id, result);
        break;
      }
      default: break;
    }
  } catch (error) {
    post('error', { message: error?.message ?? String(error), stack: error?.stack ?? '' });
    reply(m.id, null);
  }
};
