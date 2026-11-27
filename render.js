// Render iklan Dinduy -> MP4 60fps, FRAME PER FRAME (bukan rekam layar).
// Jam browser dipalsukan: tiap frame maju tepat 1/60 detik, lalu di-screenshot.
// Jadi secepat/selambat apa pun server GitHub, hasilnya tetap mulus.
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const W = 1920, H = 1080, FPS = 60;
const SECONDS = Number(process.env.SECONDS || 25);   // iklan 24.6 dtk + jeda aman
const OUT = process.env.OUT || 'dinduy-ad.mp4';
const FRAMES = Math.round(SECONDS * FPS);

// Dijalankan di dalam halaman SEBELUM script index.html jalan
function installVirtualClock() {
  let vt = 0;
  const realST = window.setTimeout.bind(window);
  Object.defineProperty(performance, 'now', { value: () => vt, configurable: true });

  // requestAnimationFrame & setTimeout versi virtual
  let rafQ = [], rafId = 0, timers = [], tid = 0;
  window.requestAnimationFrame = cb => { rafQ.push([++rafId, cb]); return rafId; };
  window.cancelAnimationFrame = id => { rafQ = rafQ.filter(x => x[0] !== id); };
  window.setTimeout = (fn, ms = 0, ...a) => { timers.push({ id: ++tid, at: vt + ms, fn, a }); return tid; };
  window.clearTimeout = id => { timers = timers.filter(t => t.id !== id); };

  // Semua animasi WAAPI / CSS dipause, currentTime diatur manual dari jam virtual
  const tracked = new Set();
  const track = a => { if (!tracked.has(a)) { a.__t0 = vt; tracked.add(a); try { a.pause(); a.currentTime = 0; } catch (e) {} } };
  const origAnimate = Element.prototype.animate;
  Element.prototype.animate = function () { const a = origAnimate.apply(this, arguments); track(a); return a; };

  // Video demo: jangan diputar real-time, tapi di-seek per frame
  const vids = new Map();
  HTMLMediaElement.prototype.play = function () { vids.set(this, vt); return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () { vids.delete(this); };

  window.__advance = () => {
    vt += 1000 / 60;
    const due = timers.filter(t => t.at <= vt); timers = timers.filter(t => t.at > vt);
    due.forEach(t => { try { t.fn(...t.a); } catch (e) { console.error(e); } });
    document.getAnimations().forEach(a => { if (!tracked.has(a)) track(a); });
    tracked.forEach(a => {
      if (a.playState === 'idle') { tracked.delete(a); return; }
      try { a.currentTime = vt - a.__t0; } catch (e) {}
    });
    const q = rafQ; rafQ = [];
    q.forEach(([, cb]) => { try { cb(vt); } catch (e) { console.error(e); } });
    return vt;
  };
  window.__seekVideos = () => Promise.all([...vids].map(([v, t0]) => new Promise(res => {
    const d = v.duration || 0;
    let t = (vt - t0) / 1000; if (d > 0) t = t % d;
    if (Math.abs(v.currentTime - t) < 0.0005) return res();
    v.addEventListener('seeked', () => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => res()); else res();
    }, { once: true });
    realST(res, 700);   // jaga-jaga biar nggak nyangkut
    v.currentTime = t;
  })));
}

(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb']
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await page.addInitScript(installVirtualClock);

  await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  console.log('Font Google Sans Flex ke-load:', await page.evaluate(() => document.fonts.check('800 40px "Google Sans Flex"')));

  // 4 video demo (demo1..demo4). Chromium bawaan Playwright nggak bisa baca H.264, jadi dipakai versi webm.
  for (let i = 1; i <= 4; i++) {
    const f = [`demo${i}.webm`, `demo${i}.mp4`].find(x => fs.existsSync(x));
    if (!f) { console.log(`demo${i} belum ada -> adegan ${i} pakai video sebelumnya/placeholder`); continue; }
    console.log(`Pakai video adegan ${i}:`, f);
    await page.evaluate(([idx, src]) => new Promise(res => {
      const v = document.querySelectorAll('.dv')[idx];
      v.addEventListener('loadeddata', () => res(), { once: true });
      v.addEventListener('error', () => res(), { once: true });
      v.src = src; v.load();
    }), [i - 1, f]);
  }

  await page.addStyleTag({ content: '#hud{transition:none !important}' });
  for (let i = 0; i < 60; i++) await page.evaluate(() => window.__advance());   // pemanasan 1 dtk virtual
  await page.evaluate(() => document.getElementById('play').click());          // play() catat t0 = jam virtual

  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-movflags', '+faststart', OUT
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise(res => ff.on('close', res));

  const t0 = Date.now();
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate(() => window.__advance());
    await page.evaluate(() => window.__seekVideos());
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 120 === 0) console.log(`frame ${i}/${FRAMES}  (${((Date.now() - t0) / 1000).toFixed(0)} dtk)`);
  }
  ff.stdin.end();
  await ffDone;
  await browser.close();
  console.log('Selesai ->', OUT);
})();
