import { expect, test } from '@playwright/test';

test('delivers the marker vessel using the blue map handoff and explains the win', async ({ page }) => {
  test.setTimeout(75_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
  await page.getByLabel('控制席位').selectOption('BLUE');
  await page.getByRole('button', { name: '关闭开局卡' }).click();
  await page.getByRole('button', { name: /清空航点/ }).click();
  await page.getByRole('button', { name: '巡逻任务' }).click();
  await page.getByText('标志船交接点 · BLUE', { exact: true }).click();
  await page.getByRole('button', { name: '[F3] 规划航线' }).click();
  await expect(page.getByText(/航路点标绘模式/)).toBeVisible();
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No visible map');
  const center = { x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) };
  await expect(async () => {
    await canvas.hover({ position: { x: center.x + 3, y: center.y } });
    await canvas.hover({ position: center });
    const readout = page.locator('.map-status').getByText(/°N, .*°E/);
    const coords = (await readout.textContent())?.match(/([\d.]+)°N, ([\d.]+)°E/);
    expect(Math.abs(Number(coords?.[1]) - 25)).toBeLessThan(.008);
    expect(Math.abs(Number(coords?.[2]) - 124.70)).toBeLessThan(.008);
  }).toPass({ timeout: 5000 });
  await canvas.click({ position: center });
  await expect(page.getByRole('button', { name: /清空航点\(1\)/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '60×', exact: true }).click();
  const evidence = page.getByRole('region', { name: '本局结算依据' });
  await expect(evidence).toContainText('主要目标已达成 · 让标志船抵达交接点', { timeout: 55_000 });
  await expect(evidence).toContainText('目标达成记录');
  await expect(page.getByRole('dialog', { name: '战后结算与评估' })).toContainText('战役/任务胜利');
});
