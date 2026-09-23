# NeuroFly for Windows

Release 2.1.0. A 3D fruit fly in her own terrarium, driven by a 1 kHz
leaky-integrate-and-fire **model** over measured FlyWire FAFB v783 wiring —
7,270 brain neurons and 784,219 signed synapse-count connections: the
6,338-neuron escape/steering subgraph (338 command/sensory neurons plus their
6,000 strongest retained partners), FlyWire's 16 thermosensors with their
relays, and the taste (sugar/water and bitter → proboscis motor neurons) and
antennal-grooming (JO-F → DNg12) pathways — coupled through a documented
interface to a 1,045-neuron walking circuit from the MaleCNS brain-and-nerve-
cord dataset. Modelled leg-local stepping rules drive 96 of the cord's
premotor cells, and the measured wiring carries the rhythm to the leg motor
neurons: she walks in an alternating gait, steers and walks backward through
the cord, and stands still if its synapses are cut. The complete loop runs in
a Web Worker at a fixed 120 Hz, so display speed never changes the
simulation.

The extracted anatomy and synapse counts are measured data. Coupling the
female FlyWire brain to the male nerve cord by descending-neuron type, neuron
dynamics, sensory transduction, muscle actuation, the stepping rules and the
premotor cells they drive (derived from the model, `data/rhythm_decoder.json`)
and body mechanics are modelling assumptions, not a measured complete digital
fly.

## Scientific scope and reproducibility

NeuroFly is an embodied **connectome-derived model**, not a complete digital
animal. The retained FlyWire identities, positions and signed synapse-count
edges are data; the LIF parameters, neural noise, sensory transduction, body,
muscles and female-brain-to-male-VNC population bridge are explicit model
choices. A connectome alone cannot establish subjective experience,
consciousness, pain, emotion, intention or "thought". The interface therefore
reports neural activity, never a claimed inner life or a sentience score.

Every input bundle is structurally audited before it is simulated and
fingerprinted with SHA-256. Neural noise and every behavioural choice draw from
seeded generators, so the same seed and the same inputs reproduce a run
exactly; recordings and run manifests carry the model version, both seeds'
source, the data fingerprints, every intervention with its time, and any
simulation time lost to overload. The optional learning kernel applies a
bounded pair-timing rule to 1,627 anatomically present excitatory
sensory-to-command contacts and logs every change; it is an experiment, not a
claim that those contacts have a measured STDP rule. The default model keeps
all extracted synapse weights fixed.

`npm run sciencetest` checks those claims: circuit structure, source
fingerprints, rejection of corrupt endpoints, same-seed determinism,
different-seed divergence and the explicit bridge label.

## Run

```sh
npm install
npm start               # the Studio; closing the window minimises to the tray
npm test                # all 28 suites (MUST pass after sim/behaviour/data changes)
npm run uitest          # the real app, driven through DOM calls only
npm run simtest         # circuit invariants
npm run behaviortest    # brain -> behaviour checks
npm run locomotortest   # MaleCNS causal paths, joints, contact, steering and reverse
npm run pathwaytest     # taste and grooming pathways, virtual genetics, causal tracing
npm run experimenttest  # statistics and guided protocols, reproducible from their seed
npm run sensorytest     # each stimulus reaches the Johnston's-organ population that transduces it
npm run thermotest      # temperature reaches the real hot/cold thermosensors, never vision
npm run sciencetest     # data validation, provenance and neural repeatability
```

`NEUROFLY_DEBUG=1 npm start` logs renderer console output to stderr and
exposes the renderer context as `window.__nf`.

The suites run on bare Node — three.js builds the fly's scene graph headlessly,
so behaviour is testable without a GPU.

## The Studio

The terrarium sits in the centre, the 3D connectome and the "Why did she do
that?" explanations on the right, live firing-rate traces below. The rail on
the left switches between eight workspaces (keys 1–8):

- **Live** — what she is doing right now, command-neuron rates, quick stimuli.
- **Stimulate** — every sense, the world (temperature and gradient, wind,
  gravity, oxygen, rain, dust, fire, flood, food drops) and her body.
- **Circuit** — virtual genetics: silence or activate any identified
  population or FlyWire cell type; transmitter-class pharmacology; inspect a
  single neuron's real inputs and outputs.
- **Lab** — ten guided experiments from the fly literature, run on a separate
  virtual fly in a bare arena, with statistics and the published finding.
