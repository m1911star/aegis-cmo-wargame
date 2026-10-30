import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AEGIS-CMO', { exact: true })).toBeVisible();
});

test('loads the command workspace and switches tactical scenarios', async ({ page }) => {
  const scenario = page.getByLabel('选择战役想定');
  await expect(scenario).toHaveValue('op_east_sea_thunder_2027');
  await scenario.selectOption('op_deep_sea_carrier_hunt_2028');
  await expect(scenario).toHaveValue('op_deep_sea_carrier_hunt_2028');
  await expect(scenario.locator('option:checked')).toContainText('深海猎杀');
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
