<h1 align="center">NeuroFly 🪰</h1>

<p align="center">
An in-silico fruit fly for Windows: a closed-loop model built on the measured
wiring of her nervous system — <a href="https://codex.flywire.ai">FlyWire</a>
brain, <a href="https://male-cns.janelia.org/">MaleCNS</a> nerve cord — with
modelled senses, body and behaviour, and every action traceable to the
neurons that caused it.
</p>

<p align="center"><a href="https://neurofly.app">neurofly.app</a></p>

---

## What this is

The fly's behaviour is not animated. It falls out of a leaky integrate-and-fire
**model** running over measured connectome data:

| | |
|---|---|
| Brain | 7,270 FlyWire FAFB v783 neurons, 784,219 signed synapse-count connections: a 6,338-neuron escape/steering subgraph, 16 thermosensors with 52 relays, and the taste (sugar/water, bitter → proboscis) and antennal-grooming (JO-F → DNg12) pathways |
| Nerve cord | 1,045 MaleCNS v1.0 neurons for walking, with leg-specific motor and sensory channels and feedback |
| Timestep | 1 ms neural integration; the full sensing → neurons → body → feedback loop at 120 Hz, in a Web Worker |
| Anatomy explorer | female BANC v888 and male MaleCNS v1.0 (brain + nerve cord each) and FAFB v783, browsable separately |

A looming object drives the real LC4/LPLC2 populations, which drive the real
giant fiber DNp01, which triggers takeoff. Wind reaches only the
wind/gravity Johnston's-organ neurons; near-field sound only the auditory
ones; temperature only the real hot and cold cells; sugar and bitter only the
gustatory receptor neurons; dust on the antennae only JO-F. What happens after
a stimulus arrives is decided by measured wiring, not by a script.

## What you can do with it

- **Watch and ask why.** Every takeoff, grooming bout, backward walk or
  proboscis extension comes with its causal chain: the trigger, the sensory
  neurons it reached, the synaptic input to the neurons that decided, and the
  rule that turned it into movement.
- **Virtual genetics and pharmacology.** Silence or activate any identified
  population or FlyWire cell type; scale transmitter classes.
- **Guided experiments.** Ten protocols from the fly literature — looming
  threshold, LC4/LPLC2 silencing, sound vs wind, taste trade-off, dust
  grooming, activation screen, inhibition, habituation, associative learning,
  thermal preference — run on a separate virtual fly with statistics, and are
  reproducible from their seed.
- **Record everything.** 20 Hz CSV of every population rate, input and body
  state; run manifests with seeds, interventions and data fingerprints.

## What this is not

Wiring and synapse counts are measured. Cell dynamics, sensory transduction,
body mechanics and behaviour are models. No output of this program is evidence
of subjective experience, pain, emotion or thought, and it deliberately shows
no "sentience score". The app reports its scope against the eight criteria of
Birch et al. (2021) and says which of them the model does not contain at all.

`windows/VALIDATION.md` is the full audit: benchmark results including the
findings the model does **not** reproduce, the verification suite, and a
corrections log of claims this project measured and then had to withdraw.

## Download

The portable build for Windows 10 and 11 (64-bit) is on the
[releases page](https://github.com/neuroflyapp/neurofly/releases/latest): unzip
it anywhere and start `NeuroFly.exe`; nothing is installed. The build is not
code-signed yet, so Windows may warn on first start (More info → Run anyway).
By downloading you accept the [software terms](https://neurofly.app/software-terms.html).

## Run it from source

```sh
cd windows
npm install
npm start          # the app
npm test           # all 28 suites
npm run uitest     # end-to-end test of the running application
```

Requires Node.js 20+ on Windows 10/11. `windows/tools/build-portable.ps1` builds
the portable release from the committed files.

## Regenerating the neural data

The extracted bundles in `data/` are committed. To rebuild them from the raw
public dumps (which stay outside the repository):

```sh
python3 etl.py <raw_flywire_dir>          # brain circuit + point cloud
node etl_cell_annotations.mjs             # real FlyWire cell types
node etl_thermo_extension.mjs             # hot/cold thermosensors + relays
node etl_sensory_extension.mjs            # taste and antennal-grooming pathways
node etl_pathways.mjs                     # full-connectome pathway audit (sentience map)
python3 etl_malecns.py /tmp/male-cns --download   # walking circuit
```

The anatomy-explorer bundles in `windows/assets/connectomes/` are built by
`windows/tools/acquire-connectomes.mjs` and `windows/tools/import-specimens.py`.

## Licenses

Program code: [PolyForm Noncommercial License 1.0.0](LICENSE). Research,
teaching, personal study and use by non-profit and public institutions are
permitted; commercial use needs a licence from NeuroFly
(contact@neurofly.app). Third-party components are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The bundled neural data is licensed separately and requires attribution:
FlyWire FAFB v783 under **CC BY-NC 4.0** (non-commercial), MaleCNS v1.0 and
BANC v888 under **CC BY 4.0**. See [`data/DATA_LICENSE.md`](data/DATA_LICENSE.md),
[`data/LOCOMOTOR_PROVENANCE.md`](data/LOCOMOTOR_PROVENANCE.md) and
[`windows/assets/connectomes/README.md`](windows/assets/connectomes/README.md).
Because of the non-commercial data license, NeuroFly is free and stays free.
