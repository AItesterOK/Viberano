import { expect, test } from '@playwright/test';

test('alinea los estados conectados dentro del diagnóstico de fuentes', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Configuración' }).last().click();
  } else {
    await page.getByRole('button', { name: 'Configuración' }).first().click();
  }
  const service = page.locator('.service-grid > div').first();
  const status = service.locator('.status');
  await expect(status).toBeVisible();
  const geometry = await status.evaluate((element) => {
    const statusBox = element.getBoundingClientRect();
    const serviceBox = element.parentElement!.getBoundingClientRect();
    return { alignItems: getComputedStyle(element).alignItems, width: statusBox.width, inside: statusBox.right <= serviceBox.right && statusBox.left >= serviceBox.left };
  });
  expect(geometry.alignItems).toBe('center');
  expect(geometry.width).toBeGreaterThan(60);
  expect(geometry.inside).toBe(true);
});

test('previsualiza el PDF de una factura con campos sin reconocer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisi/ }).first().click();
  await page.getByRole('button', { name: /factura-demo-revision\.pdf/ }).click();
  await page.getByRole('button', { name: 'Previsualizar PDF' }).click();
  const dialog = page.getByRole('dialog', { name: /Vista previa · factura-demo-revision\.pdf/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTitle('PDF factura-demo-revision.pdf')).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Abrir en otra pesta/ })).toBeVisible();
});

test('muestra la mesa operativa y navega por el flujo documental', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Qué necesita atención hoy' })).toBeVisible();
  await expect(page.getByText('Fuentes conectadas y preparadas')).toBeVisible();
  await page.getByRole('button', { name: /Procesamiento|Procesar/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Analizar y aprobar un lote' })).toBeVisible();
  await expect(page.getByLabel('Desde')).toHaveValue('2026-07-18');
  await expect(page.getByText('Siguiente fecha de búsqueda: 01 ago 2026')).toBeVisible();
  await expect(page.getByText('factura-demo-lista.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir detalle' }).first().click();
  await expect(page.getByRole('heading', { name: 'Revisión manual' })).toBeVisible();
  await expect(page.getByText('factura-demo-lista.pdf').first()).toBeVisible();
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

test('crea y asocia un proveedor desde el documento sin aprobar la factura', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await page.getByRole('button', { name: /factura-demo-revision\.pdf/ }).click();
  await page.getByRole('button', { name: 'Crear proveedor desde este PDF' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear proveedor desde este documento' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Nombre canónico')).toHaveValue('Proveedor Nuevo Demo SL');
  await expect(dialog.getByLabel('Dominio confirmado')).toHaveValue('proveedor-demo.invalid');
  await dialog.getByLabel('CIF / NIF').fill('B00000999');
  await dialog.getByText('He comprobado los datos').click();
  await dialog.getByRole('button', { name: 'Crear y asociar' }).click();
  await expect(page.getByRole('dialog', { name: 'Crear proveedor desde este documento' })).toBeHidden();
  await expect(page.getByLabel('Proveedor', { exact: true })).toHaveValue(/sup-/);
  await expect(page.getByRole('button', { name: 'Aprobar documento' })).toBeHidden();
});

test('mantiene y resuelve una excepción aunque el lote pueda cerrarse', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await page.getByLabel('Proveedor', { exact: true }).selectOption('sup-europa');
  const expenseDecision = page.getByRole('button', { name: 'Factura de gasto', exact: true });
  await expenseDecision.click();
  await expect(expenseDecision).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Decisión preparada:')).toBeVisible();
  await expect(page.getByText(/Factura de gasto\. Se aplicará al guardar\./)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar decisión' }).click();
  await expect(page.getByRole('button', { name: 'Aprobar documento' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar documento' }).click();
  await expect(page.getByText('factura-demo-revision.pdf')).toHaveCount(0);
  await expect(page.getByText('factura-demo-lista.pdf').first()).toBeVisible();
});

test('prepara una nota de crédito con importe negativo antes de guardarla', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  const amount = page.getByLabel('Total con impuestos');
  const creditDecision = page.getByRole('button', { name: 'Nota de crédito', exact: true });
  await creditDecision.click();
  await expect(creditDecision).toHaveAttribute('aria-pressed', 'true');
  await expect(amount).toHaveValue('-88.42');
  await expect(page.getByText(/Nota de crédito\. Se aplicará al guardar\./)).toBeVisible();
});

test('fusiona proveedores de forma reversible sin borrar el histórico', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Proveedores' }).last().click();
  } else {
    await page.getByRole('button', { name: 'Proveedores' }).first().click();
  }
  await page.getByRole('button', { name: 'Fusionar' }).click();
  await page.getByLabel('Proveedor de origen').selectOption('sup-logistica');
  await page.getByLabel('Proveedor de destino').selectOption('sup-europa');
  await page.getByLabel('Motivo y evidencia').fill('Duplicado confirmado en el escenario sintético');
  await page.getByRole('button', { name: 'Confirmar fusión' }).click();
  await expect(page.getByRole('dialog', { name: 'Fusionar proveedores' })).toHaveCount(0);
  await expect(page.getByText(/También:.*Logística Demo SL/)).toBeVisible();
});

test('no activa producción sin una confirmación separada', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Configuración' }).last().click();
  } else {
    await page.getByRole('button', { name: 'Configuración' }).first().click();
  }
  await expect(page.getByRole('button', { name: 'Crear copia y actualizar estructura' })).toBeVisible();
  await page.getByLabel('Modo').selectOption('PRODUCTION');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Confirma de forma explícita la activación de producción.')).toBeVisible();
  await page.getByText('Confirmo que el piloto en modo seco ha sido revisado y autorizo escrituras definitivas').click();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('button', { name: 'Guardado' })).toBeVisible();
});

test('cancela un lote sin presentar una acción de escritura', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Procesamiento|Procesar/ }).first().click();
  await page.getByRole('button', { name: 'Cancelar lote sin escrituras' }).click();
  await expect(page.getByRole('dialog', { name: 'Cancelar lote' })).toBeVisible();
  await page.getByLabel('Motivo obligatorio').fill('El lote contiene correo saliente de ventas');
  await page.getByRole('button', { name: 'Cancelar sin escrituras' }).click();
  await expect(page.getByText('CANCELADO').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar análisis' })).toBeEnabled();
});
