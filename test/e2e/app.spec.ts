import { expect, test } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Factura de gasto' }).click();
  await page.getByRole('button', { name: 'Guardar y reevaluar' }).click();
  await expect(page.getByRole('button', { name: 'Aprobar documento' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar documento' }).click();
  await expect(page.getByText('factura-demo-revision.pdf')).toHaveCount(0);
  await expect(page.getByText('factura-demo-lista.pdf').first()).toBeVisible();
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
