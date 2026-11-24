import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
});

test('replay cannot reset or replace the paused original battle', async ({ page }) => {
  const reset = page.getByRole('button', { name: '重置当前想定' });
  const scenario = page.getByLabel('选择战役想定');
  const picker = page.getByRole('button', { name: /选择战役想定.*有限信息演练/ });
  const confirm = page.getByRole('alertdialog', { name: '确认重置或切换想定' });
  const manage = page.getByRole('button', { name: '想定管理' });
  const dialog = page.getByRole('dialog', { name: '想定管理' });
  const launch = dialog.getByRole('button', { name: '启动地图航迹回放播放器' });
  const player = page.getByRole('region', { name: '地图航迹回放播放器' });

  await page.getByRole('button', { name: '+5秒' }).click();
  await expect(page.getByText(/^种子 \d+ · Tick 20$/)).toBeAttached();
  await reset.click();
  await expect(confirm).toBeVisible();

  // Even a live reset confirmation that was already on screen must not survive replay.
  await manage.click();
  await dialog.getByRole('button', { name: '新建断点存档槽' }).click();
  await dialog.getByRole('button', { name: '生成指令重放 JSON' }).click();
  await dialog.getByLabel('回放时间轴').fill('0');
  await launch.click();
  await expect(player).toContainText('Tick 0/20');
  await expect(reset).toBeDisabled();
  await expect(picker).toBeDisabled();
  await expect(scenario).toBeDisabled();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('button', { name: '战役模式' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '遭遇战' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '指挥模式' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '想定编辑' })).toBeDisabled();

  await manage.click();
  await dialog.getByRole('button', { name: '生成指令重放 JSON' }).click();
  for (const name of ['新建断点存档槽', '读档', '覆盖', '生成断点存档 JSON', '加载重放到记录末尾', '恢复断点存档', /跳转至 Tick/, '按此种子重新开局', '校验并热加载此想定']) {
    await expect(dialog.getByRole('button', { name })).toBeDisabled();
  }
  await expect(launch).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await player.getByRole('slider').press('End');
  await expect(player).toContainText('Tick 20/20');
  await expect(reset).toBeDisabled();
  await expect(picker).toBeDisabled();
  await expect(confirm).toBeHidden();

  await player.getByRole('button', { name: '退出回放' }).click();
  await expect(player).toBeHidden();
  await expect(confirm).toBeHidden();
  await expect(page.getByText(/^种子 \d+ · Tick 20$/)).toBeAttached();
  await expect(scenario).toHaveValue('limited_information_exercise');
  await expect(picker).toBeEnabled();
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(confirm).toBeVisible();
});

