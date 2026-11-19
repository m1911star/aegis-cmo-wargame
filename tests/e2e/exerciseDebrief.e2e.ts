import { expect, test } from '@playwright/test';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';
import type { ScenarioDefinition } from '../../src/types/wargame';

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
});

test('explains a no-command exercise at its deadline and opens the full debrief only afterwards', async ({ page }) => {
  test.setTimeout(70_000);
  await expect(page.getByRole('button', { name: '战后复盘' })).toBeDisabled();
  await page.getByRole('button', { name: '60×', exact: true }).click();
  const evidence = page.getByRole('region', { name: '本局结算依据' });
  await expect(evidence).toContainText('15:00 · 演练时限结束', { timeout: 55_000 });
  await expect(evidence).toContainText('主要目标未达成');
  await expect(evidence).not.toContainText('目标达成记录');
  await page.getByRole('button', { name: '查看完整复盘 (AAR)' }).click();
  await expect(page.getByRole('dialog', { name: '战后复盘' })).toBeVisible();
});

test('displays the timestamp of a completed objective, not the later deadline', async ({ page }) => {
  const unitId = 'exercise_red_ship';
  const [x, y] = INFORMATION_EXERCISE.units.find(unit => unit.id === unitId)!.position;
  const fixture: ScenarioDefinition = {
    ...INFORMATION_EXERCISE,
    objectives: [{ id: 'check_in', title: '登记抵达', type: 'withdraw', side: 'RED', required: true, points: 10, unitIds: [unitId],
      withdrawAreaPolygon: [[x - .01, y - .01], [x + .01, y - .01], [x + .01, y + .01], [x - .01, y + .01]] }],
    victoryConditions: { ...INFORMATION_EXERCISE.victoryConditions!, durationSec: 5 },
  };
  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByLabel('想定或重放 JSON').fill(JSON.stringify(fixture));
  await page.getByRole('button', { name: '校验并热加载此想定' }).click();
  await page.getByRole('button', { name: '+5秒' }).click();
  const evidence = page.getByRole('region', { name: '本局结算依据' });
  await expect(evidence).toContainText('00:05 · 演练时限结束');
  await expect(evidence).toContainText('主要目标已达成 · 登记抵达');
  await expect(evidence).toContainText('00:00 · 目标达成记录');
});
