import { expect, test } from '@playwright/test';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: '想定管理' }).click();
  const exercise = { ...INFORMATION_EXERCISE, victoryConditions: { ...INFORMATION_EXERCISE.victoryConditions!, durationSec: 5 } };
  await page.getByLabel('想定或重放 JSON').fill(JSON.stringify(exercise));
  await page.getByRole('button', { name: '校验并热加载此想定' }).click();
  await page.getByLabel('控制席位').selectOption('BLUE');
});

test('restarts the same blue exercise from its result, without replacing the random restart', async ({ page }) => {
  const seat = page.getByLabel('控制席位');
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

test('shows the blue opening instead of the inspector after a narrow-screen retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('更多工具', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+5秒' }).click();
  await page.getByRole('dialog', { name: '战后结算与评估' }).getByRole('button', { name: '同条件再试' }).click();
  const card = page.getByRole('region', { name: '演练开局' });
  await expect(card.getByText('蓝方主要目标', { exact: true })).toBeInViewport();
  await expect(page.locator('#inspector-panel')).toBeHidden();
  await expect(page.locator('#order-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: '开始推演', exact: true })).toBeEnabled();
  await card.getByRole('button', { name: /查看接触/ }).click();
  await expect(page.getByRole('region', { name: '详情' })).toBeFocused();
});

test('returns from full review to the result that opened it, not to an already dismissed result', async ({ page }) => {
  await page.getByRole('button', { name: '+5秒' }).click();
  const result = page.getByRole('dialog', { name: '战后结算与评估' });
  const review = page.getByRole('dialog', { name: '战后复盘' });
  await result.getByRole('button', { name: /查看完整复盘/ }).click();
  await expect(review).toBeVisible();
  await expect(result).toBeHidden();
  await review.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(result.getByRole('button', { name: '同条件再试' })).toBeVisible();
  await result.getByRole('button', { name: /查看完整复盘/ }).click();
  await expect(review).toBeFocused();
  await page.keyboard.press('Escape');
  await result.getByRole('button', { name: '同条件再试' }).click();
  await expect(page.getByLabel('控制席位')).toHaveValue('BLUE');
  await expect(page.getByRole('region', { name: '演练开局' })).toBeVisible();

  await page.getByRole('button', { name: '+5秒' }).click();
  await result.getByRole('button', { name: '关闭终局结算' }).click();
  await page.getByRole('button', { name: '战后复盘', exact: true }).click();
  await review.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(result).toBeHidden();
});
