import { expect, test } from '@playwright/test';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';
import type { ScenarioDefinition } from '../../src/types/wargame';

const shortObservation: ScenarioDefinition = {
  ...INFORMATION_EXERCISE,
  units: INFORMATION_EXERCISE.units.map(unit => unit.id === 'exercise_red_scout'
    ? { ...unit, doctrine: { ...unit.doctrine, emconRadar: true } }
    : unit),
  victoryConditions: { ...INFORMATION_EXERCISE.victoryConditions!, durationSec: 10 },
};

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.abort());
});

test('schedules next to objectives, reassigns after a wait, and replays the precise report tick', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('region', { name: '演练任务', exact: true });
  await expect(page.getByRole('region', { name: '演练开局' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '安排任务' })).toBeInViewport();
  await page.getByRole('button', { name: '想定管理' }).click();
  await page.getByLabel('想定或重放 JSON').fill(JSON.stringify(shortObservation));
  await page.getByRole('button', { name: '校验并热加载此想定' }).click();

  await panel.getByRole('button', { name: '安排任务' }).click();
  await panel.getByLabel('指定单位').selectOption({ label: 'RED-ONE' });
  await panel.getByLabel('开始（秒）').fill('1');
  await panel.getByLabel('结束（秒）').fill('8');
  await panel.getByRole('button', { name: '确认排程' }).click();
  await expect(panel).toContainText('已排程');
  await expect(panel).toContainText('等待任务窗口开启');

  const step = page.getByRole('button', { name: '+5秒' });
  await step.click();
  await expect(panel).toContainText('等待指定单位的新报告');
  await panel.getByLabel('改派观察单位').selectOption({ label: 'RED-EYE' });
  await panel.getByRole('button', { name: '改派', exact: true }).click();
  await expect(panel).toContainText('已改派至 RED-EYE');
  await expect(panel).toContainText('00:01.00 至 00:08.00');
  await step.click();

  const result = page.getByRole('dialog', { name: '战后结算与评估' });
  await expect(result.getByRole('region', { name: '本局结算依据' })).toContainText('主要目标已达成');
  const taskRecord = result.getByRole('region', { name: '演练任务记录' });
  await expect(taskRecord).toContainText('登记标志船报告 · RED-EYE');
  await expect(taskRecord).toContainText('00:05.25 · 指定单位提交了本方的新接触报告');
  await taskRecord.getByRole('button', { name: '回放任务记录' }).click();
  await expect(page.getByRole('region', { name: '地图航迹回放播放器' })).toContainText('Tick 21/40');
  await expect(panel).toContainText('已完成');
  await expect(panel).toContainText('回放只读');
  const timeline = page.getByRole('slider', { name: '回放播放器时间轴' });
  await timeline.press('ArrowLeft');
  await expect(timeline).toHaveValue('20');
  await expect(panel).toContainText('进行中');
  await expect(panel.getByRole('button', { name: '暂停任务' })).toBeDisabled();
});

test('opens the compact inspector even if the assigned observer is already selected', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '编制', exact: true }).click();
  const panel = page.getByRole('region', { name: '演练任务', exact: true });
  const inspector = page.getByRole('region', { name: '详情' });
  await panel.getByRole('button', { name: '安排任务' }).click();
  await panel.getByLabel('指定单位').selectOption({ label: 'RED-ONE' });
  await panel.getByRole('button', { name: '确认排程' }).click();
  await expect(inspector).toBeHidden();
  await panel.getByRole('button', { name: '查看单位' }).click();
  await expect(inspector).toBeFocused();
  await expect(inspector).toContainText('RED-ONE');
});

test('finds the optional Blue task through 编制 at 390 px and issues an explicit replace-route order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const tools = page.getByText('更多工具', { exact: true });
  await tools.click();
  await page.getByRole('button', { name: '指挥红方', exact: true }).click();
  await page.getByRole('option', { name: '指挥蓝方' }).click();
  await tools.press('Escape');
  await page.getByRole('button', { name: '编制', exact: true }).click();
  const panel = page.getByRole('region', { name: '演练任务', exact: true });
  await expect(panel.getByRole('button', { name: '安排任务' })).toBeInViewport();
  await panel.getByRole('button', { name: '安排任务' }).click();
  await expect(panel.getByLabel('指定单位')).toHaveValue('exercise_blue_target');
  await panel.getByRole('button', { name: '确认排程' }).click();
  await expect(panel).toContainText('将替换标志船现有航点');
  await panel.getByRole('button', { name: '规划交接航线' }).click();
  await expect(page.getByText('BLUE-TARGET 机动航路点已更新', { exact: true })).toBeAttached();
  await panel.getByRole('button', { name: '暂停任务' }).click();
  await expect(panel).toContainText('单位继续活动，已下达航线不变');
  await expect(panel.getByRole('button', { name: '规划交接航线' })).toHaveCount(0);
});
