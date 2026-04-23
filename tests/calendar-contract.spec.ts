import { test, expect } from '@playwright/test'

test.describe('Workspace calendar DOM contract', () => {
  test('app shell loads', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toBeVisible()
  })

  test('when calendar panel is visible, Schedule-X time grid exposes data-time-grid-date', async ({ page }) => {
    await page.goto('/')
    const n = await page.getByTestId('workspace-calendar-panel').count()
    test.skip(n === 0, 'Open a database Calendar view to exercise this assertion')
    const panel = page.getByTestId('workspace-calendar-panel')
    const wrapper = panel.locator('.sx-react-calendar-wrapper')
    await expect(wrapper).toBeVisible({ timeout: 15000 })
    const firstCell = wrapper.locator('[data-time-grid-date]').first()
    await expect(firstCell).toBeVisible({ timeout: 10000 })
    const raw = await firstCell.getAttribute('data-time-grid-date')
    expect(raw).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
