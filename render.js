const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const width = 1920;
  const height = 1080;
  const adDurationMs = 25000; // Durasi animasi Dinduy 24.6 detik + 0.4 detik jeda aman di ending

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: './raw-video',
      size: { width, height }
    }
  });

  const filePath = 'file://' + path.resolve('index.html');

  // Pemanasan: muat font Google Sans Flex ke cache browser dulu
  const warmupPage = await context.newPage();
  await warmupPage.goto(filePath, { waitUntil: 'networkidle' });
  await warmupPage.evaluate(() => document.fonts.ready);
  await warmupPage.close();
  fs.rmSync('./raw-video', { recursive: true, force: true });

  // Mulai sesi rekaman utama
  const recStart = Date.now();
  const page = await context.newPage();
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  // Hilangkan efek transisi fade pada layar tombol Play agar frame pertama langsung bersih
  await page.addStyleTag({ content: '#hud { transition: none !important; }' });
  await page.waitForTimeout(300);

  // Catat jeda waktu sebelum tombol Play ditekan untuk dipotong otomatis oleh FFmpeg
  const trimStartSeconds = ((Date.now() - recStart) / 1000).toFixed(3);
  fs.writeFileSync('trim_offset.txt', trimStartSeconds);

  // Klik tombol Play ad dan rekam sampai selesai sebelum overlay muncul lagi
  await page.click('#play');
  await page.waitForTimeout(adDurationMs);

  await context.close();
  await browser.close();
})();
