// Render five 9:16 social clips from NeuroFly's own BrainView and FAFB data.
// Usage: node tools/render-reels.mjs --ffmpeg=C:\path\ffmpeg.exe [--reel=1]
// Animation is clearly labelled as model activity, not empirical spiking.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { loadBrainData } from '../src/data.js';
import { createSpecimenStore } from '../src/specimen-data.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const edition=process.argv.find(x=>x.startsWith('--edition='))?.slice(10)||'original';
if(!['original','motion'].includes(edition)) throw new Error('--edition must be original or motion');
const out = path.join(root, 'promos',edition==='motion'?'motion':'');
const ffmpeg = process.argv.find(x => x.startsWith('--ffmpeg='))?.slice(9) || 'ffmpeg';
const reelArg = process.argv.find(x => x.startsWith('--reel='))?.slice(7);
const selected = reelArg ? [Number(reelArg)-1] : [0,1,2,3,4];
if (selected.some(i => !Number.isInteger(i) || i<0 || i>4)) throw new Error('--reel must be 1..5');
const source=process.argv.find(x=>x.startsWith('--source='))?.slice(9)||'banc';
if(!['banc','fafb'].includes(source)) throw new Error('--source must be banc or fafb');
if(edition==='motion'&&source!=='banc') throw new Error('motion edition requires BANC v888');
const frameLimitArg=process.argv.find(x=>x.startsWith('--frames='))?.slice(9);
const frameLimit=frameLimitArg?Number(frameLimitArg):null;
const chrome = process.argv.find(x => x.startsWith('--chrome='))?.slice(9)
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FPS=24, DURATION=8.5, W=720, H=1280;

function originalScore(file, seed) {
  const sampleRate=48000, total=Math.round(DURATION*sampleRate), pcm=Buffer.alloc(total*4);
  const roots=[110,130.81,98,146.83,116.54];
  const rootHz=roots[seed], chord=[1,1.4983,2,2.3784];
  const pulses=edition==='motion'?[0,.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8]:[0,1.2,2.7,4.1,5.9,7.2];
  for(let i=0;i<total;i++){
    const t=i/sampleRate;
    const swell=Math.min(1,t/.8,Math.max(0,(DURATION-t)/.8));
    let v=0;
    for(let k=0;k<chord.length;k++){
      const f=rootHz*chord[k], phase=2*Math.PI*f*t;
      v+=(Math.sin(phase+.12*Math.sin(.7*t+k))+.22*Math.sin(2*phase))*(.045+.012*k);
    }
    v+=.10*Math.sin(2*Math.PI*(rootHz/2)*t);
    for(let b=0;b<pulses.length;b++){
      const d=t-pulses[b];if(d>=0&&d<(edition==='motion'?.55:1.4)){
        const bell=Math.exp(-d*4)*(Math.sin(2*Math.PI*rootHz*(4+b%3)*d)+.3*Math.sin(2*Math.PI*rootHz*(8+b%3)*d));
        const sub=Math.exp(-d*(edition==='motion'?13:8))*Math.sin(2*Math.PI*(edition==='motion'?70:55)*d);
        v+=(edition==='motion'?.08:.12)*bell+(edition==='motion'?.20:.16)*sub;
        if(edition==='motion'&&d<.11) v+=.025*Math.sin(2*Math.PI*3100*d)*Math.exp(-d*42);
      }
    }
    const s=Math.max(-1,Math.min(1,v*swell));
    pcm.writeInt16LE(Math.round(s*32767),i*4);
    pcm.writeInt16LE(Math.round(s*32767),i*4+2);
  }
  const wav=Buffer.alloc(44+pcm.length);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);
  wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*4,28);
  wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);
  pcm.copy(wav,44);
  return fs.writeFile(file,wav);
}

