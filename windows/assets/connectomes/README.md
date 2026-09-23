# NeuroFly specimen anatomy bundles

These generated files are **read-only anatomical subgraphs**, not certified live
animal models. Selecting a specimen does not replace the terrarium simulation.

- `banc-v888.json`: female BANC, materialization 888. Source graph v3 and metadata
  from [Bates et al., final data release](https://doi.org/10.7910/DVN/7WTH1N),
  CC BY 4.0. Crucially, joins use `banc_888_id`, not the older `root_id` column.
- `malecns-v1.json`: male MaleCNS v1.0, annotation/NT/connection tables from
  [FlyEM, Janelia and collaborators](https://male-cns.janelia.org/download/),
  CC BY 4.0. Native 8-nm coordinates are converted to nanometres.
- `fafb-v783.json`: female FAFB/FlyWire v783, local Codex downloads, CC BY-NC 4.0.
  [FlyWire Codex](https://codex.flywire.ai/api/download) and Dorkenwald et al.
  2024, DOI: 10.1038/s41586-024-07558-y. Princeton detections are used for this
  graph; Buhmann detections are archived separately, never added to Princeton.
- `fafb-morphology.json`: small hash-bound index of selected command-cell skeletons from
  `sk_lod1_783_healed.zip`, FAFB only, CC BY-NC 4.0. SWC units are nanometres.
  Imported entries are CRC-checked. Length is geometric LOD1 skeleton length,
  not a measured conduction delay or complete membrane geometry.
- `morphology/`: lazy-loaded individual FAFB cell files, no complete 30-MB
  morphology blob retained in memory.
- `malecns-morphology.json` and `malecns-morphology/`: 24 native MaleCNS
  command-cell skeletons. Publisher MD5, source SHA-256 and GCS generation
  recorded per cell. Original 8-nm units explicitly converted to nm. No
  female skeleton reused for a male neuron.
- `catalog.json`: generated counts and SHA-256 identities of the bundles and
  imported source files. Missing positions remain explicit, not invented.

Connection rows contain **unsigned integer contacts**. Transmitter predictions
are displayed separately: transmitter identity does not uniquely establish
postsynaptic receptor effects, synaptic efficacy or cellular dynamics.

Source archives and publisher metadata are kept in a local `datasets/` folder
next to the repository, outside Git; the 13.9-GB skeleton ZIP never belongs in
a commit.
Regeneration: `tools/acquire-connectomes.mjs` and `tools/import-specimens.py`.
Keep this notice and the source/license records with redistributed bundles.

`public-source-summary.json` records which public sources were found, not what
was downloaded.