test('selects a modal option with only the keyboard and keeps focus trapped', async ({ page }) => {
  const skirmish = page.getByRole('button', { name: '遭遇战' });
  await skirmish.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '遭遇战' });
  const first = dialog.getByRole('button', { name: '关闭遭遇战生成器' });
  const last = dialog.getByRole('button', { name: '生成遭遇战并开局' });
  const template = dialog.getByRole('button', { name: /^作战战区模板/ });
  const nativeTemplate = dialog.getByLabel('作战战区模板');
  const list = dialog.getByRole('listbox', { name: '作战战区模板' });

  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(template).toBeFocused();
  const initialValue = await nativeTemplate.inputValue();
  await page.keyboard.press('Space');
  await expect(list).toBeFocused();
  const selected = await list.getAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown');
  await expect(list).not.toHaveAttribute('aria-activedescendant', selected!);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(template).toBeFocused();
  await expect(nativeTemplate).toHaveValue(initialValue);
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  const newLabel = (await list.getByRole('option').last().textContent())!.trim();
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(template).toBeFocused();
  await expect(template).toContainText(newLabel);
  await expect(nativeTemplate).not.toHaveValue(initialValue);

  await page.keyboard.press('ArrowDown');
  await expect(list).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(list).toBeHidden();
  await expect(dialog.getByRole('button', { name: /^红方主力军队配置/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(template).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(list).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(list).toBeHidden();
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(skirmish).toBeFocused();
});

test.describe('390px touch workspace', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('opens the map from details, adds a waypoint, and finishes by touch', async ({ page }) => {
    const details = page.getByRole('region', { name: '详情' });
    const canvas = page.locator('.maplibregl-canvas');
    const finish = page.getByRole('button', { name: '完成标绘' });

    await page.getByRole('button', { name: '详情', exact: true }).tap();
    await expect(details.getByText('RED-ONE', { exact: true })).toBeVisible();
    await expect(details.getByLabel('WP-1 速度')).toHaveCount(0);
    await details.getByRole('button', { name: '[F3] 规划航线' }).tap();
    await expect(details).toBeHidden();
    await expect(finish).toBeInViewport();
    await expect(page.getByText(/航路点标绘模式.*RED-ONE/)).toBeVisible();

    const rect = await canvas.boundingBox();
    expect(rect).not.toBeNull();
    await canvas.tap({ position: { x: Math.round(rect!.width / 2), y: Math.round(rect!.height / 2) } });
    await finish.tap();
    await expect(finish).toBeHidden();
    await expect(details.getByText('RED-ONE', { exact: true })).toBeVisible();
    await expect(details.getByLabel('WP-1 速度')).toBeVisible();
  });
});

test('pure map unmounts drawer contents without replacing the canvas or losing preferences', async ({ page }) => {
  const order = page.locator('#order-panel');
  const inspector = page.locator('#inspector-panel');
  const roster = order.getByRole('button', { name: '编制序列' });
  const group = order.getByRole('button', { name: /红方演练队/ });
  const objectives = order.getByRole('region', { name: '任务目标' }).getByRole('button');
  const layers = order.getByRole('button', { name: '包线图层' });
  const kinematics = inspector.getByText('运动与航路控制');
  const pureMap = page.getByRole('button', { name: '纯地图' });
  const canvas = page.locator('.maplibregl-canvas');

  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await objectives.click();
  await expect(objectives).toHaveAttribute('aria-expanded', 'true');
  await layers.click();
  await kinematics.click();
  await expect(inspector.getByRole('button', { name: /清空航点/ })).toBeHidden();
  const initialCanvas = await canvas.elementHandle();

  await pureMap.click();
  await expect(order.locator('aside')).toHaveCount(0);
  await expect(inspector.locator('aside')).toHaveCount(0);
  await page.getByRole('button', { name: '+5秒' }).click();
  expect(await canvas.evaluate((element, original) => element === original, initialCanvas)).toBe(true);

  await pureMap.click();
  await expect(layers).toHaveAttribute('aria-pressed', 'true');
  await expect(objectives).toHaveAttribute('aria-expanded', 'true');
  await expect(inspector.getByRole('button', { name: /清空航点/ })).toBeHidden();
  await roster.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
});

test('confirmed exercise task locks the opening seat and mode until restart', async ({ page }) => {
  const seat = page.getByLabel('控制席位');
  const mode = page.getByRole('button', { name: '指挥模式' });
  await expect(seat).toBeEnabled();
  await expect(mode).toBeEnabled();

  const task = page.getByRole('region', { name: '演练任务' });
  await task.getByRole('button', { name: '安排任务' }).click();
  await task.getByLabel('指定单位').selectOption({ label: 'RED-ONE' });
  await task.getByRole('button', { name: '确认排程' }).click();
  await expect(seat).toBeDisabled();
  await expect(mode).toBeDisabled();
  await expect(mode).toHaveAttribute('title', /重置想定/);

  await task.getByRole('button', { name: '停止任务' }).click();
  await expect(seat).toBeDisabled();
  await expect(mode).toBeDisabled();
  await page.getByRole('button', { name: '重置当前想定' }).click();
  await expect(seat).toBeEnabled();
  await expect(mode).toBeEnabled();
});
