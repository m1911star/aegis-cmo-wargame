import { expect, test } from '@playwright/test';
import { SCENARIO_FOG_BAY_RELAY } from '../../src/scenarios/fogBayRelayScenario';
import { MASTER_EQUIPMENT_CATALOG } from '../../src/db';
import type { ScenarioDefinition } from '../../src/types/wargame';

test('opens Fog Bay Relay with seat-specific objectives and an offshore transport', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.abort());
  await page.goto('/');
  const scenarios = page.getByLabel('选择战役想定');
  await scenarios.selectOption('op_fog_bay_relay');
  await expect(scenarios.locator('option:checked')).toContainText('雾湾接力');

  const objectives = page.getByRole('region', { name: '任务目标' });
  await expect(objectives).toContainText('35:00');
  await expect(objectives).toContainText('终局控制陆上交接区');

  await page.locator('#order-panel').getByText('RELAY', { exact: true }).click();
  await expect(page.getByRole('button', { name: '抵滩卸载' })).toBeDisabled();

  await page.getByRole('button', { name: '简报', exact: true }).click();
  const briefing = page.getByRole('dialog');
  await expect(briefing).toContainText('舰艇和飞机可以支援，但不计入交接区控制');
  await briefing.getByRole('button', { name: '先查看地图部署' }).click();

  await objectives.getByRole('button', { name: /任务目标/ }).click();
  await expect(objectives).toContainText('己方力量未进驻 · 占控未确认');
  await page.getByLabel('控制席位').selectOption('BLUE');
  await expect(objectives).toContainText('终局守住陆上交接区');
  await expect(objectives).not.toContainText('终局控制陆上交接区');
  await expect(page.locator('#order-panel').getByText('RESERVE', { exact: true })).toBeVisible();
  await expect(objectives).toContainText('己方力量已进驻 · 占控未确认');
  await expect(objectives).not.toContainText('己方稳固控制');
  await page.getByRole('button', { name: '指挥模式', exact: true }).click();
  await expect(objectives).toContainText('己方稳固控制');
});

for (const hiddenOccupant of [false, true]) {
  test(`keeps live control unconfirmed ${hiddenOccupant ? 'with' : 'without'} an unseen unit in the zone`, async ({ page }) => {
    const source = SCENARIO_FOG_BAY_RELAY;
    const guard = source.units.find((unit) => unit.id === 'fog_blue_guard')!;
    const objective = source.objectives!.find((goal) => goal.id === 'fog_blue_handoff')!;
    const platform = { ...MASTER_EQUIPMENT_CATALOG.platforms.blue_armor_brigade,
      id: 'relay_test_marker', name: '演练地面标志', sensorIds: [], mounts: [] };
    const scenario: ScenarioDefinition = {
      ...source,
      id: 'relay_visibility_test',
      customCatalogOverlay: { platforms: { [platform.id]: platform } },
      units: [
        { ...guard, platformId: platform.id },
        ...(hiddenOccupant ? [{ ...guard, id: 'unseen_marker', side: 'RED' as const,
          parentGroupId: 'fog_red_sea', platformId: platform.id }] : []),
      ],
      missions: [],
      events: [],
      objectives: [{ ...objective, holdDurationSec: 5 }],
      victoryConditions: { ...source.victoryConditions!, durationSec: 10 },
    };
    await page.route('https://tiles.openfreemap.org/**', route => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: '想定管理', exact: true }).click();
    await page.getByRole('textbox', { name: '想定或重放 JSON' }).fill(JSON.stringify(scenario));
    await page.getByRole('button', { name: '校验并热加载此想定' }).click();
    await page.getByLabel('控制席位').selectOption('BLUE');

    const objectives = page.getByRole('region', { name: '任务目标' });
    await objectives.getByRole('button', { name: /任务目标/ }).click();
    await page.getByRole('button', { name: '+5秒' }).click();
    await expect(objectives).toContainText('己方力量已进驻 · 占控未确认');
    await expect(objectives).toContainText('任务目标 (0/1)');
    await expect(objectives.getByRole('progressbar')).toHaveCount(0);
    await expect(objectives).toContainText('需持续占控 5s');
    const log = page.getByRole('region', { name: '实时战报' });
    const logToggle = log.getByRole('button', { name: /实时战报/ });
    await expect(log).not.toContainText('目标达成：');

    await page.getByRole('button', { name: '指挥模式', exact: true }).click();
    await expect(objectives.getByRole('progressbar')).toHaveAttribute('aria-valuenow', hiddenOccupant ? '0' : '100');
    if (!hiddenOccupant) await expect(log).toContainText(`目标达成：${objective.title}`);
    await page.getByRole('button', { name: '沙盒模式', exact: true }).click();
    await page.getByRole('group', { name: '战场视角' }).getByRole('button', { name: '全局' }).click();
    await expect(objectives).toContainText(`待确认 · ${objective.title}`);
    await expect(objectives.getByRole('progressbar')).toHaveCount(0);
    await objectives.getByRole('button', { name: /任务目标/ }).click();
    await expect(objectives).toContainText('任务目标 (0/1)');
    await expect(objectives).toContainText(`待确认主要目标 · ${objective.title}`);
    await expect(logToggle).toHaveAccessibleName('实时战报 1');
    await logToggle.click();
    await expect(log).toContainText('战役想定已载入');
    await expect(log).not.toContainText('目标达成：');

    await page.getByRole('button', { name: '+5秒' }).click();
    const debrief = page.getByRole('dialog', { name: '战后结算与评估' });
    await expect(debrief).toContainText(hiddenOccupant ? '任务失利' : '战役/任务胜利');
    await expect(log).toContainText(`${hiddenOccupant ? '目标未达成' : '目标达成'}：${objective.title}`);
  });
}
