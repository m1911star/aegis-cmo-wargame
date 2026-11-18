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
  await page.keyboard.press('Alt+m');
  await expect(orderPanel).toBeHidden();
  await page.keyboard.press('Alt+m');
  await expect(orderPanel).toBeVisible();
  await expect(inspectorPanel).toBeVisible();
});

test('keeps the map open on a narrow screen and puts tools in a dismissible menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const header = page.locator('.command-header');
  expect((await header.boundingBox())!.height).toBeLessThan(160);
  expect((await page.locator('.workspace').boundingBox())!.height).toBeGreaterThan(600);
  await expect(page.locator('#order-panel')).toBeHidden();
  await expect(page.locator('#inspector-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: '开始推演' })).toBeInViewport();

  await page.keyboard.press('Tab');
  await expect(header.getByRole('button', { name: /有限信息演练/ })).toBeFocused();
  await page.keyboard.press('Tab');
  const more = page.getByText('更多工具', { exact: true });
  await expect(page.locator('summary').filter({ has: more })).toBeFocused();
  await page.keyboard.press('Enter');
  const manage = page.getByRole('button', { name: '想定管理' });
  await expect(manage).toBeVisible();
  await manage.click();
  const dialog = page.getByRole('dialog', { name: '想定管理' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '想定与回放 I/O' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '校验并热加载此想定' })).toBeFocused();
  await dialog.getByLabel('想定或重放 JSON').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('summary').filter({ has: more })).toBeFocused();

  await page.getByRole('button', { name: '编制', exact: true }).click();
  await expect(page.locator('#order-panel')).toBeVisible();
  await page.getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.locator('#order-panel')).toBeHidden();
  await expect(page.locator('#inspector-panel')).toBeVisible();
  await page.getByRole('button', { name: '纯地图' }).click();
  await expect(page.locator('#inspector-panel')).toBeHidden();
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

test('resumes a blue-side campaign checkpoint after reloading the browser', async ({ page }) => {
  await page.getByRole('button', { name: '战区态势' }).click();
  await page.getByRole('button', { name: '以蓝方开启战役' }).click();
  await expect(page.getByRole('button', { name: '战役 1/5' })).toBeVisible();
  await expect(page.getByLabel('控制席位')).toHaveValue('BLUE');
  await expect(page.getByLabel('控制席位')).toBeDisabled();
  await page.getByRole('button', { name: '+5秒' }).click();
  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByLabel('存档槽备注名称').fill('战役 E2E');
  await page.getByRole('button', { name: '新建断点存档槽' }).click();
  await expect(page.getByText('战役 E2E')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: '战役模式' })).toBeVisible();
  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByRole('button', { name: '读档' }).click();
  await expect(page.getByRole('button', { name: '战役 1/5' })).toBeVisible();
  await expect(page.getByLabel('控制席位')).toHaveValue('BLUE');
});

