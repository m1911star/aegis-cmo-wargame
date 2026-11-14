import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AEGIS-CMO', { exact: true })).toBeVisible();
});

test('loads the command workspace and switches tactical scenarios', async ({ page }) => {
  const scenario = page.getByLabel('选择战役想定');
  await expect(scenario).toHaveValue('limited_information_exercise');
  await scenario.selectOption('op_deep_sea_carrier_hunt_2028');
  await expect(scenario).toHaveValue('op_deep_sea_carrier_hunt_2028');
  await expect(scenario.locator('option:checked')).toContainText('深海猎杀');
});

test('selects an available carrier loadout before launching the recorded sortie', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_deep_sea_carrier_hunt_2028');
  const loadout = page.getByLabel('歼-35 舰载隐身战斗机第1中队 起飞挂载');
  await expect(loadout).toHaveValue('loadout_j35_carrier_cap');
  await expect(loadout.locator('option')).toHaveCount(2);
  await expect(loadout.locator('option[value="loadout_f35c_stealth_cap"]')).toHaveCount(0);
  await loadout.selectOption('loadout_j35_maritime_strike');
  await loadout.locator('xpath=..').getByRole('button', { name: '弹射升空' }).click();
  await expect(page.getByLabel('战术挂载方案切换')).toHaveValue('loadout_j35_maritime_strike');
});

test('configures automatic weapon-release limits from the unit inspector', async ({ page }) => {
  await page.getByLabel('自动开火最大射程比例').selectOption('0.5');
  await page.getByLabel('自动开火最低弹药保留').fill('2');
  await page.getByLabel('自动开火最低威胁等级').selectOption('high');
  await page.getByRole('button', { name: '水面', exact: true }).click();
  await expect(page.getByLabel('自动开火最大射程比例')).toHaveValue('0.5');
  await expect(page.getByLabel('自动开火最低弹药保留')).toHaveValue('2');
  await expect(page.getByLabel('自动开火最低威胁等级')).toHaveValue('high');
  await expect(page.getByRole('button', { name: '水面', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('edits route-leg speed and altitude and issues a group formation order', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  await page.getByLabel('WP-1 速度').fill('500');
  await page.getByLabel('WP-1 高度或潜深').fill('6000');
  await page.getByRole('button', { name: '设为编队领队' }).click();
  await expect(page.getByLabel('WP-1 速度')).toHaveValue('500');
  await expect(page.getByLabel('WP-1 高度或潜深')).toHaveValue('6000');
  await expect(page.getByText('编队领航：DRAGON-01', { exact: true })).toBeVisible();
});

test('creates a replayable patrol mission from same-side reference points', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  await page.getByRole('button', { name: '巡逻任务' }).click();
  await page.getByLabel('任务名称').fill('E2E 东海 CAP');
  await page.getByLabel('选择参考点 RP-1 东海ADIZ北界点').check();
  await page.getByLabel('选择参考点 RP-2 钓鱼岛北基准点').check();
  await page.getByLabel('选择参考点 RP-4 反舰突击轴线点').check();
  await page.getByRole('button', { name: '创建任务' }).click();
  await expect(page.locator('#order-panel').getByText('E2E 东海 CAP', { exact: true })).toBeVisible();
});

test('releases a finite carried UAV as an independent observable unit', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  await page.locator('#order-panel').getByText('THUNDER-08', { exact: true }).click();
  await page.getByRole('button', { name: '释放', exact: true }).click();
  await expect(page.locator('#inspector-panel').getByText(/无侦-8 高空高速无人侦察平台 #1/)).toBeVisible();
});

test('queues a compatible receiver for finite air-to-air refueling', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  const request = page.getByRole('button', { name: '请求加油' });
  await expect(page.getByLabel('选择加油机')).toHaveValue('red_y20u_tanker');
  await expect(request).toBeDisabled();
  await page.getByRole('button', { name: '开始推演' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '暂停推演' }).click();
  await expect(request).toBeEnabled();
  await request.click();
  await expect(page.getByRole('button', { name: '会合中' })).toBeVisible();
});

test('edits scenario groups, objectives and area events in sandbox builder', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  await page.getByRole('button', { name: '指挥模式' }).click();
  await page.getByRole('button', { name: '想定编辑' }).click();
  await expect(page.getByText('SCENARIO BUILDER // 可视化想定编辑')).toBeVisible();
  await page.getByLabel('编组名称').fill('E2E 联合编组');
  await page.getByRole('button', { name: '保存编组' }).click();
  await page.getByLabel('目标标题').fill('E2E 主要目标');
  await page.getByLabel('目标单位').selectOption('blue_ddg125_lucas');
  await page.getByRole('button', { name: '添加主要目标' }).click();
  await expect(page.getByText('RED · E2E 主要目标', { exact: true })).toBeVisible();
  await page.getByLabel('事件参考点 RP-1 东海ADIZ北界点').check();
  await page.getByLabel('事件参考点 RP-2 钓鱼岛北基准点').check();
  await page.getByLabel('事件参考点 RP-4 反舰突击轴线点').check();
  await page.getByRole('button', { name: '创建区域事件' }).click();
  await expect(page.getByText(/区域进入警报 · UNIT_ENTERS_AREA/)).toBeVisible();
});

test('measures map distance and true bearing with the display-only ruler', async ({ page }) => {
  await page.getByRole('button', { name: '测距尺' }).click();
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.4, box!.y + box!.height * 0.5);
  await page.mouse.click(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5);
  await expect(page.getByText(/\d+\.\d km · \d+\.\d°T/)).toBeVisible();
});

test('gates full-truth AAR until sandbox or battle end and shows the independent ledger', async ({ page }) => {
  const aarButton = page.getByRole('button', { name: '战后复盘' });
  await expect(aarButton).toBeDisabled();
  await page.getByRole('button', { name: '指挥模式' }).click();
  await expect(aarButton).toBeEnabled();
  await page.getByRole('button', { name: '开始推演' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '暂停推演' }).click();
  await aarButton.click();
  await expect(page.getByText(/AFTER ACTION REVIEW/)).toBeVisible();
  await expect(page.getByText('完整航迹账本')).toBeVisible();
});

test('scrubs a Recording v2 timeline to a legal Tick', async ({ page }) => {
  await page.getByRole('button', { name: '开始推演' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '暂停推演' }).click();
  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByRole('button', { name: '生成指令重放 JSON' }).click();
  const timeline = page.getByLabel('回放时间轴');
  await expect(timeline).toBeVisible();
  await timeline.fill('0');
  await page.getByRole('button', { name: '跳转至 Tick 0' }).click();
  await expect(page.getByRole('button', { name: '开始推演' })).toBeVisible();
});

test('toggles both command sidebars without remounting the workspace', async ({ page }) => {
  const orderPanel = page.locator('#order-panel');
  const inspectorPanel = page.locator('#inspector-panel');

  await expect(orderPanel).toBeVisible();
  await expect(inspectorPanel).toBeVisible();
  await page.getByRole('button', { name: '编制', exact: true }).click();
  await expect(orderPanel).toBeHidden();
  await page.getByRole('button', { name: '编制', exact: true }).click();
  await expect(orderPanel).toBeVisible();
  await page.getByRole('button', { name: '详情', exact: true }).click();
  await expect(inspectorPanel).toBeHidden();
});

test('starts, advances and pauses the simulation from the command header', async ({ page }) => {
  const seat = page.getByLabel('控制席位');
  await expect(seat).toBeEnabled();
  await page.getByRole('button', { name: '开始推演' }).click();
  await expect(page.getByRole('button', { name: '暂停推演' })).toBeVisible();
  await expect(seat).toBeDisabled({ timeout: 10_000 });
  await page.getByRole('button', { name: '暂停推演' }).click();
  await expect(page.getByRole('button', { name: '开始推演' })).toBeVisible();
});

test('runs interactive tutorial checklist and campaign progression controls', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('interactive_command_tutorial');
  await expect(page.getByLabel('新兵互动教学指引')).toBeVisible();
  await page.keyboard.press('F9');
  await expect(page.getByText('指挥官教学指引 (1/5)')).toBeVisible();

  await page.getByRole('button', { name: '战役模式' }).click();
  await expect(page.getByRole('button', { name: '战役 1/5' })).toBeVisible();
});

