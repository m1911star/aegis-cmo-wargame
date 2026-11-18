import { chromium } from 'playwright';
import { SCENARIO_EAST_SEA_THUNDER } from '../src/scenarios/builtinScenarios';
import { INFORMATION_EXERCISE } from '../src/scenarios/informationExercise';

const url = process.env.BENCH_URL ?? 'http://127.0.0.1:4186/';
const scales = (process.env.BENCH_SCALES ?? '1,5,15,60').split(',').map(Number);
const runs = Number(process.env.BENCH_RUNS ?? 5);
const durationMs = Number(process.env.BENCH_MS ?? 7000);
const density = Number(process.env.BENCH_DENSITY ?? 1);
if (!Number.isSafeInteger(density) || density < 1 || density > 10) throw new Error('Invalid BENCH_DENSITY');
const denseScenario = density > 1 ? {
  ...INFORMATION_EXERCISE,
  id: 'performance_density_fixture',
  title: '性能测试 · 合成密集单元',
  units: [...INFORMATION_EXERCISE.units, ...Array.from({ length: density - 1 }, (_, index) =>
    INFORMATION_EXERCISE.units.map((unit) => ({
      ...unit, id: `${unit.id}_bench_${index}`, callsign: `${unit.callsign}-${index}`,
      position: [unit.position[0] + (index + 1) * 0.003, unit.position[1] + (index + 1) * 0.004],
    }))
  ).flat()],
} : null;
if (!scales.every((s) => [1, 5, 15, 60].includes(s)) || !Number.isSafeInteger(runs) || runs < 1 || durationMs < 1000 || !Number.isFinite(durationMs)) {
  throw new Error('Invalid BENCH_SCALES, BENCH_RUNS or BENCH_MS');
}
const browser = await chromium.launch({ channel: 'chromium' });
try {
  console.log(JSON.stringify({ chrome: browser.version(), url, runs, durationMs, scales, density, basemap: 'offline' }));
  for (const speed of scales) for (let i = 0; i < runs; i++) for (const with3d of (i % 2 ? [true, false] : [false, true])) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    try {
      await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('requestfailed', (request) => {
        if (!request.url().startsWith('https://tiles.openfreemap.org/')) errors.push(request.url());
      });
      await page.addInitScript(() => {
        const stats = { sent: 0, received: 0, roundTrips: [] as number[] };
        Object.assign(window, { benchStats: stats });
        const post = Worker.prototype.postMessage;
        const listening = new WeakSet<Worker>();
        const sentAt = new Map<number, number>();
        Worker.prototype.postMessage = function (message, ...args) {
          if (message?.type === 'ADVANCE_BATCH') {
            stats.sent++;
            sentAt.set(message.requestId, performance.now());
            if (!listening.has(this)) {
              listening.add(this);
              this.addEventListener('message', (event) => {
                if (event.data?.type !== 'ADVANCE_BATCH_RESULT') return;
                const start = sentAt.get(event.data.requestId);
                if (start === undefined) return;
                sentAt.delete(event.data.requestId);
                stats.received++;
                stats.roundTrips.push(performance.now() - start);
              });
            }
          }
          Reflect.apply(post, this, [message, ...args]);
        };
      });
      await page.goto(url);
      if (!await page.locator('script[src^="/assets/index-"]').count()) throw new Error('Use the production Vite preview, not the dev server');
      if (denseScenario) {
        await page.getByRole('button', { name: '想定管理' }).click();
        await page.getByLabel('想定或重放 JSON').fill(JSON.stringify(denseScenario));
        await page.getByRole('button', { name: '校验并热加载此想定' }).click();
        await page.getByLabel('选择战役想定').waitFor({ state: 'visible' });
        if (await page.getByLabel('选择战役想定').inputValue() !== denseScenario.id) throw new Error('Density fixture did not load');
      } else {
        await page.getByLabel('选择战役想定').selectOption(SCENARIO_EAST_SEA_THUNDER.id);
      }
      await page.getByRole('button', { name: '包线图层', exact: true }).click();
      await page.getByLabel('地理底图').selectOption('offline');
      if (with3d) {
        await page.getByRole('button', { name: '3D视窗', exact: true }).click();
        await page.locator('#tacview-3d-floating-window canvas').waitFor({ state: 'visible' });
      }
      await page.locator('.maplibregl-canvas').waitFor({ state: 'visible' });
      const status = page.getByText(/^种子 \d+ · Tick 0$/);
      await status.waitFor({ state: 'attached' });
      const seed = Number((await status.textContent())?.match(/\d+/)?.[0]);
      await page.waitForTimeout(600);
      const row = await page.evaluate(async ({ speed, durationMs }) => {
        const n = (value: string | null) => Number(value?.match(/Tick (\d+)/)?.[1]);
        const status = Array.from(document.querySelectorAll('p')).find((p) => p.textContent?.startsWith('种子 ') && n(p.textContent) === 0);
        const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === `${speed}×`);
        if (!status || !button) throw new Error('Could not find simulation controls');
        const stats = (window as Window & { benchStats?: { sent: number; received: number; roundTrips: number[] } }).benchStats!;
        const frames: number[] = [];
        const changes: number[] = [];
        const tasks: number[] = [];
        const observer = new PerformanceObserver((list) => tasks.push(...list.getEntries().map((entry) => entry.duration)));
        observer.observe({ type: 'longtask' });
        const start = performance.now();
        let last = start, changed = start, tick = 0, frame = 0;
        const sample = (now: number) => {
          if (now >= last) frames.push(now - last);
          last = Math.max(last, now);
          const next = n(status.textContent);
          if (next !== tick) { changes.push(now - changed); tick = next; changed = now; }
          frame = requestAnimationFrame(sample);
        };
        button.click(); frame = requestAnimationFrame(sample);
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        cancelAnimationFrame(frame); observer.disconnect();
        const elapsedMs = performance.now() - start;
        const finalTick = n(status.textContent);
        const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? null;
        return { elapsedMs, tick: finalTick, actualScale: finalTick * 250 / elapsedMs, frameSamples: frames.length,
          frameP95Ms: p95(frames), updateP95Ms: p95(changes), longTasks: tasks.length,
          workerSent: stats.sent, workerReceived: stats.received, workerP95Ms: p95(stats.roundTrips) };
      }, { speed, durationMs });
      if (errors.length || !Number.isFinite(seed) || !(row.tick > 0) || row.frameSamples < 5 || (speed >= 15 && row.workerReceived === 0)) {
        throw new Error(JSON.stringify({ errors, speed, with3d, row }));
      }
      console.log(JSON.stringify({ seed, scenario: denseScenario?.id ?? SCENARIO_EAST_SEA_THUNDER.id,
        initialUnits: denseScenario?.units.length ?? SCENARIO_EAST_SEA_THUNDER.units.length, speed, with3d, run: i + 1, ...row }));
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