- **Sentience** — the eight criteria of Birch et al. (2021), the rating for
  real adult flies (Gibbons et al. 2022), and what the model does and does not
  contain; scope, never a score.
- **Data** — recording (20 Hz CSV or a bundle with manifest), spatial map,
  exports.
- **Model** — where every number comes from: data, assumptions, performance,
  references.
- **Specimens** — the female BANC, male MaleCNS and female FAFB connectomes as
  separately browsable anatomy (cell search, inputs/outputs, paths, skeletons).

Every takeoff, grooming bout, backward walk or proboscis extension appears in
the explanation panel with its causal chain: the trigger (only if its receptors
measurably fed the deciding neurons), co-causes, inputs that were merely
present, the sensory rates, the synaptic input to the command neurons by
source, and the body rule that made it movement. The interface is in English
and German; the language switch keeps the running simulation.

## What the fly senses

- **Vision** — each frame, the scene is actually re-rendered from a camera at
  the fly's own head, pointed along its heading (shown live in the
  dashboard's field-of-view canvas); frame-to-frame luminance change in the
  left/right halves of that real render — not geometric cursor-distance math
  — drives the real LC4/LPLC2 looming population. An object dragged right up
  to the fly's face is a genuine, strong looming stimulus, not a token one.
  That raw change is first put through centre-surround antagonism, the way
  real early visual systems (the fly's own lamina and medulla included) do it:
  each ommatidium is inhibited by its neighbourhood average, so the broad
  optic flow her own walking and turning smear across the whole field cancels,
  while a compact patch moving differently from its surroundings — an object
  actually closing in — survives. Without it, ordinary locomotion alone reads
  as a permanent predator (it did; see `VALIDATION.md`). The dashboard draws
  that post-suppression field directly beneath what she sees, so the drive
  reaching her escape circuit is inspectable rather than inferred.
- **Cursor** — position and velocity are a second, independent looming source
  (proximity-based, not rendered), split between the two eyes by bearing. A
  lunge drives the DNp01 giant fiber and the fly takes off ~4 ms later. Fast
  motion nearby is a sudden air puff at the antenna: its fast onset excites
  the vibration-sensitive auditory Johnston's-organ neurons (JO-A/B) and its
  deflection the wind/gravity ones (JO-C/D/E). A click near the fly (or a
  drag that doesn't move it much) is the same kind of air disturbance.
- **Terrarium objects** — proximity to an object is a small, short-range
  visual cue; a fast-approaching firefly drives the same looming math as the
  cursor. Contact deflects the arista and so reaches the deflection-sensitive
  JO-C/D/E neurons — firmer for a solid object than for a petal or a blade of
  grass. That is the only touch pathway the model has: body-wall bristle
  mechanoreceptors are not in this FlyWire subgraph, so contact elsewhere on
  the body is not neurally sensed.
- **Smell** — a standing scent source (draggable) plus every object's own
  kind-specific scent strength (flowers strongest, then mushrooms, logs,
  stumps, bushes...) form a real concentration field in the world, which the
  dashboard reads out and the spatial map and recording capture. It reaches
  **no neurons**: odours are detected by olfactory receptor neurons, and this
  escape-circuit subgraph contains none (FlyWire has 2,281; the partner
  selection kept none). Earlier versions fed odour into the "sensory"
  partners, which turned out to be the antenna's hearing neurons — see
  `VALIDATION.md`.
- **Thermal gradient** — the terrarium does not have to be one temperature.
  With a gradient set, the temperature slider becomes the arena's *mean* and
  the world runs cool at the west end and warm at the east, which is the
  classic Drosophila thermal-preference arena rather than an invention: you
  put a fly in a gradient and where she settles is the measurement. No new
  mechanism is modelled for it — the same documented thermal pathway below
  simply becomes a function of where she is standing, so there is something
  real for the spatial map to find instead of a world that is identical
  everywhere by construction.
- **Temperature** — flies are ectotherms. Below ~10°C the panel's slider
  genuinely suppresses the real LIF baseline drive (cold torpor); 10-30°C
  scales locomotion speed. And temperature is *sensed* by FlyWire's real
  thermosensory cells — the 7 hot and 9 cold cells of the antenna. The
  escape-circuit subgraph contains none of them (they make only 31 and 6
  synapses onto it directly), so `data/thermo_extension.json`
  (`etl_thermo_extension.mjs`) adds them together with the relay neurons
  carrying their strongest real two-synapse paths into the circuit, locked
  to the exact `circuit.json` they extend. How strongly temperature drives
  them is a model: mainly the rate of warming or cooling where she stands
  (these cells respond chiefly to change), plus a small tonic part outside
  24-26°C; what the brain then does with it is left to the measured wiring.
  Heat used to be injected into the visual looming detectors above 38°C;
  that shortcut is gone. Fire is a local, draggable, intense heat source,
  plus a real looming stimulus as you approach it.
- **Wind** — a physical push on the body (stronger in flight) plus a
  sustained deflection of the antenna, which drives only the Johnston's-organ
  wind/gravity neurons (JO-C/D/E). Their FlyWire wiring goes mostly into the
  central brain (695 synapses) and barely onto the giant fiber (34), so wind
  registers strongly without triggering escape — measured: 0 giant-fiber
  spikes where the same-strength input to the auditory JO-A/B gives hundreds.
  That matches Drosophila, where wind suppresses walking rather than causing
  flight (Yorozu et al. 2009). Whether the model also slows her walking in
  wind has not been measured.
- **Rain / ice rain / flood** — drops striking a grounded fly are brief
  impacts at the antenna (both JO populations); standing in them accumulates
  wetness that (like a
  missing/disabled wing) genuinely grounds the fly — wet or damaged wings
  can't produce lift even though the real wing-motor neurons still fire
  normally. Flooding is instant total wetness plus real oxygen deprivation
  once it covers the fly; ice rain adds a real cold component.
- **Smoke** — genuinely depresses effective oxygen (same pathway the oxygen
  slider uses).
- **Dust** — particles settle on the antennae and deflect them, driving the
  204 JO-F mechanosensory neurons, which reach the DNg12 head-grooming
  descending neurons through their measured relays (Hampel et al. 2020; Guo,
  Zhang & Simpson 2022). The dust load falls while she grooms her head, so
  grooming ends when the antennae are clean. The dust-to-drive mapping is a
  model, kept below the drive at which the truncated relay loops could latch.
  Without the extension, dust falls back to driving DNg11 directly.
- **Taste** — sugar and bitter drops on the floor (or a direct offer) reach
  the labellar sugar/water and bitter gustatory receptor neurons, whose
  measured pathways drive — or, for bitter, veto — the proboscis motor
  neurons (Shiu et al. 2024). Contact alone gives 60% of the drive; the
  extended proboscis gives the full drive, and she feeds while it stays out.
- **Earthquake** — the ground and every object genuinely shake. The
  vibration reaches the vibration-sensitive JO-A/B neurons, which carry 1,467
  synapses onto the giant fiber, alongside a looming component from the
  shaking scene.
- **Gravity** — above 2.5x the fly can no longer sustain flight. On the
  ground, the real per-leg load feedback the locomotor circuit senses
  (campaniform-sensilla-style) now also scales with it, so a heavier body
  genuinely feels heavier while walking, not just while airborne.
- **Oxygen** — scales the real LIF baseline drive down toward true silence
  below ~10%, the way real anoxia stops a nervous system firing outright
  rather than making it "act tired."
- **Typing** — the system idle timer stands in for nearby acoustic
  disturbance and weakly drives the auditory JO-A/B neurons. This one is a
  desktop-pet convention, not a measured stimulus.
- **Clock** — a circadian activity curve (siesta, night quiescence, dawn/dusk
  peaks) scales the whole circuit's baseline drive.

## Injury, restraint & death

A missing leg is hidden, but more importantly its contact/load feedback is
permanently zeroed in what the real MaleCNS locomotor circuit senses — a real
proprioceptive change, the same pathway the locomotor tests exercise, not a
cosmetic one. **Freeze** holds the fly exactly where it stands — the entire
brain and every sense keep running normally underneath, only movement is
blocked (unlike the old wall-pin, it never teleports the fly anywhere).
Sustained squeezing, extreme wind, prolonged wing/leg loss, drowning,
burning, freezing and oxygen starvation all drain a real health budget; at
zero the fly dies — its circuit goes genuinely silent (`activityScale` forced
to 0), not just unresponsive to new input. **Respawn** rebuilds the LIF
simulation from scratch: every membrane potential, refractory timer and noise
seed restarts, while the real anatomical wiring itself is unchanged — a fresh
individual of the same species, not the same fly with amnesia. "Restore fly"
clears legs/wings/wetness/freeze without touching neural state.

## Running a thermal-preference experiment

The Lab workspace contains the classic Drosophila gradient assay as a guided
protocol (18–32 °C gradient against a flat 25 °C control, several simulated
minutes per individual). It can also be run by hand: set a gradient in
Stimulate → World (the temperature becomes the arena's *mean*), show the
spatial map coloured by dwell time, and record. The map refuses to report a
preference below ten minutes of measurement: replicated runs of a spatially
*uniform* arena scored anywhere from 6% to 58% over four simulated minutes.

What it finds is itself a result. Replicated headless runs put her at 0.505 of
the way across a uniform arena — no bias, as it should be. With temperature
reaching her real hot and cold cells (and no longer her looming detectors),
no preference is detectable (0.482; p 0.68 against uniform; the 2.0 protocol:
15% vs 16% time in the comfort zone, p = 1.0). The model does not reproduce
the heat avoidance a real fly shows; the internal AC thermosensors that
mediate it (Hamada et al. 2008) are not in the circuit. Numbers and caveats in
`VALIDATION.md`.

## Known limits

See [`VALIDATION.md`](VALIDATION.md) for the full per-system real-vs-modeled
audit, current circuit provenance numbers, test-suite invariants and a
profiled performance breakdown. Summary:

- Windows does not composite the window specially above **exclusive**
  fullscreen apps in other applications; that's normal window behavior, not
  specific to this app.
- A lost WebGL context (GPU driver crash, laptop GPU switching, sleep/resume)
  is caught and a recovery attempt is made automatically, with an on-screen
  notice either way — it no longer just silently goes black.
- The resting synapse web is a deterministic, capped sample (still tens of
  thousands of real synapses) for GPU performance at 784k edges — any real
  edge, sampled or not, still lights up in full the instant it actually
  fires. The Groups legend filters this sample by real
  endpoint classification, not by a separate "importance" heuristic.
- There is no antennal-lobe/odorant-receptor data in the extracted circuit,
  so distinct smells aren't distinguished — only concentration is real.
- Dopamine/serotonin/octopamine readouts are real per-synapse signaling
  rates (from FlyWire's neurotransmitter prediction), not measured hormone
  concentrations — this model has no volume-transmission or bulk
  neuromodulator level, only spike-driven synaptic delivery.

## Layout

| file | contents |
|---|---|
| `main.js` | Electron main: window, tray, OS idle/CPU senses, loads connectome data, specimen service, save dialogs |
| `preload.cjs` | main -> renderer bridge; CommonJS so it loads under the renderer sandbox |
| `renderer/app.html`, `neurofly.css` | page skeleton and styles |
| `renderer/app.js` | boots the workers, views and panels; render loop |
| `renderer/sim-worker.js`, `sim-client.js`, `lab-worker.js` | live closed loop and experiment rig in Web Workers |
| `renderer/view/` | three.js terrarium (incl. the fly's rendered eye) and connectome view |
| `renderer/ui/` | shell, eight workspaces, inspector, charts, widgets |
| `renderer/i18n.js`, `i18n-de.js` | English source strings, German dictionary |
| `src/closed-loop.js` | the complete 120 Hz loop: world, senses, brain, body, instruments, events |
| `src/sim.js` | `LIFSim`: CSR network, populations, rate EMAs, attribution, genetics, stimulation, plasticity |
| `src/causal.js` | input history and causal explanations |
| `src/experiments.js`, `stats.js` | guided protocols and their statistics |
| `src/flymodel.js` | body geometry and the behaviour layer (states, gait, flight, grooming, feeding, sleep) |
| `src/locomotor.js`, `legdynamics.js` | MaleCNS nerve-cord simulation; articulated legs and ground contact |
| `src/world.js`, `vision.js`, `display.js` | terrarium; early vision; observer-side exposure |
| `src/spatial.js`, `recording.js`, `history.js` | instruments (measure, never write to the simulation) |
| `src/specimen*.js`, `swc.js` | anatomy explorer (not simulated) |
| `src/data.js` | Node-only data loading, audits, extensions, fingerprints |
| `test/` | 28 suites plus `electron-smoke.mjs` |

Data comes from `../data/` (`brain_points.json`, `circuit.json`,
`circuit_annotations.json`, `thermo_extension.json`,
`sensory_extension.json`, `sentience_pathways.json`,
`locomotor_circuit.json`) and `assets/connectomes/` for the anatomy
explorer. Source URLs, releases and limitations are recorded in
[`LOCOMOTOR_PROVENANCE.md`](../data/LOCOMOTOR_PROVENANCE.md),
[`assets/connectomes/README.md`](assets/connectomes/README.md) and the root
README.

