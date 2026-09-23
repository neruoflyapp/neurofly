// Preserve the real NeuroFly capture and its quiet audio while motion-
// interpolating display frames from 24 to 60 fps for smoother playback.
// This is a display-only operation; it invents no neural measurements.
// Usage: node tools/smooth-feature-clip.mjs --ffmpeg=C:\path\to\ffmpeg.exe

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'promos', 'feature');
const input = path.join(dir, 'feature-loom-22s.mp4');
const intermediate = path.join(dir, 'feature-loom-22s.interpolated.mp4');
const repaired = path.join(dir, 'feature-loom-22s.repaired.mp4');
const output = path.join(dir, 'feature-loom-22s-smooth-quiet.mp4');
const ffmpeg = process.argv.find((arg) => arg.startsWith('--ffmpeg='))?.slice(9) || 'ffmpeg';
const args = ['-hide_banner', '-loglevel', 'error', '-stats_period', '30', '-stats', '-y', '-i', input,
  '-map', '0:v:0', '-map', '0:a:0', '-vf',
  'minterpolate=fps=60:mi_mode=mci:mc_mode=obmc:me_mode=bilat:me=epzs:mb_size=16:search_param=8:vsbmc=0,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
  '-c:a', 'copy', '-movflags', '+faststart', intermediate];
async function run(args, phase) {
  const render = spawn(ffmpeg, args, { stdio: 'inherit' });
  const [code] = await once(render, 'close');
  if (code !== 0) throw new Error(`${phase} failed (${code})`);
}
await run(args, 'Motion interpolation');
// A camera cut and a rapid flight jump are too discontinuous for optical flow.
// Restore the original terrarium pixels for only those brief moments; the
// graphs and connectome keep their smoother display frames throughout.
const patch = "[1:v]fps=60,crop=720:550:0:56,format=yuv420p[original];" +
  "[0:v][original]overlay=0:56:enable='between(t,10.50,10.72)+between(t,12.98,13.24)':shortest=1[out]";
await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', intermediate, '-i', input,
  '-filter_complex', patch, '-map', '[out]', '-map', '0:a:0', '-c:v', 'libx264',
  '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
  '-c:a', 'copy', '-movflags', '+faststart', repaired], 'Cut repair');
fs.copyFileSync(repaired, output);
fs.unlinkSync(intermediate);
fs.unlinkSync(repaired);
console.log(`Smooth 60 fps master: ${output}`);
