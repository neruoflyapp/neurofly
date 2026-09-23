// Five self-contained visual studies from the actual BANC specimen renderer.
// Light is an artistic/model overlay; no empirical spike recording is implied.
import { BrainView } from './view/brain.js';

const plans=[
  {groups:['other-central_brain_intrinsic','other-ventral_nerve_cord_intrinsic'],yaw:-.7,turn:5.7,z0:39,z1:28,y0:0,y1:0,x:-.12},
  {groups:['other-descending','other-ascending'],yaw:.45,turn:3.7,z0:37,z1:21,y0:2,y1:-3,x:-.16},
  {groups:['other-sensory','other-motor'],yaw:1.3,turn:3.5,z0:29,z1:26,y0:-1,y1:1,x:.12},
  {groups:['other-central_brain_intrinsic','other-ascending'],yaw:2.1,turn:4.2,z0:32,z1:19,y0:1,y1:3,x:-.22},
  {groups:['other-ventral_nerve_cord_intrinsic','other-motor'],yaw:-1.1,turn:6.1,z0:24,z1:43,y0:-3,y1:0,x:.06},
];
const el=id=>document.getElementById(id);
const clamp=x=>Math.max(0,Math.min(1,x));
let view,active=-1;
window.promo={
  init(data){
    view=new BrainView(el('brain'),{points:data.points,circuit:data.circuit,onPick:()=>{}});
    view.hovering=true;
    view.renderer.setPixelRatio(1);
    view.synapseLines.material.opacity=.095;
    view.highlightCloud.material.size=.32;
    view.resize();
    return {points:data.points.points.length,neurons:data.circuit.neurons.length,edges:data.circuit.edges.length};
  },
  renderAt(index,t){
    if(!view) throw new Error('motion stage not initialized');
    const p=plans[index];if(!p) throw new Error('bad reel index');
    if(active!==index){
      active=index;view.setHighlight(null);view.last=null;view.pending=0;view.idle=0;
      view.activeGlow.clear();view.edgeGlow.fill(0);
      for(const node of view.flashPool) node.visible=false;
      for(const g of view.groups) g.object.material.opacity=g.tier==='bg'?.30:p.groups.includes(g.key)?.94:.24;
    }
    // Continuous but differentiated motion: orbit, traveling detail shot, chase,
    // macro inspection, then an outward reveal. The rhythmic push is small enough
    // to avoid the apparent geometric distortion of zooming the connectome itself.
    const u=clamp(t/8.5),beat=Math.exp(-(((t%0.5)/.13)**2));
    const ease=u*u*(3-2*u);
    view.group.rotation.y=p.yaw+p.turn*u+.055*Math.sin(t*5+index);
    view.group.rotation.x=p.x+.11*Math.sin(t*1.15+index*.8);
    view.group.rotation.z=.035*Math.sin(t*1.7+index);
    view.group.position.y=p.y0+(p.y1-p.y0)*ease;
    view.zoom=p.z0+(p.z1-p.z0)*ease-.50*beat;
    view.camera.position.z=view.zoom;
    view.camera.position.y=0;
    const frame=Math.round(t*24);
    if(frame%4===0){
      view.flashBudget=32;
      for(let k=0;k<p.groups.length;k++){
        const g=view.groups.find(x=>x.key===p.groups[k]),ids=g?.indices||[];
        for(let j=0;j<3&&ids.length;j++) view.addSpikes([ids[(frame*29+j*109+k*397+index*71)%ids.length]]);
      }
    }
    view.frame(t*1000+1000);
    el('glow').style.opacity=String(.31+.35*beat);
    el('glow').style.transform=`translateY(${Math.sin(t*1.5+index)*9}%)`;
    el('sweep').style.top=`${15+70*((t*.46+index*.17)%1)}%`;
    el('sweep').style.opacity=String(.16+.28*beat);
    el('stage').style.opacity=String(clamp((8.5-t)/.28));
    return frame;
  }
};
