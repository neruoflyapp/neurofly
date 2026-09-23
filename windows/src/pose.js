// pose.js — the fly's body pose as a flat array, so the body can be simulated
// in one thread and drawn in another.
//
// The simulation thread owns the real Fly (behaviour, leg mechanics, flight);
// the renderer owns an identical, passive model built by buildFlyModel(). Every
// frame the simulation packs the transform of each animated part into a
// Float32Array and the renderer unpacks it onto its copy. Nothing about the
// body is re-derived on the drawing side, so what is shown is exactly the
// state the neurons and the mechanics produced.

const STRIDE = 11;   // position xyz, quaternion xyzw, scale xyz, visible

export function poseNodes(model) {
  const nodes = [model.root, model.abdomen];
  for (const leg of model.legs) nodes.push(leg.root, leg.knee, leg.ankle);
  nodes.push(...model.foldedWings.children, model.blurWingL, model.blurWingR);
  if (model.proboscisPivot) nodes.push(model.proboscisPivot);
  return nodes;
}

export function poseLength(model) {
  return poseNodes(model).length * STRIDE + 2;
}

export function extractPose(model, out = null, nodes = poseNodes(model)) {
  const pose = out && out.length === nodes.length * STRIDE + 2 ? out : new Float32Array(nodes.length * STRIDE + 2);
  for (let k = 0; k < nodes.length; k++) {
    const o = nodes[k], b = k * STRIDE;
    pose[b] = o.position.x; pose[b + 1] = o.position.y; pose[b + 2] = o.position.z;
    pose[b + 3] = o.quaternion.x; pose[b + 4] = o.quaternion.y; pose[b + 5] = o.quaternion.z; pose[b + 6] = o.quaternion.w;
    pose[b + 7] = o.scale.x; pose[b + 8] = o.scale.y; pose[b + 9] = o.scale.z;
    pose[b + 10] = o.visible ? 1 : 0;
  }
  const end = nodes.length * STRIDE;
  pose[end] = model.blurWingL.material.opacity;
  pose[end + 1] = model.blurWingR.material.opacity;
  return pose;
}

export function applyPose(model, pose, nodes = poseNodes(model)) {
  if (!pose || pose.length !== nodes.length * STRIDE + 2) return false;
  for (let k = 0; k < nodes.length; k++) {
    const o = nodes[k], b = k * STRIDE;
    o.position.set(pose[b], pose[b + 1], pose[b + 2]);
    o.quaternion.set(pose[b + 3], pose[b + 4], pose[b + 5], pose[b + 6]);
    o.scale.set(pose[b + 7], pose[b + 8], pose[b + 9]);
    o.visible = pose[b + 10] > 0.5;
  }
  const end = nodes.length * STRIDE;
  model.blurWingL.material.opacity = pose[end];
  model.blurWingR.material.opacity = pose[end + 1];
  return true;
}
