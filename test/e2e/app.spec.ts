import { expect, test } from '@playwright/test';

test('muestra la mesa operativa y navega por el flujo documental', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Qué necesita atención hoy' })).toBeVisible();
  await expect(page.getByText('Fuentes conectadas y preparadas')).toBeVisible();
  await page.getByRole('button', { name: /Procesamiento|Procesar/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Analizar y aprobar un lote' })).toBeVisible();
  await expect(page.getByText('factura-demo-lista.pdf')).toBeVisible();
});

test('expone revisión humana, proveedores y conciliación sin declarar impagos', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Revisión manual' })).toBeVisible();
  await expect(page.getByText('Proveedor Nuevo Demo SL').first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Conciliación' }).last().click();
  } else {
    await page.getByRole('button', { name: 'Conciliación' }).first().click();
  }
  await expect(page.getByRole('heading', { name: 'Conciliación bancaria' })).toBeVisible();
  await expect(page.getByText('CANDIDATA PENDIENTE').first()).toBeVisible();
  await expect(page.getByText(/impagada/i)).toHaveCount(0);
});
