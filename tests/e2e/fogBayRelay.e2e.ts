import { expect, test } from '@playwright/test';

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

  await page.getByLabel('控制席位').selectOption('BLUE');
  await expect(objectives).toContainText('终局守住陆上交接区');
  await expect(objectives).not.toContainText('终局控制陆上交接区');
  await expect(page.locator('#order-panel').getByText('RESERVE', { exact: true })).toBeVisible();
});
