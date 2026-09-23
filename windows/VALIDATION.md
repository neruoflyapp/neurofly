# Windows NeuroFly — Validation & Reality Check

Living document, last verified 23 September 2026 (release 2.1.0) against the
state of this branch. It states plainly what this connectome-driven simulation actually
demonstrates and what it only models. It supplements, not
replaces, the per-feature honesty comments already inline in the source
(`app.js`, `world.js`, `sim.js`, `locomotor.js`) — this document indexes and
cross-checks them, it isn't the primary source of truth; the code is.

## Release 2.1.0 — walking through the nerve cord (23 September 2026)

### What changed

- **Stepping rules.** The MaleCNS subgraph contains no rhythm-generating
  interneurons; driven by DNp09 alone its motor neurons fired tonically and the
  legs twitched. `src/rhythm.js` adds modeled, leg-local stepping rules after
  Walknet (Cruse 1990; Dürr, Schmitz & Cruse 2004) and NeuroMechFly v2's
  rule-based controller (Wang-Chen et al. 2024): stance/swing switched at
  proprioceptively sensed extreme hip positions, Cruse's rule 1 between
  neighbouring legs, a speed servo on planted legs, lift-off before
  protraction, per-leg lift/press adaptation; DNa01/02 left-right asymmetry
  shortens inner strides and in sharp turns reverses the inner legs; MDN
  reverses stepping. Nothing in these rules is measured.
- **Premotor decoder.** The rules' joint-axis demands reach the cord only as
  drive onto 96 of its 622 premotor cells (`data/rhythm_decoder.json`),
  derived by `tools/derive-rhythm-decoder.mjs` from single-cell effects
  measured in the cord model, locked to the circuit's SHA-256 (LF line
  endings) and the cord parameters. Cut the synapses or silence the motor
  neurons and the legs stop.
