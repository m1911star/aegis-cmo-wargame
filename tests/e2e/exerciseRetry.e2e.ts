import { expect, test } from '@playwright/test';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';

test('restarts the same blue exercise from its result, without replacing the random restart', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: '想定管理' }).click();
  const exercise = { ...INFORMATION_EXERCISE, victoryConditions: { ...INFORMATION_EXERCISE.victoryConditions!, durationSec: 5 } };
  await page.getByLabel('想定或重放 JSON').fill(JSON.stringify(exercise));
  await page.getByRole('button', { name: '校验并热加载此想定' }).click();
  const seat = page.getByLabel('控制席位');
  await seat.selectOption('BLUE');
  const step = page.getByRole('button', { name: '+5秒' });
  const opening = await page.getByText(/^种子 \d+ · Tick 0$/).textContent();
  expect(opening).toBeTruthy();
  await step.click();
  const result = page.getByRole('dialog', { name: '战后结算与评估' });
  await expect(result.getByRole('button', { name: '随机种子再来一局' })).toBeVisible();
  await result.getByRole('button', { name: '同条件再试' }).click();
  await expect(result).toBeHidden();
  await expect(page.getByText(opening!, { exact: true })).toBeAttached();
  await expect(seat).toHaveValue('BLUE');
  await expect(page.getByRole('region', { name: '演练开局' })).toContainText('蓝方主要目标');
  await expect(page.getByRole('button', { name: '开始推演', exact: true })).toBeEnabled();
  await step.click();
  await expect(result.getByRole('button', { name: '同条件再试' })).toBeVisible();
});
