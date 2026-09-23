# Licences of the neural data

The files in this folder are derived from published connectome datasets. They
keep the licence of their source and require attribution. The NeuroFly program
licence does not apply to them.

| Files | Source | Licence |
|---|---|---|
| `brain_points.json`, `circuit.json`, `circuit_annotations.json`, `thermo_extension.json`, `sensory_extension.json`, `sentience_pathways.json` | FlyWire FAFB v783, adult female brain ([FlyWire Codex](https://codex.flywire.ai)) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): non-commercial use only |
| `locomotor_circuit.json`, `locomotor_report.json` | MaleCNS v1.0, adult male brain and nerve cord ([download page](https://male-cns.janelia.org/download/)) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `rhythm_decoder.json` | derived from NeuroFly's model of the MaleCNS cord (see `LOCOMOTOR_PROVENANCE.md`) | CC BY 4.0, as its source |

The anatomy bundles in `windows/assets/connectomes/` (FAFB v783, MaleCNS v1.0,
BANC v888) are described, with their licences, in that folder's `README.md`.

NeuroFly selects subgraphs, adds cell-type annotations and derives signed
synapse-count weights; these are changes to the source data in the sense of the
Creative Commons licences. Each derived file records its sources and SHA-256
fingerprints. The scripts that build them are `etl.py`, `etl_cell_annotations.mjs`,
`etl_thermo_extension.mjs`, `etl_sensory_extension.mjs`, `etl_pathways.mjs` and
`etl_malecns.py`.

## Attribution

**FlyWire FAFB v783.** FlyWire is a project of Princeton University and
collaborators; see <https://flywire.ai> for its terms and community guidelines.

- Dorkenwald S, et al. Neuronal wiring diagram of an adult brain. *Nature* 634,
  124–138 (2024). <https://doi.org/10.1038/s41586-024-07558-y>
- Schlegel P, et al. Whole-brain annotation and multi-connectome cell typing of
  *Drosophila*. *Nature* 634, 139–152 (2024).
  <https://doi.org/10.1038/s41586-024-07686-5>

**MaleCNS v1.0.** FlyEM at HHMI Janelia, with the University of Cambridge, the
MRC Laboratory of Molecular Biology and Google Research. Berg S, et al.,
bioRxiv (2025). <https://doi.org/10.1101/2025.10.09.680999>

**BANC v888.** Bates AS, Phelps JS, Kim M, et al. *Nature* 656, 957–970 (2026).
<https://doi.org/10.1038/s41586-026-10735-w>; data
<https://doi.org/10.7910/DVN/7WTH1N>.