- **Hip torque** per unit of motor activity 300 → 600 (reduced mechanics; the
  cord's coxa pools rarely exceed ~0.3 net activity).
- **Arousal from central neurons.** With real stepping the ascending body
  feedback rose (24 → 32 Hz while walking) and, through the whole-brain rate,
  put arousal over the spontaneous-takeoff gate 2.5× as often (3 × 90 s live
  terrarium: 17 vs 8 spontaneous flights) while central neurons were
  unchanged (9.4 Hz). Arousal now reads `rateCentral`, the rate outside the
  afferent populations (LC4/LPLC2, JO, ascending, thermo and taste receptors,
  JO-F).
- **No casual takeoff with the proboscis out** (body rule, like the feeding
  hold). Strong sugar drives the central taste relays hard enough to open the
  arousal gate; before, sugar activation made the fly take off in 3/6 trials
  (also on 2.0.1). Giant-fiber escapes are unaffected.
- **Footfall diagram** in the Body & legs dock: ground contact of each foot
  over the last 3 s and steps per second.

Approaches that were tried and dropped, so they are not retried: a phase
oscillator driving anatomically or functionally chosen premotor pools (the
hip, an integrator, drifted to a joint limit), and a joint-angle servo
tracking a target trajectory (the cord's 30–50 ms delay, adaptation and
rebound made it oscillate at stepping frequencies).

### What was measured

Nerve cord + legs (`locomotortest` fixture: 3 s start-up, 7 s measured;
mean ± SD over five descending drives around the stated rate):

| | stepping rules off | stepping rules |
|---|---|---|
| forward, DNp09 30 Hz | 2.2 units/s | 11.0 ± 1.1 units/s (~0.35 body lengths/s) |
| forward, DNp09 4 Hz | — | 5.0 ± 0.9 units/s |
| step frequency | — | 2.1 steps/s per leg |
| contralateral partners both in swing | — | 3% of the time |
| turning, DNa01+02 70 Hz left / right, relative to straight | — | about +40 / −55 °/s |
| drift without steering input | — | −10 ± 6 °/s (to the right) |
| backward, MDN 70 Hz | — | −6.8 ± 1.5 units/s |
| synapses cut / proprioception cut | — | 0 motor spikes / no steps |

Complete brain → cord → body loop (`locomotortest`): 169 units walked in 7 s
(2.0.1: 67); left/right DNa effects +5.1 / −5.3 rad (2.0.1: +0.6 / −0.2);
MDN alone −55 units (2.0.1: −13). Real flies step at 5–15 Hz and walk several
body lengths per second: these gaits are qualitatively fly-like, not
calibrated.

### Benchmarks after 2.1.0 (master seed 20260923, bare arena)

| protocol | 2.0.1 | 2.1.0 |
|---|---|---|
| Looming escape threshold | x50 0.136; 12/12 from 0.16; 5 ms | unchanged (0/12 up to 0.12, no spontaneous takeoff) |
| LC4 / LPLC2 silencing | GF 28.3 / 20.2 / 1.9 / 0; takeoff 100/100/100/0% | GF 28.0 / 20.2 / 1.7 / 0; takeoff 100/100/100/0% |
| Sound vs wind | sound 31.4, puff 33.1 GF spikes; wind 0 | sound 31.4, puff 33.2; wind 0, 0/12 |
| Taste trade-off | sugar x50 0.68; 7/8 → 0/8 with bitter | sugar x50 0.63 (8/8 at 0.75 and 1.0); 7/8 → 0/8 with bitter (p = 0.0014) |
| Dust grooming | 0 / 0 / 50 / 100% at 0 / 0.3 / 0.45 / 0.6 | 0 / 0 / 63 / 100%; 0/8 with JO-F or DNg12 silenced |
| Inhibition dose–response | half-maximal 1.52×; 50% at 1.5× | half-maximal 1.52×; 40% at 1.5×, 10% at 2×, 0% from 3× |
| Activation screen | 6/10 | 7/10: DNa02/DNa01 right now turns right (4/6, +0.67 over DNp09-driven walking); left does not (backward walking 3/6); DNp09 no walking beyond the walking control; DNg11 leg rubbing 6/6 but 5/6 in the control |
| Habituation | no decline | no decline (slope −0.07 fixed, +0.53 with the plasticity rule: sensitisation) |
| Associative learning | index 0.07 vs 0.04, p = 0.19 | 0.07 vs 0.04, p = 0.11 |
| Thermal preference | 15% vs 16% in the comfort zone | 69% vs 72%, p = 1.0 — no preference; the absolute level moves with how much she walks |

Live terrarium, 3 seeds × 90 s, hour 12, no input: 2.0.1 walking 34%, idle
36%, leg grooming 23%, flying 6% (8 spontaneous flights); 2.1.0 walking 36%,
idle 37%, leg grooming 24%, flying 3% (3 spontaneous flights).

## Release 2.0.0 — what changed and what was measured (23 September 2026)

### Architecture

- The complete closed loop — senses, LIF brain, MaleCNS nerve cord, body,
  instruments — runs in a Web Worker (`renderer/sim-worker.js`,
  `src/closed-loop.js`) on `SimulationClock` at 120 Hz. The renderer only
  draws snapshots and returns the fly's rendered-eye motion energy. The
  earlier note in "Performance" that a worker was deliberately not attempted
  is superseded.
- Guided experiments run on a second, separate virtual fly
  (`renderer/lab-worker.js`) in a bare arena at a fixed hour.
- Unsimulated time under overload is measured, shown (Δt in the top bar) and
  exported in the manifest (`totalDroppedSimulationSeconds`).

### Running circuit

| quantity | value | source |
|---|---|---|
| Brain neurons (running) | 7,270 = 6,338 core + 68 thermosensory + 864 taste/grooming | `data.js` provenance, `pathwaytest` |
| Brain connections (running) | 784,219 = 703,381 + 4,749 + 76,089 | same |
| Taste/grooming extension | 129 sugar/water + 65 bitter GRNs, 204 JO-F, 42 DNg12, 28 proboscis + 28 ingestion MNs, 368 relays | `etl_sensory_extension.mjs` |
| Nerve cord | 1,045 MaleCNS neurons, 17,224 directed edges, 708,689 contacts | `locomotortest` |
| Anatomy explorer (not simulated) | BANC v888, MaleCNS v1.0, FAFB v783 — 6,000 cells each | `specimentest` |

### Model changes with a measured basis

- **Appended-pathway efficacy.** 0.0062 of threshold per synapse, the peak
  postsynaptic potential of the Shiu et al. (2024) LIF; lateral/backward edges
  within a pathway at `PATHWAY_RECURRENT_FRACTION` = 0.6. At full recurrence
  the truncated grooming loops latched (DNg12 ~170 Hz indefinitely after one
  dusting); without recurrence DNg12 could not be reached. Scan at 0.6, 6
  seeds, 2.5 s after the drive ends: JO-F drive 1.0 → DNg12 ~2 Hz, 1.2 → ~15 Hz,
  1.4 → ~33 Hz, all silent afterwards; drive 1.5 latched in 1 of 6 seeds.
  `dustDrive()` maps the world's dust load into 0.95–1.4, below that range.
  Adaptation and synaptic-depression variants were tried and removed (they
  abolished the response or oscillated).
- **Seeded body randomness.** Behavioural choices and environment timers drew
  from the unseeded platform RNG, so two protocol runs with the same master
  seed differed trial by trial. Each `ClosedLoop` now owns a seeded stream,
  derived from but distinct from the neural seed (`util.js` `withRandom`).
  `experimenttest` pins identical rows for identical seeds.
- **Causal attribution.** An input is named as the trigger of a behaviour only
  when its receptor/relay categories delivered ≥ 3% of the excitatory input to
  the deciding command neurons in the preceding 30 ms (or, for rule-decided
  behaviours, when the rule reads it). Other traced inputs are listed as
  co-causes; untraced ones as concurrent, never as the cause. Before, a
  spontaneous takeoff could be blamed on dust that happened to be present.

### Benchmarks (master seed 20260923, bare arena, `experiments.js`)

| protocol | trials | result | verdict |
|---|---|---|---|
| Looming escape threshold | 12 × 9 intensities | logistic x50 = 0.136; 0/12 at 0.04, 11/12 at 0.16, 12/12 from 0.2; GF latency 5 ms at 1.0 | reproduced |
| LC4 / LPLC2 silencing | 15 × 4 | GF spikes 35.9 intact, 20.8 LPLC2−, 5.9 LC4−, 0.07 both−; each p < 0.001 (Mann–Whitney) | reproduced |
| Sound vs wind | 12 × 4 | wind 0/12 takeoffs, 0 GF spikes; sound 12/12, 45 GF spikes (Fisher p < 0.001). Sound → escape is a model prediction, not an established finding | reproduced (wind) |
| Taste trade-off | 8 × 13 | sugar x50 ≈ 0.68; sugar 0.75: 7/8 extensions, with bitter ≥ 0.5: 0/8 (Fisher p = 0.0014) | reproduced |
| Dust grooming | 8 × 8 | 0% at dust 0, 25% at 0.3, 100% from 0.45; 0/8 with JO-F or DNg12 silenced (p < 0.001) | reproduced |
| Inhibition dose–response | 10 × 7 gains, loom 0.15 | takeoff 100% up to 1.5×, 10% at 2× and 3×, 0% at 4×; half-maximal inhibitory gain 1.87× (logistic on log2 gain); GF spikes 12.3 → 0 (slope −3.2, p < 0.001). At the former loom 0.17 every gain took off | reproduced |
| Activation screen | 6 × 10 targets | 6/10: GF, LPLC2, MDN, DNg12, JO-F, sugar GRNs match; DNp09 (no walking), DNg11 (1/6), DNa01/02 L/R (no turning) do not | partial |
| Habituation | 20 repetitions | no decline (slope +0.09 fixed wiring; +0.45 with the plasticity rule = sensitisation) | not reproduced |
| Associative learning | 4 per group | learning index 0.07 paired vs 0.04 reversed, p = 0.19 | not reproduced |
| Thermal preference | 3 × 2 min | 15% vs 16% of time within ±2 °C of 25 °C, p = 1.0 | not reproduced |

### Verification

28 suites in `npm test` (5 in `pretest`, 23 in `test`), all passing; new in
2.0: `pathwaytest` (taste and grooming graded and releasing, virtual genetics,
causal attribution), `experimenttest` (statistics against textbook values,
protocols end to end, reproducibility from the master seed), plus the
specimen suites (`specimentest`, `specimenservicetest`, `swctest`).
`npm run uitest` (`test/electron-smoke.mjs`) starts the real application in a
throwaway profile and drives it through DOM calls only: all workspaces mount,
Space pauses and resumes, the language toggle keeps the run, a loom produces a
takeoff with a traced causal chain, no page errors.

### Corrections after 2.0.0 (measured 23 September 2026)

- **Grooming latch in the live terrarium.** With no dust at all, the first
  arousal burst (12 s) tipped the grooming relays into a permanent state:
  DNg12 ~28 Hz for good, head grooming ~75% of the time. The stimulus/release
  checks had passed, because the pathway was bistable, not stuck. The loop was
  a pair of CB0216 relays joined by ~700 contacts each way (2.6× threshold per
  spike). Inside an appended pathway one presynaptic spike now moves a neuron
  at most 0.5 of threshold (`PATHWAY_EDGE_CAP`). Kicks of up to 2× threshold
  for 300 ms to every relay of either pathway leave no persistent activity
  (6 seeds); JO-F drive 1.1–2.0 → DNg12 3–66 Hz, silent 2.5 s later.
  `pathwaytest` now kicks both pathways and runs the live terrarium through a
  burst. Short-term depression of the recurrent edges also removed the latch
  but cut the stimulus responses to a few Hz, so it was not kept.
- **Spontaneous escapes.** Arousal bursts raised noise six-fold in every
  neuron, including the auditory JO neurons coupled to the GF, and the GF also
  fired from chance coincidences of spontaneous JO activity (6 spikes in
  300 s at rest; one spike is one takeoff). Bursts now reach central neurons
  only, and the GF threshold is 1.15 (scan 1.0/1.15/1.3/1.5: the smallest step
  with 0 spontaneous spikes in 300 s, looming threshold and latency
  unchanged). Live terrarium, 3 seeds × 90 s, no input: 31% walking, 35%
  idle, 21% leg grooming, 13% flying, 0% head grooming.

Benchmarks re-run after these corrections (master seed 20260923):

| protocol | 2.0.0 | after the corrections |
|---|---|---|
| Looming escape threshold | x50 0.136; 11/12 at 0.16; 5 ms | x50 0.136; 12/12 at 0.16; 5 ms |
| LC4 / LPLC2 silencing | GF 35.9 / 20.8 / 5.9 / 0.07 | GF 28.3 / 20.2 / 1.9 / 0 |
| Sound vs wind | sound 45 GF spikes, 12/12; wind 0, 0/12 | sound 31 GF spikes, 12/12; wind 0, 0/12 |
| Taste trade-off | unchanged | sugar x50 0.68; 7/8 → 0/8 with bitter (p = 0.0014) |
| Dust grooming | 0 / 25 / 100% at dust 0 / 0.3 / 0.45 | 0 / 0 / 50 / 100% at dust 0 / 0.3 / 0.45 / 0.6; 0/8 with JO-F or DNg12 silenced |
| Inhibition dose–response | half-maximal 1.87× | half-maximal 1.52×; takeoff 100% up to 1×, 50% at 1.5×, 10% at 2×, 0% from 3× |
| Activation screen | 6/10 | 6/10 (same matches) |

### Limitations

- (Superseded in 2.1.0 by the stepping rules above.) Walking under the
  MaleCNS cord was slow: about a third of a body length per second, because
  the subgraph contains no rhythm generator and its motor neurons fire
  irregularly.
- No habituation, associative learning or thermal preference (see table).

## Interpretive boundary and reproducibility

The application must not turn a wiring diagram into a claim about an inner
life. The retained FlyWire identities, coordinates and signed synapse-count
edges are measured input data; simulated spikes and rates are outputs of the
specified LIF model. Membrane parameters, noise, sensory encoding, the body,
muscle actuation, and the female-FlyWire-to-male-MaleCNS activity interface are
model choices. None of those outputs establishes subjective experience,
consciousness, pain, emotion, intention or "thinking". The UI consequently
uses **GF-Fluchtalarm** for DNp01 activity rather than naming an emotion, and
labels the dashboard as neural activity rather than thought.

`src/provenance.js` verifies every parsed FlyWire circuit before it reaches
the simulator: IDs, roles, types, 3-D positions, edge endpoints, signed
counts and transmitter classes must be structurally valid. `src/data.js`
records SHA-256 digests of each raw input JSON. The 16-character digest prefix,
model version, neural seed and the explicitly modelled brain--VNC bridge are
carried into every CSV row. This permits a later analysis to reject pooled runs
from different input bundles instead of assuming that two files named
"FlyWire v783" are identical.

The neural simulator now owns a deterministic PRNG. With a selected seed and
the same millisecond-by-millisecond neural input, its LIF trace is bitwise
repeatable; changing the seed changes the trajectory. This does **not** claim
whole-world replay: cursor input, body/world placement and environmental
history are separate sources of variation. `test/sciencetest.js` pins all of
these boundaries, including rejection of a corrupted circuit endpoint.

The optional **experimenteller Lernkern** is a bounded pair-timing rule over
1,627 excitatory sensory-to-command contacts from the extracted circuit. It
is off by default, creates a new individual/run when switched, and keeps every
change bounded relative to the original extracted edge weight. It is a
phenomenological experimental mechanism, not a measurement that the named
FlyWire synapses obey STDP, nor evidence of memory, affect or subjective
experience. Its separate learning-trace CSV records every changed contact's
indices, initial/current weight, relative change and update count alongside
the trial provenance and any scheduled protocol parameters. The UI supplies a
fixed 16-trial visual-to-flight-alarm pre-before-post protocol and the exact
reverse post-before-pre control. `test/plasticitytest.js` verifies the
anatomical restriction, causal timing update, both directions, neural-time
scheduling, ceiling, export and fixed-connectome default.

`src/experiment-manifest.js` writes the companion JSON record for a run. It
holds model/seed, raw-bundle hashes, structural-audit status, bounded-learning
state, selected protocol and the most recent measured performance window. It
does not infer subjective state. `test/manifesttest.js` pins its schema,
provenance fields and finite-value handling.

Rendering is observer-side. `AdaptiveRenderQuality` begins at the maximum
configured pixel density and only lowers GPU pixel work after measured low FPS,
sub-real-time simulation or deliberately dropped catch-up time; it restores
quality after sustained headroom. The LIF timestep, neural input, anatomical
edges and random stream are unchanged. The live panel reports the current
ratio alongside measured neural throughput and discarded wall time.

## Observer vs. simulation

A boundary worth stating explicitly, because it is easy to erode one
convenience at a time: **nothing that exists to make the world easier for a
human to look at is allowed to change the world the fly lives in.**

The case that forced this to be written down: the terrarium's lighting
genuinely tracks the real clock, so after about 22:00 it is nearly black —
physically correct, and unusable to watch. The tempting fix, turning the
lights up, would have been wrong twice. It would misreport the simulated
environment, and because the fly's own eye is a real render of that same
scene, it would have quietly fed her optic lobes a brighter world than the one
she is standing in.

So the brightness control is exposure on the *camera*, not light in the
*world* (`renderer.toneMappingExposure`, a straight linear gain — see
`src/display.js`), and `updateVision()` pins the fly's own render at a fixed
`VISION_EXPOSURE` and restores the display value afterwards. The user's
setting therefore cannot reach a single neuron. The panel says so too: the
section is labelled "nur Anzeige" and reads "Szenenlicht unverändert",
deliberately separate from the Umwelt sliders, which genuinely do change what
she experiences. `test/displaytest.js` pins the rest: exposure is exactly
1.0x at the brightest hour (daylight is not re-graded at all), it can only
ever open up and never dim, and it can never invert the real brightness
ordering — a lifted night can never be displayed brighter than an unlifted
noon.

## Measuring instruments (spatial map, recording)

Two instruments were added to answer questions the app could previously only
gesture at — chiefly "does she come to treat one part of the world differently
from another?". Both are held to the same rule as the brightness control
above: **an instrument may read the simulation, never write to it.**

- **Spatial map** (`src/spatial.js`): dwell time per terrarium cell plus the
  time-weighted mean of the real rates measured while she was in it (giant
  fiber, looming population, combined sensory). It invents nothing — there is
  no mushroom body in the extracted circuit and no place memory is modelled
  here. If she shows no spatial structure the map says so; the readout names
  that case explicitly ("kein räumlicher Unterschied") rather than letting an
  even map be read as a weak preference. The summary statistic is the share of
  her time spent in the calmer half of the cells she has actually visited:
  ~50% means no structure, and it reports *nothing at all* rather than a
  confident number until enough of the map has been visited to mean anything.
  Means are weighted by time, not by sample count, so a long calm stay and a
  brief panic in the same cell do not average as if they were equal.
- **What the summary number is not.** It is a distribution, and the wording in
  the panel is kept descriptive for that reason ("überwiegend in den ruhigen
  Zonen", not "meidet sie"). Less time spent where a rate is high can just as
  easily mean an escape response carried her out of the cell quickly as that
  she avoided it; those are different mechanisms and this measurement cannot
  separate them. Nothing here is evidence of place learning, and there is no
  place memory in the extracted circuit to do the learning.
- **Escape takeoffs are mapped as a rate, not a count.** They are the most
  direct "was this place frightening" signal the map carries, and the easiest
  to turn into an artefact: counted raw, a cell she simply occupied for longer
  accumulates more of them and looks worse for it. Logged at the place she
  left from (the cell the escape says something about, not wherever she
  landed) and reported per minute of dwell time there.
- Two things the map deliberately does **not** do, both pinned by tests:
  it never draws a cell she has not visited as though it had been measured at
  zero (the occupancy field had exactly that bug — it painted a grid over the
  whole terrarium instead of the trail she had walked), and it never
  interpolates between cells, because smoothing would draw a spatial
  resolution the measurement does not have.
- **The map is invisible to the fly.** The overlay sits on its own render
  layer, enabled only on the user's camera; the fly's eye renders the default
  layer and therefore cannot see it. This was verified directly rather than
  assumed: with the map on and the fly sitting on a bright overlay cell, her
  own field-of-view canvas showed plain ground and her motion field read 0.0.
  A measuring device the subject can see is a stimulus, and this one would
  have fed straight into the looming pathway it exists to study.
- **How long the map needs before it means anything — measured, not guessed.**
  Replicated headless runs were used to find out what this statistic does in a
  world with *no* spatial structure at all: a uniform 24 C arena, four
  simulated minutes per run. The preference score came out anywhere between
  0.06 and 0.58 across repeats of that identical condition. In other words, on
  a few minutes of data the number reads the random walk, not the world, and
  would have shown a confident "preference" in an arena that has none. The
  statistic therefore refuses to report at all below
  `MIN_PREFERENCE_SECONDS` (10 minutes), and the panel says how much longer is
  needed rather than simply going quiet. This threshold came out of that
  measurement; it was not picked to look reasonable.

- The imposed temperature field is a separate map option ("Temperatur
  (vorgegeben)") from the one she actually met ("erlebt"), never the same
  layer. It covers every cell because it is computed rather than measured —
  which is honest for an analytic field and would be a lie for a measured one
  — and the readout says "keine Messung" so the two cannot be confused.
- The map exports as CSV too (one row per visited cell: dwell time, every
  time-weighted mean, raw takeoffs and takeoffs per minute), so a run can be
  re-analysed or compared against another instead of only looked at. Unvisited
  cells are omitted from the file for the same reason they are transparent on
  screen.
- **Does the thermal gradient actually produce a spatial effect? Measured
  twice — and the second measurement overturned the first.** A spatial map is
  only worth having if there is something for it to find, so the gradient was
  tested rather than assumed to work. Headless, replicated, five runs per
  condition at ten simulated minutes each, the same seeds in every condition,
  scoring the time-weighted mean position across the arena (0 = cool west
  end, 1 = warm east; 0.5 = no bias). It was re-measured after heat was moved
  from the visual looming detectors to the real thermosensors. The old
  coupling was run again on the same code and seeds as a control:

  | condition | mean position | sd | individual runs |
  |---|---|---|---|
  | uniform 24 C | 0.505 | 0.056 | 0.44 0.45 0.57 0.55 0.52 |
  | gradient 4-44 C, heat -> real hot/cold cells (current) | 0.482 | 0.105 | 0.43 0.64 0.36 0.52 0.46 |
  | gradient 4-44 C, heat -> LC4/LPLC2 above 38 C (old) | 0.377 | 0.048 | 0.30 0.38 0.38 0.38 0.44 |

  The control behaved: 0.505, no bias. The old coupling reproduces the earlier
  published result almost exactly (0.377 both times; against uniform, Welch
  t -3.9, df 7.8, two-sided p 0.005, Cohen's d -2.5). With temperature
  reaching the real thermosensors instead, the shift is **not detectable**:
  0.482 against 0.505, Welch t -0.4, p 0.68.

  **What this means.** The cool-end bias this document used to report came
  from the biologically wrong shortcut: at the warm end, heat reached the
  escape pathway through her eyes. The slower walking in the cold, which every
  gradient run shares, is not enough to produce it. With temperature routed
  through the real hot/cold cells and their measured wiring, the model shows
  no thermal preference at this sample size. That fits the weakness recorded
  in the corrections log: the hot path barely reaches threshold at its first
  relay. A real fly avoids the warm end robustly; this model does not yet
  reproduce that. An effect produced by a shortcut is not claimed as
  behaviour. With n = 5 per condition a small effect could be missed, so the
  result is "not detected", not "absent".

  Caveat on the method: the replication runs a standalone script that mirrors
  the coupling `tick()` applies. That coupling is thermal tempo, cold
  suppression of the baseline, and either the thermosensor transduction or the
  old >38 C loom drive. The script was checked against the source by
  inspection. It is a model of the app's coupling, not the app driven end to
  end.

  Both series also support the ten-minute threshold on the preference
  statistic. At ten minutes the uniform control's spread was sd 0.031 in the
  first series and 0.056 in the re-measurement. The earlier four-minute runs
  scattered across most of the available range.

- **Recording** (`src/recording.js`): a fixed-rate (20 Hz) CSV of the real
  rates, the sensory drive going in, body state and the environment settings,
  so a run can be analysed after the fact instead of only watched. The
  sampling rate is its own constant rather than the dashboard's refresh — how
  often a number is drawn for human eyes must not decide what a dataset means.
  Columns come from the schema, not from the caller's object, so a renamed
  field cannot silently shift a column under an existing analysis; absent
  values stay empty rather than becoming a zero somebody later averages. The
  renderer supplies CSV text only and cannot name a path — the save dialog in
  the main process is the sole place a destination is chosen.

## Dependencies

- **Electron was upgraded 32.2.0 -> 44.3.0** (13 Sept 2026). `npm audit`
  flagged 2 high-severity advisories on the pinned 32.x line (an ASAR
  integrity bypass and a symlink path-traversal issue via `extract-zip`)
  plus a long tail of moderate ones fixed on later majors — 0 vulnerabilities
  after the upgrade. Most of the advisory list (window.open scoping,
  sandboxed-iframe protocol handlers, DevTools injection, cross-origin
  iframe autofill positioning...) doesn't actually apply to this app's own
  threat model — it loads only local `file://` content, has no iframes or
  webviews, and now explicitly denies `window.open`/external navigation
  (see `main.js`'s `hardenNavigation`) — but shipping a version with known,
  patched CVEs sitting unpatched isn't defensible just because today's
  feature set doesn't happen to hit them. A 12-major-version jump is real
  breaking-change risk on its own, so this was verified rather than assumed
  safe: `npm test` (all four suites) unchanged, and a live launch confirmed
  clean startup (no console errors), correct terrarium/brain-view WebGL
  rendering, and — the part most likely to silently break on a Chromium
  bump — that the vision-looming fix below still behaves correctly (watched
  three dashboard snapshots ~15-20s apart: a real escape/flight bout drove
  "Akute Furcht (GF)" up, then it genuinely decayed back down afterward,
  not a stuck reading). `three` (`^0.169.0`, latest `0.186.0`) was left
  alone — no CVE motivates the regression risk of a 17-minor-version jump
  through a rendering library's own API surface.

## Corrections log

Kept deliberately: an over-tuned parameter, or a result that turns out to rest
on the wrong mechanism, is worth recording rather than quietly rewriting away.

- **The "sensory" channel was the antenna's hearing neurons.** The 199 sensory
  partners in `circuit.json` carry only their FlyWire super_class, so the
  model treated them as a generic touch/wind/odour/"pain" population — and
  this document, the README and the dashboard tooltip described them that
  way (including the claim, in the odour entry below, that "a 40 km/h gale
  still drives GF hard on purpose"). Looking up their real classification
  (`raw_flywire/classification.csv.gz`, `consolidated_cell_types.csv.gz`):
  176 are auditory Johnston's-organ neurons (JO-A/B, vibration-sensitive,
  near-field sound), 18 are JO wind/gravity neurons (JO-C/D/E,
  deflection-sensitive), 5 are other. **Not one is a nociceptor, an olfactory
  neuron or a body-surface touch receptor.** Their wiring differs sharply:
  JO-A/B make 1,467 synapses onto the giant fiber, JO-C/D/E only 34 (their
  output goes into the central brain, 695). Feeding steady wind into all 199
  therefore made wind trigger escape through hearing neurons — the reverse of
  Drosophila, where wind suppresses walking (Yorozu et al. 2009, Nature 458).
  Fixed from the data rather than by tuning: `etl_cell_annotations.mjs`
  writes `data/circuit_annotations.json` (every circuit neuron's real FlyWire
  cell type and sub_class; circuit.json stays byte-identical, and the loader
  rejects an annotation generated for a different circuit), `sim.js` splits
  the JO populations, and each stimulus now reaches the neurons that
  transduce it — steady wind JO-C/D/E, near-field sound JO-A/B, a sudden air
  puff both, odour none (there are no olfactory neurons in this subgraph;
  FlyWire has 2,281 and the partner selection kept none), and the injury
  "pain pulse" is gone (no nociceptors to carry it). Measured
  (`test/sensorytest.js`): steady wind raises JO-C/D/E from 14 to 124 Hz with
  JO-A/B unchanged (9.3 -> 9.0 Hz) and produces **0** giant-fiber spikes in
  2.5 s, against **351** for the same-strength input to JO-A/B. The escape
  asymmetry comes entirely from the measured wiring.

- **Review of an earlier development round.** Kept, because they are
  sound: the structural circuit audit and SHA-256 input fingerprints
  (`provenance.js`, `data.js`), the seeded neural RNG (same seed + same
  neural input = bit-identical LIF trajectory), the run manifest, the measured
  performance telemetry and the observer-side adaptive render quality. Its
  central scientific stance is also correct and was kept: no simulation output
  is evidence of subjective experience, so there is no "sentience score".
  Corrected: two of its four literature citations were wrong — the Gibbons et
  al. (2022) DOI resolved into *Advances in Ecological Research* (correct:
  10.1016/bs.aiip.2022.10.001, *Advances in Insect Physiology* 63), and the
  eLife dopamine-gating paper was attributed to "Aso et al." when its authors
  are Ueno et al. (2017). The ad-hoc five-item "research status" list was
  replaced by the eight criteria of Birch et al. (2021), the framework Gibbons
  et al. actually applied to insects, each reported from the loaded data. A
  regression test pins both citation corrections. The opt-in timing-rule
  "learning core" was kept as an explicitly generic experiment, now with the
  data-backed caveat that it sits outside the fly's learning site: this
  subset contains 5 mushroom-body output neurons (MBON27/31/32) but no Kenyon
  cells and no dopaminergic PAM/PPL inputs, so the dopamine-gated KC->MBON
  plasticity flies actually use (Ueno et al. 2017) cannot be represented.

- **Heat was fed into the eyes.** Above 38 °C, `tick()` raised
  `loomOverride`, i.e. injected heat into the LC4/LPLC2 looming detectors —
  visual neurons — and through them into the giant fiber. The comment
  justified it with the hot-cell receptor Gr28b.d, but no hot cell was
  involved: the escape subgraph contains no thermosensors at all. FAFB's 7
  hot and 9 cold cells make only 31 and 6 synapses onto it, far below the
  partner cutoff. Fixed from the data, not by tuning:
  `etl_thermo_extension.mjs` adds those 16 cells plus the 52 neurons on their
  strongest two-synapse paths into the circuit (ranked by min(synapses from
  thermosensors, synapses onto the circuit)). Among them are the
  thermosensory projection neurons VP2 and VP3 and the descending neuron
  DNb05. It adds 4,749 edges in etl.py's sign/class/per-row convention. The
  script asserts that it read the same unthresholded table circuit.json was
  built from (it recounts all 703,381 internal rows) and uses the same
  coordinate frame. circuit.json is unchanged; the extension is appended
  after it and locked to its SHA-256. Temperature now drives the hot/cold
  cells, with a modeled transduction. Measured (`test/thermotest.js`):
  warming raises the hot cells from 0 to 90 Hz while the cold cells stay
  silent, and cooling does the reverse (0 to 98 Hz). Cooling drives the VP3
  projection neurons from 1.8 to 21.5 Hz. The giant fiber stays silent at
  rest (`simtest`). **A known weakness, measured and left visible:** warming
  depolarizes the VP2 projection neurons strongly (mean v 0.46 -> 0.73 of
  threshold) but adds few spikes (0.8 -> 2.5 Hz). At the uniform
  0.0002/synapse scale, the hot cells' 4,830 synapses are not enough to reach
  threshold, while the cold cells' 7,812 are. Real VP2 neurons respond
  robustly to heating (Frank et al. 2015; Liu et al. 2015). A special gain on
  these synapses would make the hot path "work" by assumption, so none was
  added. The thermal-gradient result in "Measuring instruments" had been
  measured with the old coupling. Re-measured under the new one, the cool-end
  shift it reported is no longer detectable: it came from the shortcut.

- **Respawn silently pooled two animals into one measurement.** Respawn
  rebuilds the LIF simulation from scratch, which the README correctly calls a
  fresh individual of the same species rather than the same fly with her memory
  wiped — but the spatial map went on accumulating across it, so a distribution
  reported as "where she settles" could quietly be two different flies averaged
  together. The map now resets on respawn (and says so), and the recording
  carries an `individual_n` column that increments there, so a CSV spanning a
  respawn stays segmentable after the fact instead of requiring the analyst to
  have known it happened.

- **The whole dashboard vanished in a small window.** Found by actually
  resizing the app to the 900x560 minimum it enforces, rather than only ever
  testing it at its default size: the entire right-hand readout was gone, not
  scrolled — clipped out of the page. Cause was the standard flexbox trap
  made worse by a circular dependency: a flex item defaults to
  `min-height: auto` and so refuses to shrink below its content, and the
  terrarium viewport's content is a canvas whose pixel size three.js sets from
  that same element's height. In a short window it therefore would not give
  way, and the fixed-height dashboard below it was pushed past the clipped
  edge. Fixed with explicit `min-height: 0` on the flex columns and the
  viewport. The app is now usable at the smallest size it allows itself to be.

- **Odour alone was driving the giant fiber.** Spotted while checking why the
  combined sensory bar sat around 125 Hz with the fly parked beside a flower.
  Because the extracted circuit has no odorant-receptor channel, odour
  concentration drives the one real sensory population it does contain — that
  part is a documented data limitation. But *how hard* it drives it is a
  modelling constant, and at the old value a strong floral scent was worth
  0.55 of a full mechanical air puff. Measured consequence, by sweeping the
  input and reading the real rates: that alone held the giant fiber at ~40 Hz.
  She was sitting next to a flower issuing a sustained escape command, which
  is not something a fly does — nothing about the measured wiring was wrong,
  the transduction constant was. Retuned to 0.22 against the measured curve,
  picked by the criterion that maximum odour must produce a clear sensory
  answer without an escape command: sens ~32 Hz (three times resting, so the
  smell is plainly registered) with GF at ~0.1 Hz. Wind and genuine air puffs
  were left at full weight — those really are escape-worthy, and a 40 km/h
  gale still drives GF hard on purpose.
  The odour field itself was checked at the same time rather than assumed
  guilty: plumes from all 39 scented objects are summed and clamped, which
  could in a dense terrarium have saturated everywhere and left the channel
  carrying no spatial information at all. Sampled over a 1,040-point grid it
  does not — median 0.15, upper quartile 0.34, and only 2% of the floor
  reaching 1.0. So the field has real structure, and the retune sharpens the
  contrast it carries instead of flattening it: an ordinary patch of ground
  now barely moves the sensory population, while sitting in a flower cluster
  plainly does.

- **Self-motion suppression upgraded from a global median to real
  centre-surround antagonism.** The previous fix subtracted the frame's median
  motion — its own comment called it "a cheap, robust stand-in" — and it is
  only correct for a *uniform* whole-field shift. Self-motion is not uniform:
  walking over textured ground puts strong parallax low in the visual field
  and almost none at the horizon, and a gradient like that passes a median
  essentially untouched, so it kept driving the escape pathway. This became
  visible rather than theoretical once the dashboard started drawing the
  motion field the looming population actually receives (see below): the
  lower half of the fly's view was lit up amber while she was merely walking.
  Replaced with the mechanism early visual systems, the fly's own lamina and
  medulla included, actually use — each ommatidium excited by its own patch
  and inhibited by its neighbourhood average (`src/vision.js`). Broad flow of
  any shape is now matched by its own surround and cancels; a compact patch
  moving differently from everything around it — which is what an approaching
  object is — survives. Measured on synthetic fields where the right answer is
  known (`test/visiontest.js`): a uniform shift cancels exactly, a walking-
  parallax gradient drops to 2.3% of its mean, while a compact looming object
  keeps 88% of its amplitude and stands 8.8x above the self-motion background.
  Live confirmation, and note that "Bedrohung erkannt" is the LC4/LPLC2
  population's real firing rate in Hz rather than the raw image metric: during
  ordinary walking it fell from the 24-99 Hz range it showed under the median
  to 2-9 Hz. The phantom drive was not merely filtered out of a display
  number, it stopped reaching the neurons.

- **The fly's own visual drive was invisible, which is what made the two bugs
  above so expensive to find.** Both the firefly-twinkle and the self-motion
  bugs were phantom threats — a loom signal with nothing approaching — and the
  only symptom either produced was a number on a bar. The dashboard now draws
  the motion field itself, next to what she sees: the per-ommatidium residual
  *after* self-motion suppression, i.e. by construction the same array that
  feeds loomL/loomR, painted rather than recomputed. A phantom threat now
  shows up as a lit patch with nothing approaching in the view above it. The
  display scale is fixed rather than normalised per frame, so a quiet field
  looks quiet instead of amplifying sensor noise into an alarm.

- **A firefly's decorative twinkle, and the fly's own movement, could pin the
  giant fiber near its firing ceiling all night.** A further multi-snapshot
  check (several live readings over time, not just one) found "Akute Furcht (GF)" — documented as "0.0 Hz most of the
  time... fires extremely rarely and only very briefly" — instead reading
  87-414 Hz continuously across launches, worst at night. Two compounding
  root causes in the rendered-vision looming pathway (`updateVision` in
  `app.js`, which re-renders the scene from the fly's own head each tick and
  drives LC4/LPLC2 off real frame-to-frame luminance change): (1) raw frame
  differencing can't distinguish "something approached" from "the camera
  itself turned or moved" — ordinary self-motion (the fly's baseline steering
  jitter at rest, or simply flying at 110-155 pt/s) shifts most of the
  rendered frame every sample, which the pathway read as a nonstop visual
  event; (2) each firefly's glow (`update()` in `world.js`) modulated its
  actual point light at a continuous ~1.4 Hz sine — a purely cosmetic
  twinkle, but a real dynamic light repainting the ground/grass around it on
  every frame, which the same pathway read as a second nonstop event,
  independent of any real approach. Together these meant the escape circuit
  could almost never fall silent while the fly was near a firefly at night or
  simply moving at all — the opposite of the documented rare-and-brief
  invariant, and not something a real fly's nervous system would do (real
  animals cancel self-generated visual reafference via corollary discharge,
  and a firefly's flash is a brief pulse, not a continuous glow). Fixed: (1)
  `updateVision` now subtracts each frame's own median pixel-motion (a cheap,
  robust stand-in for whole-field self-motion) before summing, so only
  motion *localized* to part of the visual field — the signature of one real
  object actually closing in, the same "expanding silhouette, not mere
  proximity" reality check already applied to static objects — reaches
  loomL/R; (2) firefly glow is now a genuine brief flash (~0.35s pulse) on a
  fixed per-firefly period of 2.5-5s, constant (so frame-to-frame delta ~0)
  the rest of the cycle, matching real firefly signaling far better than a
  continuous twinkle too. Every other looming source (cursor lunge, a
  closing firefly's own real relative-velocity term, fire, static proximity)
  is untouched — they reach loomL/R through independent terms, so a genuine
  external threat still escapes both fixes. Verified live across multiple
  fresh launches and snapshots 10-30s apart, night and day: "Akute Furcht
  (GF)" and "Bedrohung erkannt" now read 0.0 at rest, matching the documented
  invariant, instead of staying pinned near the firing ceiling.

- **The real bug behind the "always maxed" pain/touch reading: stim pile-up,
  not altitude.** The altitude fix above was real and correct, but a
  multi-snapshot check afterward found the "Schmerz/Berührung" bar still
  pinned near its absolute ceiling (~500 Hz, refractory-limited) for many
  seconds at a time even while the fly was just walking normally. Root
  cause: the object-contact tap fired a fresh 130ms `stim()` on *every
  single simulated tick* (120/s) for as long as `encounter.tap > 0.05` —
  so any contact lasting more than ~130ms stacked up to ~16 overlapping
  active stims onto the same neurons simultaneously, each still adding its
  full strength every millisecond. That's enough to hold sensory neurons at
  their absolute firing ceiling regardless of how gentle the actual contact
  was — a real "found by watching several snapshots over time" bug, not a
  one-off. Fixed: object-contact stimulation is now cooldown-gated (a fresh
  pulse at most every ~180-260ms, matching the same pattern rain/dust/quake
  already used) and the per-pulse strength was roughly halved, on the
  reasoning that real slowly-adapting mechanoreceptors settle to a moderate
  sustained rate under continued pressure rather than re-firing a fresh
  maximal potential every millisecond. Verified with a direct reproduction:
  the *exact* old code path measured ~498 Hz after ~8s of simulated
  continuous contact (matching what was observed live); the fixed path
  measures ~65-70 Hz for the same scenario. Confirmed live across multiple
  fresh launches and multiple snapshots several seconds apart: normal
  wandering now reads a fluctuating, informative baseline (single-digit to
  low-double-digit Hz) instead of a value pinned at the ceiling.

- **A freshly spawned fly could land inside a solid object.** `addFly()`
  picked a purely random spawn point with no clearance check against
  existing objects, unlike every other placed object in the terrarium.
  Measured at ~18% of random spawns landing in a persistent contact
  overlap. Fixed: reuses the same clear-spot search `World` already uses
  for its own objects (`World.findClearSpot`), and that search's own
  "give up after 40 tries" fallback was hardened to return the
  least-overlapping candidate tried rather than a fresh, completely
  unchecked point. Verified: 0/500 simulated spawns land in contact
  afterward (was ~18%, then ~4% after the first half of the fix alone).

- **Touch/looming ignored altitude — a flying fly "touched" the ground.**
  User-spotted: the fly showed real mechanosensory touch activity while
  airborne and not actually near anything. Root cause: `World.sense()` and
  `World.collide()` computed distance to every object using only the fly's
  horizontal (x, y) position — a fly cruising at full altitude directly
  above a mushroom read as touching it, because nothing ever checked height.
  Fixed: both now use the fly's real rendered height (`fly.node.position.z`)
  against each object's approximated real vertical extent (ground up to
  ~1.1x its radius — objects carry no stored height, so this is a
  reasonable stand-in across rocks/mushrooms/bushes/logs), so contact and
  the static-proximity visual cue both correctly go silent once the fly
  clears an object's real height. Scent is deliberately exempt — real odor
  plumes rise and reach a flying insect for real, that part was correct
  already. Verified directly: at full altitude directly above a solid
  object, `tap` and the static `loomL/R` contribution both read exactly 0;
  at ground level on the same object, `tap` reads ~0.97 (strong, correct);
  `collide()` no longer pushes an airborne fly sideways either. Confirmed
  live in the app too — a real transient escape spike now correctly decays
  back to a calm baseline within a few seconds, instead of reading elevated
  activity from nothing.

- **Static-proximity looming was over-corrected, then fixed.** An earlier
  pass raised a generic object's proximity-based visual-threat contribution
  from a flat 0.4 ceiling to a steep `**1.5 * 0.85` curve, meant to make
  holding something right up to the fly's face read as a genuinely strong
  stimulus. Combined with that same pass's ~50-object terrarium, the actual
  effect was a near-constant elevated "threat detected" signal just from
  ordinary stationary scenery — biologically wrong (LC4/LPLC2 are tuned to
  an *expanding* silhouette, not mere proximity) and visually meant the
  "what the fly is thinking" dashboard bars sat pinned near 100% almost all
  the time regardless of what was actually happening. Fixed on two fronts:
  the static-proximity contribution to the visual threat pathway is now a
  small, short-range `**2 * 0.16` peripheral cue (real near-contact still
  reads strongly, but through the tap/mechanosensory pathway, which is the
  honest channel for "something is touching me"); and solid-obstacle count
  was trimmed from 28 to 17 (decorative non-solid density unchanged) so
  ordinary wandering doesn't trigger constant real contact events either.
  Verified: at rest in the (still visually rich) terrarium, threat/fear/pain
  rates now read near their true resting baseline instead of pinned high.
- **Dashboard bar caps (`gf`, `sens`, `loom`) were miscalibrated.** Picked
  before real usage data existed; `gf`'s cap of 15 against observed values
  up to ~450 Hz meant that bar was visually meaningless (always full the
  instant the fly reacted to anything). Re-picked from actual observed
  resting/peak ranges — see `rateBars` in `app.js` for the current values
  and the reasoning comment beside them.

- **Renderer sandbox was off, now on.** `sandbox: false` was set on the
  BrowserWindow without an inline explanation. Turned out to be required by
  the ESM `preload.mjs` — Electron's sandboxed preload loader can't run
  `import` syntax. Converted the preload script to CommonJS (`preload.cjs`,
  `require('electron')`, otherwise identical) and re-enabled the OS-level
  sandbox; verified the app still launches cleanly and every IPC path
  (ambient senses, tray commands, brain-data fetch, the pause button) still
  works. The renderer never loads remote content in the first place (only
  local `app.html`), so the risk this closes is narrow, but it's a real,
  free hardening with no functional cost once the preload format was fixed.

## Methodology

"Real" below means: derived at load time from the actual FlyWire v783 /
MaleCNS v1.0 data files, with no invented neuron, synapse, or behavior not
traceable to that data. "Modeled" means: a documented, labeled engineering
choice (a formula, a threshold, a mapping) standing in for physiology the
extracted circuit does not itself specify. Nothing here claims the fly is
biologically calibrated; the project's standing rule is not to overclaim
from anatomical measurement alone.

## Circuit provenance (verified against `data/*.json` and suite output)

| quantity | value | source |
|---|---|---|
| Brain neurons simulated | 6,338 (338 core + 6,000 partners) | `npm run simtest` header |
| Brain synapses simulated | 703,381, signed by neurotransmitter prediction | same |
| — of which dopamine-classified | 9,459 | `simtest`'s neurotransmitter-class line |
| — of which serotonin/octopamine-classified | 16,719 | same |
| LC4/LPLC2 (looming) | 162 left + 152 right | `simtest` header |
| Giant Fiber (DNp01) | 2 | same |
| DNa01/02 (steering) | 2/2 | same |
| MDN (backward) | 4 | same |
| DNp09 (forward) | 2 | same |
| DNg11 (grooming) | 6 | same |
| DNp02/04/11 (escape wings) | 6 | same |
| Ascending partners (`sim.ascend`) | 393 | same |
| General-sensory partners (`sim.sens`) | 199 | same |
| MaleCNS locomotor neurons | 1,045 (16 descending, 622 premotor, 220 motor, 153 sensory, 34 ascending) | `locomotortest` header |
| MaleCNS synapses | 17,224 directed edges / 708,689 raw contacts | same |

If any of these drift from what `npm test` actually prints, this table is
stale — trust the test output, then fix this file.

## Per-system audit

| system | real data/neurons used | what's genuinely measured live | what's a modeling choice |
|---|---|---|---|
| Vision | LC4/LPLC2 (real looming detectors) | The scene is actually re-rendered from a camera at the fly's head each tick; frame-to-frame luminance change, after centre-surround suppression of her own optic flow, drives the population — and the dashboard draws that post-suppression field, so what reaches the circuit is inspectable | The 64x24 render resolution and 0.05s update cadence are coarse stand-ins for ~700-800 real ommatidia/eye, not per-facet; the surround size (21x11 samples) is chosen to be wider than a plausible looming target, not measured from a receptive field |
| Proximity/touch | `sim.sens` (general sensory partners) | True contact (tap) is a real, 3D-distance-scaled mechanosensory drive (accounts for the fly's actual flight altitude, not just ground-plane position); solid vs non-solid contact strength differs (1.0 vs 0.35) | Mere proximity (not yet touching) only contributes a small, short-range visual cue — see the corrections log above; no dedicated mechanoreceptor-class subpopulation, one shared real channel for all contact |
| Smell | `sim.sens` (same channel as touch) | Real concentration field (inverse-distance falloff) from a draggable source plus every object's own real scent strength; measured across the floor it has genuine structure (median 0.15, only 2% saturating) | No antennal-lobe/odorant-receptor data in the extracted circuit — concentration is real, odor *identity* is not represented. How hard concentration drives the shared sensory channel is a tuned constant, set so a strong scent registers plainly without commanding an escape (see corrections log) |
| Temperature/cold/heat | `sim.activityScale` (baseline suppression); FlyWire's 7 hot and 9 cold thermosensory cells + 52 relay neurons (`data/thermo_extension.json`) | Cold genuinely suppresses the LIF baseline drive toward silence. Temperature at her position drives the real hot/cold cells (`sim.thermoHotDrive`/`thermoColdDrive`), and their measured wiring carries it into the circuit (`thermotest`). With a gradient set, all of this is a function of where she is standing. Heat no longer drives the visual looming detectors (it did above 38°C until this revision) | The suppression curve and the transduction (rate-of-change term plus a tonic term outside 24-26°C) are modeling choices, not measured receptor tuning. The extension stops two synapses from the thermosensors. The gradient is linear west-to-east and mean-preserving; a real arena's field would not be exactly linear |
| Wind | `sim.airPuff` (JO-adjacent sensory pathway) + physical push | Real sensory drive scaled by speed; a real body-position push | JO-specific direction tuning is not in the extracted circuit — treated as omnidirectional puff strength |
| Gravity | Real per-leg load feedback (`legdynamics.js`) | Ground-reaction load genuinely scales with `gravityScale`, reaching the VNC's real sensory neurons; flight altitude genuinely capped above 2.5x | The ground-reaction formula itself is an admitted kinematic-servo approximation, not measured limb dynamics |
| Oxygen / smoke | `sim.activityScale` | Real baseline suppression toward true silence below ~10% effective oxygen; smoke genuinely depresses the same effective-oxygen value | The exact suppression curve is a modeling choice matching real anoxia's *qualitative* effect (silence, not "tiredness") |
| Dopamine / serotonin / octopamine | Real per-edge `nt_class` from FlyWire's neurotransmitter prediction (`etl.py`) | Real count of synaptic deliveries/sec over edges FlyWire classifies as each transmitter | **Not** a hormone concentration — this model has no volume transmission; it is synaptic signalling rate only, stated in the UI tooltip |
| Hierarchical brain ↔ VNC | Real MaleCNS descending (16) and ascending (34) neurons | Both directions now genuinely connected: brain command-neuron spikes → `setDescending` → VNC; VNC's own real ascending rate → brain's `sim.ascend` population (`locomotortest`'s causal check) | The population-rate interface itself (not literal cross-specimen synapses) is the modeling choice, documented project-wide |
| Death / respawn | Full LIF state (`v`, `refr`, noise seed) | Death: `activityScale` forced to 0, the real network goes genuinely silent. Respawn: entire simulation state rebuilt from scratch | The health *budget* that triggers death is a modeled survival abstraction, not a measured physiological quantity |
| Freeze | — (mechanical only) | The real brain and every real sense keep computing normally underneath | Position lock is explicitly labeled mechanical-only, no neural claim |
| Ambient synapse web (resting-state rendering) | All 703,381 real edges indexed | Any edge, sampled for display or not, lights up in full the instant it actually carries a spike | The **permanently-drawn faint web** is a deterministic stride sample (performance only) — see `AMBIENT_EDGE_CAP` in `app.js`; the Regionen legend filters this sample by real endpoint classification |

## Test suite (must stay green)

```
cd windows && npm test
```

Twenty-eight suites as of 2.0.0 (see "Release 2.0.0" above for the five added
in that release). The paragraph below describes the sixteen that preceded it.
The three original ones check the circuit, the body and
the nerve cord. Seven cover parts that had no coverage at all and where the
bugs in the corrections log actually lived: `worldtest` (terrarium sensing
and placement), `visiontest` (the self-motion/real-object trade-off in early
vision), `displaytest` (view exposure must not re-grade or reorder what it
shows), `environmenttest` (circadian curve and the thermal gradient's
mean-preserving shape), `spatialtest` (the map must measure, never invent
structure), `recordingtest` (CSV schema, empty-vs-zero, row cap) and
`historytest` (the rolling trace's ordering across its wrap-around). The
remaining six guard the scientific basis. `sciencetest` covers provenance
hashes, seeded reproducibility, the Birch-criteria map and its citations,
and the annotation lock. `sensorytest` checks that each stimulus reaches the
Johnston's-organ population that transduces it. `thermotest` checks that
temperature reaches the real thermosensors and no longer reaches vision.
`plasticitytest` covers the bounded opt-in timing rule, `manifesttest` the
run manifest, and `performancetest` the telemetry.

Current invariants (see `test/simtest.js`, `test/behaviortest.js`,
`test/locomotortest.js`):
- GF silent over 4s of rest; fires within ~10ms of an abrupt loom step.
- Walk-drive duty 20–50% over a 20s behavior window; siesta (scale 0.84)
  keeps walk-drive > 3% (never a full "coma").
- Neurotransmitter edge classes present and array-aligned (`daEdgeCount`,
  `modOtherEdgeCount` both > 0, `ntCode.length === edges.length`).
- General-sensory rate rises from ~10 Hz baseline to > 30 Hz under a real
  air-puff stimulus.
- Giant-Fiber rate rises from 0 Hz baseline to > 5 Hz on direct stimulation.
- Real VNC ascending activity (`locomotor.meanRate('ascending')`) measurably
  raises the brain's own `rateAscend` versus an idle locomotor — proves the
  ascending pathway is actually connected, not just present in the graph.
- No per-frame scale/height snap at landing; body timestep is frame-rate
  independent (60Hz vs 120Hz render schedules produce identical outcomes).
- Locomotor: network is silent with zero descending/sensory input; motor
  spikes require both intact synapses and intact motor neurons; leg sensory
  feedback measurably changes real VNC spiking, not just displayed pose.

All 40 checks across the three suites passed as of this document's last
verification pass (40 PASS, 0 FAIL).

## Performance (profiled, not guessed)

On the reference hardware (4-core Celeron N5095, no discrete
GPU), a direct `process.hrtime` measurement of `LIFSim.step(8)` (roughly one
rendered frame's worth of simulated time) with a MaleCNS locomotor attached:

> Historical measurements from before the worker architecture of 2.0.0.

- Before this optimisation: ~4.1ms/call (brain ~3.0ms, locomotor ~1.1ms).
- After removing a per-millisecond string-comparison/object-property hot
  path in `locomotor.js`'s sensory loop (replaced with precomputed typed
  arrays, verified bit-identical test output before/after): ~3.3ms/call.
- Also hoisted a handful of per-neuron getter reads in `sim.js`'s own decay
  loop to loop-local consts (same principle, same bit-identical test output)
  — within this hardware's measurement noise (±0.3ms run to run), not a
  separately-claimed win on its own.

The brain's own cost (~3ms for a 6,338-neuron/703,381-edge sparse network)
is the dominant remainder and is architecturally expected for a CPU,
main-thread, synchronous LIF simulation at this scale in JavaScript — a
`node --prof` profile attributes it overwhelmingly to `LIFSim.step` itself
(no stray allocation or GC hotspot found beyond ~7% in `Math.random`).
Moving the simulation off the render thread (a Web Worker) was considered
and would very plausibly help further, but was **deliberately not
attempted** at the time: the architecture then kept sensing, neural
update, motor output and body feedback in one synchronous per-frame loop
(a project invariant: the complete closed loop runs on one clock), and
splitting that across a `postMessage` boundary changes causality/timing in
ways that are hard to fully verify without interactive testing this
environment cannot safely perform. Flagged here as the natural next step
for whoever picks this up with the ability to play-test it directly.

The centre-surround stage added to the rendered eye was measured the same way
rather than assumed cheap: `localMotionResidual` over the 64x24 field costs
0.214 ms/call, and it runs on the vision tick (~20/s), not per frame — 0.43%
of one core. A sliding-window box blur would be roughly an order of magnitude
faster, and was deliberately not written: at this share of the budget it would
buy nothing measurable and cost the straightforward, obviously-correct loop
that `test/visiontest.js` pins.

## Known, explicit limitations

- No antennal-lobe/odorant-receptor population — smell concentration is
  real, odor identity is not. Because there is also no separate nociceptor
  channel, touch, squeeze, jolt, wind and odour concentration all drive the
  one real sensory population the circuit does contain, and the dashboard bar
  for it is therefore a combined-stimulus readout, not a pain meter. It is
  labelled and tooltipped as such ("Sensorik gesamt") rather than left
  to imply a specificity the data cannot support — a fly sitting beside a
  flower reads high on it, and that is odour, not distress.
- No volume-transmission/hormone-level model for dopamine, serotonin or
  octopamine — only real per-synapse signalling rate.
- The permanently-drawn ambient synapse web is a rendering-performance
  sample of the real edge set, not a simulation sample — every real edge is
  always simulated regardless of what's drawn.
- The brain/VNC coupling is a population-rate interface between two
  different real specimens (female FlyWire brain, male MaleCNS cord) — there
  are no literal cross-specimen synapses in the source data, by construction.
- JO (wind) direction tuning, campaniform/hair-plate joint-specific tuning
  beyond what MaleCNS's `sensoryKind` field distinguishes, and muscle-force
  transduction are all modeling choices — see `data/LOCOMOTOR_PROVENANCE.md`
  for the full per-field provenance contract.
