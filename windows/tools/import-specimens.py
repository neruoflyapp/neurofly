"""Build bounded, same-specimen anatomical explorers, not surrogate live animals.

python tools/import-specimens.py [banc-v888|malecns-v1|fafb-v783|all]
Requires pyarrow in datasets/tooling (or the Python environment). No pandas.
Source identities are retained as decimal strings; no cross-animal edges.
"""
import csv
import gzip
import hashlib
import importlib.abc
import json
import math
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
LOCAL_RAW = PROJECT / "datasets"
RAW = Path(os.environ.get("NEUROFLY_DATA_ROOT", LOCAL_RAW))
OUT = PROJECT / "windows/assets/connectomes"
sys.path.insert(0, str(LOCAL_RAW / "tooling"))
# Arrow's optional pandas shim is unnecessary for these columnar operations.
# The bundled interpreter may contain an unrelated pandas ABI; do not use it.
class NoPandas(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "pandas" or fullname.startswith("pandas."):
            raise ImportError("This importer uses Arrow directly, without pandas")
        return None
sys.meta_path.insert(0, NoPandas())
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather
import pyarrow.ipc as ipc

LIMIT = 6000
CORE = {"LC4", "LPLC2", "DNp01", "DNa01", "DNa02", "DNp09", "MDN", "DNg11", "DNg12", "DNp02", "DNp04", "DNp11"}
PROFILE = {
    "banc-v888": dict(id="banc-v888", name="BANC v888", specimen="BANC", sex="female"),
    "malecns-v1": dict(id="malecns-v1", name="MaleCNS v1.0", specimen="MaleCNS", sex="male"),
    "fafb-v783": dict(id="fafb-v783", name="FlyWire FAFB v783", specimen="FAFB", sex="female"),
}


def clean(v):
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (tuple, list)):
        return [clean(x) for x in v]
    return v


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(clean(value), separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    temporary = file.with_suffix(file.suffix + ".partial")
    temporary.write_bytes(raw)
    temporary.replace(file)
    return hashlib.sha256(raw).hexdigest()


def table_rows(file, columns=None):
    return feather.read_table(file, columns=columns).to_pylist()


def csv_rows(file):
    opener = gzip.open if file.suffix == ".gz" else open
    with opener(file, "rt", encoding="utf-8-sig", newline="") as stream:
        yield from csv.DictReader(stream)


def position(value, factor=1):
    if isinstance(value, str):
        value = re.findall(r"-?\d+(?:\.\d+)?", value)
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    p = [float(x) * factor for x in value]
    return p if all(math.isfinite(x) for x in p) else None


def annotations(profile):
    folder = RAW / profile
    result = {}
    if profile == "banc-v888":
        cols = ["banc_888_id", "root_position_nm", "cell_type", "fafb_cell_type", "super_class", "flow", "side", "nerve", "neuromere", "body_part_effector", "peripheral_target_type", "cell_function", "neurotransmitter_predicted", "neurotransmitter_verified", "neurotransmitter_score", "proofread", "status", "sexually_dimorphic"]
        for row in table_rows(folder / "banc_888_meta.feather", cols):
            rid = row["banc_888_id"]  # root_id is an older materialization, NOT v888!
            pos = position(row["root_position_nm"])
            if not rid:
                continue
            if rid in result:
                raise ValueError(f"Duplicate v888 identity {rid}; resolve annotations before import")
            result[rid] = dict(id=rid, type=row["cell_type"] or "untyped", aliases=row["fafb_cell_type"] or "",
                superClass=row["super_class"] or "unclassified", side=row["side"] or "unknown", pos=pos,
                nt=row["neurotransmitter_verified"] or row["neurotransmitter_predicted"] or "unknown",
                ntEvidence="verified" if row["neurotransmitter_verified"] else "predicted",
                ntConfidence=row["neurotransmitter_score"], annotations=row)
    elif profile == "malecns-v1":
        annotated = table_rows(folder / "body-annotations-male-cns-v1.0-minconf-0.5.feather")
        nt_table = feather.read_table(folder / "body-neurotransmitters-male-cns-v1.0.feather", columns=["body", "consensus_nt", "ground_truth", "predicted_nt_confidence"])
        nt_table = nt_table.filter(pc.is_in(nt_table["body"], value_set=pa.array([r["bodyId"] for r in annotated], type=pa.int64())))
        nt = {str(r["body"]): r for r in nt_table.to_pylist()}
        for row in annotated:
            rid = str(row["bodyId"])
            pos = position(row["somaLocation"], 8) or position(row["tosomaLocation"], 8)
            if rid in result:
                raise ValueError("Duplicate MaleCNS body ID")
            tr = nt.get(rid, {})
            result[rid] = dict(id=rid, type=row["type"] or "untyped", aliases=row["flywireType"] or "",
                superClass=row["superclass"] or "unclassified", side={"L":"left", "R":"right", "M":"center"}.get(row["somaSide"] or row["rootSide"], "unknown"), pos=pos,
                nt=tr.get("consensus_nt") or "unknown", ntEvidence="verified" if tr.get("ground_truth") in {"acetylcholine", "gaba", "glutamate", "dopamine", "serotonin", "octopamine"} else "consensus",
                ntConfidence=tr.get("predicted_nt_confidence"), annotations={k: row.get(k) for k in ["instance", "class", "subclass", "status", "statusLabel", "entryNerve", "exitNerve", "somaNeuromere", "dimorphism", "matchingNotes", "flywireType", "mancType"]})
    else:
        types = {r["root_id"]: r for r in csv_rows(folder / "consolidated_cell_types.csv.gz")}
        coords = {}
        for r in csv_rows(folder / "coordinates.csv.gz"):
            coords.setdefault(r["root_id"], position(r["position"]))
        nt = {r["root_id"]: r for r in csv_rows(folder / "neurons.csv.gz")}
        stats = {r["root_id"]: r for r in csv_rows(folder / "cell_stats.csv.gz")}
        visual = {r["root_id"]: r for r in csv_rows(folder / "visual_neuron_types.csv.gz")}
        for r in csv_rows(folder / "classification.csv.gz"):
            rid = r["root_id"]
            if not coords.get(rid):
                continue
            tr = nt.get(rid, {})
            result[rid] = dict(id=rid, type=types.get(rid, {}).get("primary_type") or "untyped", aliases="",
                superClass=r["super_class"], side=r["side"] or "unknown", pos=coords[rid],
                nt={"ACH":"acetylcholine", "GABA":"gaba", "GLUT":"glutamate", "DA":"dopamine", "SER":"serotonin", "OCT":"octopamine"}.get(tr.get("nt_type"), "unknown"),
                ntConfidence=float(tr["nt_type_score"]) if tr.get("nt_type_score") else None, ntEvidence="predicted",
                annotations={**r, "morphometrics": stats.get(rid), "visualType": visual.get(rid)})
    print(profile, "annotated records", len(result), "with position", sum(bool(n["pos"]) for n in result.values()), flush=True)
    return result


def edge_batches(profile, endpoints=None):
    """Filter in Arrow before Python conversion; keep 64-bit IDs exact."""
    if profile == "fafb-v783":
        rows = []
        file = RAW / profile / "connections_princeton_no_threshold (1).csv.gz"
        for r in csv_rows(file):
            pre, post = r["pre_root_id"], r["post_root_id"]
            if endpoints is None or pre in endpoints or post in endpoints:
                rows.append((pre, post, int(r["syn_count"])))
            if len(rows) >= 50000:
                yield rows
                rows = []
        if rows:
            yield rows
        return
    if profile == "banc-v888":
        file = RAW / profile / "banc_888_edgelist_simple_v3.feather"
        keys = ("pre", "post", "count")
        ids = pa.array(sorted(endpoints), type=pa.string()) if endpoints else None
    else:
        file = RAW / profile / "connectome-weights-male-cns-v1.0-minconf-0.5.feather"
        keys = ("body_pre", "body_post", "weight")
        ids = pa.array(sorted(int(x) for x in endpoints), type=pa.int64()) if endpoints else None
    with pa.memory_map(str(file), "r") as source:
        reader = ipc.open_file(source)
        for i in range(reader.num_record_batches):
            batch = reader.get_batch(i)
            if ids is not None:
                mask = pc.or_(pc.is_in(batch[keys[0]], value_set=ids), pc.is_in(batch[keys[1]], value_set=ids))
                batch = batch.filter(mask)
            yield zip(*(batch[k].to_pylist() for k in keys))


def extract(profile):
    ann = annotations(profile)
    seeds = {rid for rid, n in ann.items() if n["type"] in CORE or n["aliases"] in CORE or "motor" in n["superClass"] or n["superClass"] in ("descending", "descending_neuron")}
    if not seeds or len(seeds) > LIMIT:
        raise ValueError(f"Unexpected seed count {len(seeds)}; review schema")
    strength = Counter()
    for batch in edge_batches(profile, seeds):
        for pre, post, count in batch:
            pre, post = str(pre), str(post)
            if pre in seeds and post in ann and post not in seeds:
                strength[post] += count
            if post in seeds and pre in ann and pre not in seeds:
                strength[pre] += count
    ranked = sorted(strength, key=lambda x: (-strength[x], int(x)))
    chosen = set(seeds)
    # Native sensory and cord intermediates must not disappear behind the
    # larger brain's partner scores. These are sampling quotas, not physiology.
    for category, limit in [("sensory", 350), ("vnc", 1000), ("ascending", 200)]:
        added = 0
        for rid in ranked:
            category_match = category in ann[rid]["superClass"] or (category == "vnc" and ann[rid]["superClass"] == "ventral_nerve_cord_intrinsic")
            if category_match and rid not in chosen and len(chosen) < LIMIT:
                chosen.add(rid)
                added += 1
                if added >= limit:
                    break
    for rid in ranked:
        if len(chosen) >= LIMIT:
            break
        chosen.add(rid)
    ids = sorted(chosen, key=int)
    index = {rid: i for i, rid in enumerate(ids)}
    full_in, full_out, retained = Counter(), Counter(), Counter()
    print(profile, "selected", len(ids), "including", len(seeds), "native seeds", flush=True)
    for batch in edge_batches(profile, chosen):
        for pre, post, count in batch:
            pre, post, count = str(pre), str(post), int(count)
            if count <= 0:
                raise ValueError("Nonpositive source contact count")
            if pre in chosen:
                full_out[pre] += count
            if post in chosen:
                full_in[post] += count
            if pre in chosen and post in chosen:
                retained[(index[pre], index[post])] += count
    edges = [[pre, post, n] for (pre, post), n in sorted(retained.items()) if n >= 5]
    if not edges:
        raise ValueError("No native edges matched IDs; do not mix materializations")
    located = [n for n in ann.values() if n["pos"] is not None]
    centres = [(min(n["pos"][i] for n in located) + max(n["pos"][i] for n in located)) / 2 for i in range(3)]
    scale = 20 / max(max(n["pos"][i] for n in located) - min(n["pos"][i] for n in located) for i in range(3))
    neurons = []
    for rid in ids:
        n = ann[rid]
        neurons.append({**n, "specimen": PROFILE[profile]["specimen"], "posNm": n["pos"],
            "positionKnown": n["pos"] is not None,
            "pos": [round((n["pos"][i] - centres[i]) * scale * (1 if i == 0 else -1), 5) for i in range(3)] if n["pos"] else None,
            "seed": rid in seeds, "fullInputContacts": full_in[rid], "fullOutputContacts": full_out[rid]})
    sources = []
    for inventory_file in [RAW / "inventory-online.json", RAW / "inventory-local.json"]:
        if inventory_file.exists():
            for entry in json.loads(inventory_file.read_text("utf-8"))["files"]:
                if entry["dataset"] == profile and entry["status"] == "verified":
                    sources.append({k: entry[k] for k in ["name", "sha256", "bytes", "source", "license"]})
    summary = dict(annotatedRecords=len(ann), annotatedRecordsWithPosition=len(located), unlocatedSelected=sum(n["pos"] is None for n in neurons), selectedNeurons=len(neurons), selectedConnections=len(edges),
        selectedContacts=sum(e[2] for e in edges), seedNeurons=len(seeds), classes=dict(Counter(n["superClass"] for n in neurons)),
        unknownTransmitters=sum(n["nt"] == "unknown" for n in neurons), edgeThreshold=5)
    bundle = dict(schema=1, profile=PROFILE[profile], neurons=neurons, edges=edges, summary=summary, sources=sources,
        coordinateSpace=f"{PROFILE[profile]['specimen']} native EM, nanometres",
        positionMeaning="published representative/root points; not uniformly somata" if profile != "malecns-v1" else "published soma/tosoma points, 8-nm voxels converted to nm",
        selection="Native motor and descending cells plus named LC4/LPLC2/command cells; strongest contacting partners, sensory/VNC/ascending quotas; maximum 6000 cells; induced connections >=5 contacts. Not a whole-CNS simulation.",
        runtimeReady=False, excludedFromRuntime="Native body/sensory mapping and physiological validation pending. Anatomy browser only; existing terrarium is unchanged.")
    digest = write_json(OUT / f"{profile}.json", bundle)
    print(profile, "DONE", summary, flush=True)
    return dict(id=profile, **summary, sha256=digest, runtimeReady=False)


def morphology():
    archive = RAW / "fafb-v783/sk_lod1_783_healed.zip"
    if not archive.exists():
        return None
    circuit = json.loads((PROJECT / "data/circuit.json").read_text("utf-8"))
    wanted = {n["id"] for n in circuit["neurons"] if n["type"] in CORE - {"LC4", "LPLC2"}}
    result = {}
    with zipfile.ZipFile(archive) as z:
        entries = {f.filename: f for f in z.infolist()}
        for rid in sorted(wanted):
            name = f"{rid}.swc"
            if name not in entries or entries[name].file_size > 30 * 1024 ** 2:
                continue
            raw = z.read(name)  # verifies CRC for every imported skeleton
            nodes = {}
            for line in raw.decode("utf-8").splitlines():
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                p = line.split()
                if len(p) != 7:
                    raise ValueError(f"Invalid SWC: {name}")
                if int(p[0]) in nodes:
                    raise ValueError(f"Duplicate SWC node: {name}")
                nodes[int(p[0])] = (float(p[2]), float(p[3]), float(p[4]), int(p[6]))
            segments, length, branches = [], 0, Counter()
            for node in nodes.values():
                parent = nodes.get(node[3])
                if node[3] >= 0 and parent is None:
                    raise ValueError(f"Missing SWC parent: {name}")
                if parent:
                    segment = list(node[:3]) + list(parent[:3])
                    if not all(math.isfinite(v) for v in segment):
                        raise ValueError("Nonfinite morphology coordinate")
                    length += math.dist(node[:3], parent[:3])
                    branches[node[3]] += 1
                    if len(segments) < 30000:
                        segments.append(segment)
            neuron = dict(id=rid, specimen="FAFB", units="nm", segments=segments, points=len(nodes),
                cableLengthNm=length, branchPoints=sum(v > 1 for v in branches.values()),
                displayedSegments=len(segments), totalSegments=sum(branches.values()),
                truncated=sum(branches.values()) > len(segments), sha256=hashlib.sha256(raw).hexdigest())
            result[rid] = dict(sha256=write_json(OUT / "morphology" / f"{rid}.json", neuron))
        summary = dict(archiveEntries=len(entries), archiveUncompressedBytes=sum(e.file_size for e in entries.values()),
            importedSkeletons=len(result), verification="ZIP directory read; imported entries CRC-checked; rest of archive not decompressed")
    digest = write_json(OUT / "fafb-morphology.json", dict(schema=2, specimen="FAFB", neurons=result, summary=summary))
    return {**summary, "sha256": digest}


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode not in [*PROFILE, "all", "morphology", "catalog"]:
        raise SystemExit("Unknown dataset")
    catalog_file = OUT / "catalog.json"
    catalog = json.loads(catalog_file.read_text("utf-8")) if catalog_file.exists() else dict(schema=1, profiles=[])
    for profile in PROFILE if mode == "all" else ([mode] if mode in PROFILE else []):
        entry = extract(profile)
        catalog["profiles"] = [p for p in catalog["profiles"] if p["id"] != profile] + [entry]
        write_json(catalog_file, catalog)
    if mode in ("all", "morphology"):
        catalog["morphology"] = morphology()
    # Reconstruct the catalog from complete bundles, also making separately
    # run imports composable. Never infer runtime readiness from file presence.
    catalog["profiles"] = []
    for profile in PROFILE:
        file = OUT / f"{profile}.json"
        if file.exists():
            raw = file.read_bytes()
            data = json.loads(raw)
            if data["profile"]["id"] != profile:
                raise ValueError("Catalog rebuild found an incorrectly named specimen")
            catalog["profiles"].append(dict(id=profile, **data["summary"], sha256=hashlib.sha256(raw).hexdigest(), runtimeReady=False))
    morphology_file = OUT / "fafb-morphology.json"
    if morphology_file.exists():
        raw = morphology_file.read_bytes()
        m = json.loads(raw)
        catalog["morphology"] = {**m["summary"], "sha256": hashlib.sha256(raw).hexdigest()}
    catalog["files"] = []
    for file in [RAW / "inventory-online.json", RAW / "inventory-local.json"]:
        if file.exists():
            for entry in json.loads(file.read_text("utf-8"))["files"]:
                catalog["files"].append({k: entry.get(k) for k in ["dataset", "name", "bytes", "sha256", "status", "error", "license", "source"]})
    catalog["checkedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(catalog_file, catalog)
