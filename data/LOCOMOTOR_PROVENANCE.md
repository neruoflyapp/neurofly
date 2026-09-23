# MaleCNS locomotor circuit: provenance and limits

`locomotor_circuit.json` holds a bounded leg circuit taken from the public
**MaleCNS v1.0** connectome (adult male brain and nerve cord). In NeuroFly it
sits next to the female FlyWire v783 brain circuit. It is a selection, not a
complete nerve cord, and it does not make NeuroFly a whole-CNS simulation.

## Source and licence

The tables come from the [MaleCNS download page](https://male-cns.janelia.org/download/).
For every table the file stores the download URL, size in bytes and SHA-256
digest under `provenance.files`; the raw tables themselves are not in this
repository. Source and derived data are licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); credit the MaleCNS
collaboration (FlyEM at HHMI Janelia, University of Cambridge, MRC Laboratory
of Molecular Biology, Google Research). The FlyWire-derived files keep their own
CC BY-NC 4.0 licence.

## Rebuilding it

Requires Python 3 with numpy, pandas and pyarrow:

```sh
python3 etl_malecns.py /tmp/fly-male-cns --download
```

The three Feather tables are about 1.11 GB together; the graph is read in a
streaming pass so memory stays bounded. The run writes the circuit and
`locomotor_report.json`, which lists the totals of the source tables, the
counts that were kept, the input coverage of each output channel and the
descending-to-motor paths that exist in the kept graph.

## Taken from the data

- **Cell properties.** Body IDs, cell types, side, neuromere, peripheral nerve,
  receptor class, FlyWire and MANC type annotations, tracing status, soma
  position and transmitter predictions come from the published tables. Soma
  positions stay in the source's 8-nm voxel units; a missing soma stays missing.
- **Edges.** Each edge is a published directed connection between two bodies
  with at least five contacts at synapse confidence 0.5 or higher. No edge is
  added to close a path, to join the two datasets or to balance left and right.
- **Legs.** Outputs follow the body's leg order RF, LF, RM, LM, RH, LH. Motor
  neurons are assigned by their explicit `fl`/`ml`/`hl` subclass and
  `somaSide`, sensory neurons by their entry nerve (`ProLN`, `MesoLN`,
  `MetaLN`) and `rootSide`. Premotor and ascending cells get no leg. Neither
  body-ID parity nor position in the graph is used to infer anatomy.
- **Motor channels.** Only named muscle annotations define a channel: tibia
  flexor and extensor, trochanter flexor and extensor, accessory flexors, the
  named pleural promotor and remotor, and the sternal anterior and posterior
  rotators. Motor types without a named muscle, and other muscle groups, get no
  channel. In this selection the named promotors occur on the front legs only,
  the sternal rotators on all six. Following the anatomical supplement of
  [Azevedo et al. 2024](https://faculty.washington.edu/tuthill/docs/azevedo24_appendix.pdf),
  the rotators move the coxa forward and back and the trochanter muscles raise
  and lower the leg. The channels stay separate in the data; driving several
  of them through one mechanical axis is a simplification of the body model.
- **Sensory channels.** Sensory kinds are the published annotations
  chordotonal organ, campaniform sensilla, hair plate and generic
  proprioceptive `leg`, from the three unambiguous leg nerves only. This is a
  part of leg proprioception, not all of it.

## Modelled, not measured

- **Signs and weights.** The data give contact counts, not physiological
  weights. Acetylcholine is treated as excitatory, GABA and glutamate as
  inhibitory; these are assumptions about receptor effects. Edges with unknown
  or modulatory transmitters are kept but carry no direct current.
  `rawSynapseCounts`, aligned with `edges`, keeps every original count, and the
  original per-cell and per-type transmitter predictions with their confidence
  remain in the file for other models.
- **Sensory tuning.** The annotations do not say which joint a proprioceptor
  senses, in which direction, or whether it codes angle or velocity, so
  `sensoryJoint` and `sensoryDirection` are null. How body angle, angular
  velocity, contact or load drive these cells is a stated model choice. A
  muscle label likewise gives no force, moment arm or activation kinetics.
- **Premotor.** `premotor` is a working role for the selected nerve-cord
  interneurons, connecting interneurons included; it does not claim a direct
  contact onto a motor neuron. The selection keeps the strongest input partners
  of each output channel and the real routes from the identified male DNa01,
  DNa02, DNp09, MDN and DNg11 cells, and real ascending routes back to them.
  Activity passes from the female FlyWire brain to these male cells through a
  modelled same-type, same-side rate interface; that link is not a synapse in
  either dataset.
- **Omitted input.** Many incoming connections are left out. The report gives
  kept and full incoming contact totals for every motor channel, so movement in
  the model cannot be read as a replay of the animal's motor physiology.
  Parameters, excitability, body mechanics and the missing inputs are modelled
  and would need behavioural calibration; a passing path check validates the
  extraction, not the movement.

The raw-table totals in the report include unannotated segments and fragments.
They are not comparable with the neuron-to-neuron summary counts published for
the dataset.

## Stepping rules and `rhythm_decoder.json`

The selection contains no interneurons that generate a stepping rhythm, and
driving DNp09 alone makes the legs twitch rather than step. NeuroFly therefore
adds modeled, leg-local stepping rules (`windows/src/rhythm.js`, after Walknet:
Cruse 1990; Dürr, Schmitz & Cruse 2004; and the rule-based controller of
NeuroMechFly v2, Wang-Chen et al. 2024). They read the modeled body's joint
angles, velocities and foot contacts and produce joint-axis demands (hip,
elevation and knee of each leg). Nothing in them is measured.

The demands reach the cord as drive onto premotor cells listed in
`rhythm_decoder.json`. That file is **derived from the NeuroFly cord model, not
from the connectome's annotations**: `windows/tools/derive-rhythm-decoder.mjs`
drives each of the 622 premotor cells alone (excited, then inhibited) in an
active model cord, measures the change of all 18 joint axes, fits a sparse
non-negative combination per axis and direction, and records how each fitted
combination actually performs in the nonlinear model (`check`). The cells it
selects are the ones whose activation, through the measured synapses, moves a
joint in the model; they are not claimed to be the cells a real rhythm
generator contacts. The file is locked to this `locomotor_circuit.json` by
SHA-256 and to the cord-model parameters it was derived with; a mismatch
switches the stepping rules off instead of applying a wrong decoder.

Because the rules act only on premotor cells, the measured synapses remain the
only route to the motor neurons: with synapses disabled or motor neurons
silenced the legs do not move (`test/locomotortest.js`). Several joints are
poorly controllable through the retained wiring (the left hind leg's
trochanter motor neurons have few retained inputs; the right hind leg lifts
poorly while the cord is active), which leaves a residual turning bias.