test('captures and restores a resumable battle save and named save slot in Scenario I/O modal', async ({ page }) => {
  await page.getByRole('button', { name: '+5秒' }).click();
  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByLabel('存档槽备注名称').fill('E2E 战术断点');
  await page.getByRole('button', { name: '新建断点存档槽' }).click();
  await expect(page.getByText('E2E 战术断点')).toBeVisible();
  await page.getByRole('button', { name: '生成断点存档 JSON' }).click();
  await expect(page.getByLabel('想定或重放 JSON')).toContainText('aegis_battle_save');
  await page.getByRole('button', { name: '读档' }).first().click();
  await expect(page.getByRole('button', { name: '开始推演' })).toBeVisible();
});

test('requires confirmation before mid-battle reset and launches live map replay player', async ({ page }) => {
  await page.getByRole('button', { name: '+5秒' }).click();
  await page.getByLabel('重置当前想定').click();
  await expect(page.getByRole('alertdialog', { name: '确认重置或切换想定' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByRole('button', { name: '生成指令重放 JSON' }).click();
  await page.getByRole('button', { name: '启动地图航迹回放播放器' }).click();
  await expect(page.getByLabel('地图航迹回放播放器')).toBeVisible();
  await page.getByRole('button', { name: '退出回放' }).click();
});

test('filters equipment catalog and triggers manual countermeasure from inspector', async ({ page }) => {
  await page.getByRole('button', { name: '装备库' }).click();
  await page.getByLabel('检索装备库').fill('055');
  await expect(page.getByRole('dialog').getByText(/055型/).first()).toBeVisible();
  await page.getByLabel('关闭装备库').click();

  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  await page.getByRole('button', { name: /箔条\(/ }).click();
  await expect(page.getByText(/已投放箔条干扰/)).toBeVisible();
});

test('loads sea-land-air amphibious and pure inland air-land scenarios and launches from airbase', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_joint_amphibious_assault_2027');
  await expect(page.getByLabel('选择战役想定')).toHaveValue('op_joint_amphibious_assault_2027');

  await page.getByLabel('选择战役想定').selectOption('op_inland_mountain_strike_2027');
  await expect(page.getByLabel('选择战役想定')).toHaveValue('op_inland_mountain_strike_2027');
  await page.locator('#order-panel').getByText('INLAND-AB-W', { exact: true }).click();
  await page.getByRole('button', { name: '弹射升空' }).first().click();
  await expect(page.locator('#inspector-panel').getByText(/基地歼-20A 航空兵大队 #1波次/)).toBeVisible();
});