await fs.mkdir(out,{recursive:true});
console.log(`Loading ${source.toUpperCase()} connectome input…`);
let scenePoints,sceneCircuit;
if(source==='banc'){
  // One native female brain-and-cord specimen, validated by bundle SHA-256.
  const bundle=createSpecimenStore().load('banc-v888');
  const located=bundle.neurons.map((n,i)=>({n,i})).filter(x=>x.n.pos);
  const remap=new Int32Array(bundle.neurons.length).fill(-1);
  located.forEach(({i},k)=>{remap[i]=k;});
  const classes=[...new Set(located.map(({n})=>n.superClass||'unclassified'))];
  scenePoints={classes,points:located.map(({n})=>[...n.pos,classes.indexOf(n.superClass||'unclassified')])};
  sceneCircuit={neurons:located.map(({n})=>({id:n.id,type:n.superClass||'unclassified',pos:n.pos})),
    // Contacts are measured structurally; their effect/sign is unknown here.
    edgeSignKnown:false,edges:bundle.edges.filter((e,i)=>i%5===0&&remap[e[0]]>=0&&remap[e[1]]>=0).map(e=>[remap[e[0]],remap[e[1]],1])};
}else{
  const data=loadBrainData();if(!data) throw new Error('NeuroFly brain data is missing');
  // BrainView normally receives 784k model edges; social-size frames cannot
  // distinguish them. A deterministic subset preserves real mapped links.
  const featured=new Set(['lc4','lplc2','gf','dna01','dna02','dnp09','escw']);
  scenePoints=data.points;
  sceneCircuit={neurons:data.circuit.neurons,
    edges:data.circuit.edges.filter((edge,i)=>i%30===0||(i%5===0&&featured.has(data.circuit.neurons[edge[0]]?.role)))};
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+name);
    if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]) throw new Error('not a local render resource');
    res.setHeader('Content-Type',mime[path.extname(file)]);
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
console.log('Opening local reel stage…');
const browser=await chromium.launch({executablePath:chrome,headless:true,
  args:['--enable-webgl','--use-gl=angle','--use-angle=d3d11','--no-sandbox']});
const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
page.on('pageerror',error=>console.error('renderer:',error.message));
page.on('console',message=>{if(message.type()==='error') console.error('browser:',message.text().slice(0,300));});
await page.goto(`http://127.0.0.1:${server.address().port}/renderer/${edition==='motion'?'motion':'reels'}.html`,{waitUntil:'load'});
await page.waitForFunction(()=>!!window.promo);
console.log('Reel stage loaded; initializing 3D scene…');
const init=await page.evaluate(d=>window.promo.init(d),{points:scenePoints,circuit:sceneCircuit,source});
console.log('Using program BrainView:',JSON.stringify(init));
for(const index of selected){
  const id=String(index+1).padStart(2,'0');
  const wav=path.join(out,`reel-${id}-original-score.wav`);
  const mp4=path.join(out,`reel-${id}.mp4`);
  await originalScore(wav,index);
  const args=['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(FPS),'-vcodec','mjpeg','-i','pipe:0',
    '-i',wav,'-map','0:v:0','-map','1:a:0','-vf','scale=in_range=full:out_range=limited,format=yuv420p',
    '-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv',
    '-r',String(FPS),'-c:a','aac','-b:a','192k','-t',String(DURATION),'-movflags','+faststart',mp4];
  const encoder=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe']});
  let error='';encoder.stderr.on('data',b=>{error=(error+b.toString()).slice(-6000);});
  encoder.on('error',e=>{error=e.message;});
  const count=frameLimit??Math.round(DURATION*FPS);
  console.log(`REEL ${id}: ${count} frames`);
  for(let f=0;f<count;f++){
    const t=f/FPS;
    await page.evaluate(({index,t})=>window.promo.renderAt(index,t),{index,t});
    // Wait one compositor cycle after the WebGL render before capturePage.
    await new Promise(resolve=>setTimeout(resolve,13));
    const jpeg=await page.screenshot({type:'jpeg',quality:92});
    if(!jpeg.length) throw new Error(`empty frame ${id}/${f}`);
    if(f===Math.min(Math.round(3*FPS),count-1)) await fs.writeFile(path.join(out,`reel-${id}-cover.png`),await page.screenshot({type:'png'}));
    if(!encoder.stdin.write(jpeg)) await once(encoder.stdin,'drain');
    if(f%48===0) console.log(`  ${id} ${f}/${count}`);
  }
  encoder.stdin.end();
  const [code]=await once(encoder,'close');
  if(code!==0) throw new Error(`ffmpeg exited ${code}: ${error}`);
  console.log(`DONE ${mp4}`);
}
await browser.close();
await new Promise(resolve=>server.close(resolve));
