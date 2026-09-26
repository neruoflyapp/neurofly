// Dedicated capture stage, reusing the program's actual BrainView geometry.
// Pulses are a visual treatment of a model; no real firing was measured.
import { BrainView } from './view/brain.js';

const beats = [0, 1.2, 2.7, 4.1, 5.9, 7.2];
const fafbSpecs = [
  { chapter:'THE MAP', eyebrow:'NOT SCIENCE FICTION', headline:'A brain you can <em>enter.</em>', detail:'Real fruit-fly neuron positions. One explorable network.', groups:['loom','gf'], rotation:[-0.6,5.65], zoom:[46,38] },
  { chapter:'THE SIGNAL', eyebrow:'ONE INPUT. A CIRCUIT.', headline:'Watch the signal <em>travel.</em>', detail:'Modelled pulses illuminate connectome-derived connections.', groups:['loom','gf'], rotation:[-0.4,1.35], zoom:[37,27] },
  { chapter:'THE ESCAPE', eyebrow:'THE MOMENT BEFORE MOVEMENT', headline:'Inside an <em>escape circuit.</em>', detail:'Threat detectors, giant fiber, descending pathways.', groups:['gf','escw'], rotation:[1.6,3.3], zoom:[36,27] },
  { chapter:'THE DETAIL', eyebrow:'ZOOM INTO THE WIRING', headline:'Thousands of links. <em>One question.</em>', detail:'A selected view of connections between mapped cells.', groups:['dna','fwd'], rotation:[3.1,4.55], zoom:[27,20] },
  { chapter:'THE FUTURE', eyebrow:'EXPLORE THE UNANSWERED', headline:'What can a map <em>become?</em>', detail:'NeuroFly — explore, test, and question the model.', groups:['sugar','bitter','proboscis'], rotation:[-1.1,1.1], zoom:[48,34] },
];
const bancSpecs = [
  { chapter:'ONE ANIMAL', eyebrow:'BRAIN AND NERVE CORD', headline:'One fly. <em>One network.</em>', detail:'A selected view of one female brain-and-cord connectome.', groups:['other-central_brain_intrinsic','other-ventral_nerve_cord_intrinsic'], rotation:[-.45,3.5], zoom:[38,29] },
  { chapter:'THE WIRING', eyebrow:'SENSORY & DESCENDING CELLS', headline:'See the links <em>light up.</em>', detail:'Visualized pulses on measured structural connections.', groups:['other-sensory','other-descending'], rotation:[.5,3.15], zoom:[34,25] },
  { chapter:'THE ROUTE', eyebrow:'DESCENDING CONNECTIONS', headline:'From brain to <em>body.</em>', detail:'Explore mapped descending cells and motor pathways.', groups:['other-descending','other-motor'], rotation:[-1.15,1.65], zoom:[34,24] },
  { chapter:'THE DETAIL', eyebrow:'ZOOM INTO THE NETWORK', headline:'Every contact <em>counts.</em>', detail:'A selected view of mapped cells and contact links.', groups:['other-central_brain_intrinsic','other-ascending'], rotation:[2.2,4.1], zoom:[30,21] },
  { chapter:'THE QUESTION', eyebrow:'WHAT COMES AFTER THE MAP?', headline:'Could wiring become <em>life?</em>', detail:'NeuroFly — explore the evidence, test the model.', groups:['other-sensory','other-motor'], rotation:[-1.2,2.2], zoom:[40,29] },
];
let view, active=-1, specs=fafbSpecs;
const el = id => document.getElementById(id);
function mix(a,b,t){return a+(b-a)*t;}
function smooth(t){t=Math.min(1,Math.max(0,t));return t*t*(3-2*t);}
window.promo = {
  init(data){
    specs=data.source==='banc'?bancSpecs:fafbSpecs;
    if(data.source==='banc') document.querySelector('.source').innerHTML='BANC v888 · female CNS · representative points<br>sampled links · model pulses, not recorded spikes<br>doi:10.7910/DVN/7WTH1N · CC BY 4.0';
    view = new BrainView(el('brain'), {points:data.points,circuit:data.circuit,onPick:()=>{}});
    view.hovering=true;
    view.synapseLines.material.opacity=0.075;
    view.highlightCloud.material.size=0.34;
    view.renderer.setPixelRatio(1);
    view.resize();
    return {points:data.points.points.length,neurons:data.circuit.neurons.length,edges:data.circuit.edges.length};
  },
  renderAt(index, second){
    if(!view) throw new Error('reel stage not initialized');
    const spec=specs[index];if(!spec) throw new Error('bad reel index');
    if(active!==index){
      active=index;view.setHighlight(null);
      view.groups.forEach((group,gi)=>view.setGroupOpacity(gi,group.tier==='bg'?.36:spec.groups.includes(group.key)?.90:.30));
      el('chapter').textContent=spec.chapter;el('eyebrow').textContent=spec.eyebrow;
      el('headline').innerHTML=spec.headline;el('detail').textContent=spec.detail;
      view.last=null;view.pending=0;view.idle=0;view.activeGlow.clear();view.edgeGlow.fill(0);
      view.clearFlashes();
    }
    const q=smooth(second/8.25);
    view.group.rotation.y=mix(...spec.rotation,q);
    view.group.rotation.x=-0.14+0.13*Math.sin(second*.5+index);
    view.zoom=mix(...spec.zoom,q);
    view.camera.position.z=view.zoom;
    view.camera.position.y=0;
    const fps=24, frame=Math.round(second*fps);
    const nearBeat=beats.some(b=>frame===Math.round(b*fps));
    if(nearBeat || frame%12===0){
      view.flashBudget=24;
      for(const key of spec.groups){
        const group=view.groups.find(g=>g.key===key), ids=group?.indices||[];
        for(let j=0;j<(nearBeat?3:1)&&ids.length;j++) view.addSpikes([ids[(frame*13+j*67+index*23)%ids.length]]);
      }
    }
    view.frame(second*1000+1000);
    // A first-frame hook is more valuable than a cinematic fade-in on Shorts.
    const fade=smooth((8.5-second)/.4);
    el('stage').style.opacity=String(Math.max(0,fade));
    return frame;
  }
};
