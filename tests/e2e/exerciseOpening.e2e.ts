import { expect, test } from '@playwright/test';

const redGoal = '取得演习标志船的接触';
const blueGoal = '让标志船抵达交接点';
const redContact = 'SKUNK-303 [疑似大型水面舰]';
const blueContact = 'RED-ONE · Type 052DL Luyang III';
const openingName = '演练开局';

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
});

test('opens the observing seat’s report at Tick 0 and keeps map tools usable after dismissal', async ({ page }) => {
  await page.goto('/');
  const card = page.getByRole('region', { name: openingName });
  const inspector = page.getByRole('region', { name: '详情' });
  const play = page.getByRole('button', { name: '开始推演', exact: true });
  const ruler = page.getByRole('button', { name: '测距尺', exact: true });
  const atStart = page.getByText('种子 20261028 · Tick 0', { exact: true });

  await expect(page.getByLabel('选择战役想定')).toHaveValue('limited_information_exercise');
  await expect(atStart).toBeAttached();
  await expect(card.getByText(redGoal, { exact: true })).toBeVisible();
  await expect(card.getByText('已分类 · 定位误差 210 km')).toBeVisible();
  await ruler.click();
  await expect(ruler).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(ruler).toHaveAttribute('aria-pressed', 'false');

  const redReport = card.getByRole('button', { name: /SKUNK-303/ });
  await redReport.press('Space');
  await expect(inspector).toBeFocused();
  await expect(inspector.getByText(redContact, { exact: true })).toBeVisible();
  await expect(inspector.getByText('观测坐标:', { exact: true })).toBeVisible();
  await expect(atStart).toBeAttached();
  await expect(play).toBeEnabled();

  const briefing = card.getByRole('button', { name: '查看完整简报' });
  await briefing.press('Enter');
  const dialog = page.getByRole('dialog', { name: '想定简报' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(briefing).toBeFocused();

  await page.getByLabel('控制席位').selectOption('BLUE');
  await expect(card.getByText(blueGoal, { exact: true })).toBeVisible();
  await expect(card.getByText(redGoal, { exact: true })).toHaveCount(0);
  await expect(redReport).toHaveCount(0);
  await page.getByRole('button', { name: '红方', exact: true }).click();
  const blueReport = card.getByRole('button', { name: /RED-ONE/ });
  await blueReport.click();
  await expect(inspector.getByText(blueContact, { exact: true })).toBeVisible();
  await expect(atStart).toBeAttached();

  await card.getByRole('button', { name: '关闭开局卡' }).press('Enter');
  await expect(card).toBeHidden();
  await expect(play).toBeEnabled();
  await ruler.click();
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width * 0.4, y: box!.height * 0.5 } });
  await canvas.click({ position: { x: box!.width * 0.6, y: box!.height * 0.5 } });
  await expect(page.getByText(/\d+\.\d km · \d+\.\d°T/)).toBeVisible();
  await expect(atStart).toBeAttached();

  await page.getByLabel('重置当前想定').click();
  await expect(card.getByText(redGoal, { exact: true })).toBeVisible();
  await expect(atStart).toBeAttached();
});

test('keeps the card, inspector, and playback reachable at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.getByRole('region', { name: openingName });
  const inspector = page.getByRole('region', { name: '详情' });
  const play = page.getByRole('button', { name: '开始推演', exact: true });
  const moreTools = page.getByText('更多工具', { exact: true });
  const atStart = page.getByText('种子 20261028 · Tick 0', { exact: true });

  await expect(card.getByText(redGoal, { exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await card.getByRole('button', { name: /SKUNK-303/ }).click();
  await expect(inspector).toBeFocused();
  await expect(inspector.getByText(redContact, { exact: true })).toBeInViewport();
  await expect(card).toBeHidden();
  await expect(play).toBeInViewport();
  await expect(atStart).toBeAttached();

  await moreTools.click();
  await expect(page.getByRole('button', { name: '想定管理' })).toBeVisible();
  await page.getByRole('button', { name: '指挥红方', exact: true }).click();
  await page.getByRole('option', { name: '指挥蓝方' }).click();
  await moreTools.press('Escape');
  await expect(inspector).toBeHidden();
  await expect(card.getByText(blueGoal, { exact: true })).toBeInViewport();
  await expect(card.getByRole('button', { name: /RED-ONE/ })).toBeInViewport();

  await card.getByRole('button', { name: '以 5× 开始' }).press('Space');
  await expect(card).toBeHidden();
  await expect(page.getByRole('button', { name: '5×', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(atStart).toHaveCount(0);
  await page.getByRole('button', { name: '暂停推演', exact: true }).click();
  await expect(play).toBeEnabled();
  await expect(card).toBeHidden();
});

test('does not show the opening in sandbox, other scenarios, or Tick 0 playback', async ({ page }) => {
  await page.goto('/');
  const card = page.getByRole('region', { name: openingName });
  const scenarios = page.getByLabel('选择战役想定');
  await expect(card).toBeVisible();

  await page.getByRole('button', { name: '指挥模式' }).click();
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: '沙盒模式' }).click();
  await expect(card).toBeVisible();

  await scenarios.selectOption('interactive_command_tutorial');
  await expect(card).toBeHidden();
  await scenarios.selectOption('limited_information_exercise');
  await expect(card).toBeVisible();

  await page.getByRole('button', { name: '+5秒' }).click();
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByRole('button', { name: '生成指令重放 JSON' }).click();
  await page.getByLabel('回放时间轴').fill('0');
  await page.getByRole('button', { name: '启动地图航迹回放播放器' }).click();
  await expect(page.getByLabel('地图航迹回放播放器')).toContainText('Tick 0/20');
  await expect(card).toBeHidden();
});