test('restores the latest automatic checkpoint across a reload', async ({ page }) => {
  await page.getByRole('button', { name: '+5秒' }).click();
  await page.getByLabel('重置当前想定').click();
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByLabel('选择战役想定').selectOption('interactive_command_tutorial');
  await page.getByRole('button', { name: '确认执行' }).click();
  await expect(page.getByRole('button', { name: '恢复自动存档' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '恢复自动存档' }).click();
  await expect(page.getByText(/^种子 \d+ · Tick 20$/)).toBeAttached();
});

test('requires confirmation before mid-battle reset and launches live map replay player', async ({ page }) => {
  await page.getByRole('button', { name: '+5秒' }).click();
  await page.getByLabel('重置当前想定').click();
  await expect(page.getByRole('alertdialog', { name: '确认重置或切换想定' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByRole('button', { name: '生成指令重放 JSON' }).click();
  const autosaveBefore = await page.evaluate(() => localStorage.getItem('aegis_cmo_autosave_v1'));
  await page.getByLabel('回放时间轴').fill('0');
  await page.getByRole('button', { name: '启动地图航迹回放播放器' }).click();
  const player = page.getByLabel('地图航迹回放播放器');
  await expect(player).toContainText('Tick 0/20');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 2000));
  await player.getByRole('button', { name: '1×', exact: true }).press('Enter');
  await player.getByRole('button', { name: '播放回放' }).press('Enter');
  await page.clock.runFor(1000);
  await expect(player).toContainText('Tick 4/20');
  await player.getByRole('button', { name: '暂停回放' }).press('Enter');
  await page.clock.runFor(1000);
  await expect(player).toContainText('Tick 4/20');
  await expect(player.getByText('已暂停')).toBeVisible();
  await expect(page.getByRole('button', { name: '开始推演' })).toHaveCount(0);
  await player.getByRole('button', { name: '+5s' }).press('Enter');
  await expect(player.getByText('已到末尾')).toBeVisible();
  await player.getByRole('button', { name: '重新播放' }).press('Enter');
  await expect(player).toContainText('Tick 0/20');
  await player.getByRole('button', { name: '退出回放' }).press('Enter');
  await expect(page.getByText(/^种子 \d+ · Tick 20$/)).toBeAttached();
  expect(await page.evaluate(() => localStorage.getItem('aegis_cmo_autosave_v1'))).toBe(autosaveBefore);
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
  await expect(page.getByText(/阴云层 · 4级海况/)).toBeVisible();

  await page.getByLabel('选择战役想定').selectOption('op_inland_mountain_strike_2027');
  await expect(page.getByLabel('选择战役想定')).toHaveValue('op_inland_mountain_strike_2027');
  await page.locator('#order-panel').getByText('INLAND-AB-W', { exact: true }).click();
  await page.getByRole('button', { name: '弹射升空' }).first().click();
  await expect(page.locator('#inspector-panel').getByText(/基地歼-20A 航空兵大队 #1波次/)).toBeVisible();
});

test('displays v3 guidance channels, submarine baffle-clearing switch, and airborne ASW sonobuoy drop', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  await expect(page.locator('#inspector-panel').getByText('火控/制导通道占用')).toBeVisible();

  // Select submarine in ORBAT and toggle periodic baffle-clearing
  await page.locator('#order-panel').getByText('SSK-039C-1', { exact: true }).click();
  const baffleSwitch = page.getByLabel('定期转向清声呐盲区');
  await expect(baffleSwitch).toBeVisible();
  await baffleSwitch.click();
  await expect(baffleSwitch).toHaveAttribute('aria-checked', 'true');

  // Launch Z-20F ASW helicopter from 054B frigate and drop DIFAR sonobuoy into water
  await page.locator('#order-panel').getByText('PLANS-FFG01', { exact: true }).click();
  await page.getByRole('button', { name: '弹射升空' }).click();
  await expect(page.locator('#inspector-panel').getByText('航空声呐浮标舱 (Sonobuoys)')).toBeVisible();
  await page.getByRole('button', { name: '投掷入水' }).first().click();
  await expect(page.locator('#inspector-panel').getByText(/BUOY-/)).toBeVisible();
});

test('browses force packages in catalog and deploys a force package on the map in sandbox builder', async ({ page }) => {
  await page.getByRole('button', { name: '装备库' }).click();
  await page.getByRole('button', { name: /军队配置 \(/ }).click();
  await expect(page.getByRole('dialog').getByText('红方水面护航分队')).toBeVisible();
  await page.getByLabel('关闭装备库').click();

  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');
  await page.getByRole('button', { name: '指挥模式' }).click();
  await page.getByRole('button', { name: '想定编辑' }).click();
  await page.getByLabel('部署军队配置').selectOption('red_surface_group');
  await page.getByRole('button', { name: '选择后点击地图部署' }).click();
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await expect(page.getByText(/军队配置已部署：红方水面护航分队/)).toBeVisible();
});

test('generates and launches a custom skirmish battle from theater and force package presets', async ({ page }) => {
  await page.getByRole('button', { name: '遭遇战' }).click();
  await expect(page.getByText('QUICK SKIRMISH // 自由遭遇战生成器')).toBeVisible();
  await page.getByLabel('作战战区模板').selectOption('coastal_strait');
  await page.getByLabel('红方主力军队配置').selectOption('india_air_patrol');
  await page.getByLabel('蓝方主力军队配置').selectOption('japan_maritime_task_group');
  await page.getByRole('button', { name: '生成遭遇战并开局' }).click();
  await expect(page.getByText(/战役想定已载入: 自由遭遇战 \/\/ 海峡浅海封锁区/)).toBeVisible();
});

test('toggles 3D terrain extrusion, drags independent 3D air-sea viewport, and renders 3D replay in AAR', async ({ page }) => {
  await page.getByLabel('选择战役想定').selectOption('op_east_sea_thunder_2027');

  // 1. Toggle 3D terrain extrusion in MapLayersTab
  await page.getByRole('button', { name: '图层' }).click();
  const terrain3dSwitch = page.getByLabel('立体山脊遮蔽 (3D Pitch)');
  await expect(terrain3dSwitch).toBeVisible();
  await terrain3dSwitch.click();
  await expect(terrain3dSwitch).toHaveAttribute('aria-checked', 'true');

  // 2. Open independent 3D Air-Sea Viewport from Inspector or Header and drag it
  const inspectorBoxBtn = page.locator('#inspector-panel').getByRole('button', { name: /打开独立 3D 空海剖面视窗/ });
  await expect(inspectorBoxBtn).toBeVisible();
  await inspectorBoxBtn.click();

  const floatingWin = page.locator('#tacview-3d-floating-window');
  await expect(floatingWin).toBeVisible();
  await expect(floatingWin.getByText(/3D 空海剖面 \/\/ DRAGON-01/)).toBeVisible();
  await expect(floatingWin.locator('canvas')).toBeVisible();

  const beforeBox = await floatingWin.boundingBox();
  expect(beforeBox).not.toBeNull();
  await page.mouse.move(beforeBox!.x + 80, beforeBox!.y + 14);
  await page.mouse.down();
  await page.mouse.move(beforeBox!.x - 90, beforeBox!.y - 60, { steps: 5 });
  await page.mouse.up();
  const afterBox = await floatingWin.boundingBox();
  expect(afterBox).not.toBeNull();
  expect(afterBox!.x).toBeLessThan(beforeBox!.x - 40);
  expect(afterBox!.y).toBeLessThan(beforeBox!.y - 30);

  await floatingWin.getByTitle('放大 3D 视窗').click();
  await expect(floatingWin.getByTitle('恢复标准视窗')).toBeVisible();
  await floatingWin.getByLabel('关闭 3D 视窗').click();
  await expect(floatingWin).toHaveCount(0);

  // 3. Open AAR modal in sandbox mode and verify 3D replay section
  await page.getByRole('button', { name: '指挥模式' }).click();
  await page.getByRole('button', { name: '战后复盘' }).click();
  await expect(page.getByText('3D 交战轨迹复盘')).toBeVisible();
  await page.getByRole('button', { name: '展开 3D 交战轨迹' }).click();
  await expect(page.getByLabel('3D 复盘时间轴')).toBeVisible();
});
