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

test('marca y valida una factura de proveedor no habitual sin crear un proveedor permanente', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await page.getByRole('button', { name: /factura-demo-revision\.pdf/ }).click();
  const supplierAssociation = page.locator('.supplier-association');
  const frequency = supplierAssociation.getByLabel('Marcar como proveedor no habitual');
  await expect(frequency).toBeVisible();
  await expect(supplierAssociation.getByRole('button', { name: 'Crear proveedor desde este PDF' })).toBeVisible();
  await frequency.check();
  await expect(page.getByLabel('Nombre del proveedor en la factura')).toHaveValue('Proveedor Nuevo Demo SL');
  await page.getByRole('button', { name: 'Factura de gasto', exact: true }).click();
  await expect(page.getByText(/Factura de gasto · Proveedor no habitual/)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar decisión' }).click();
  await expect(page.getByRole('button', { name: 'Aprobar documento' })).toBeVisible();
});

test('muestra la mesa operativa y navega por el flujo documental', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Qué necesita atención hoy' })).toBeVisible();
  await expect(page.getByText('Fuentes conectadas y preparadas')).toBeVisible();
  await page.getByRole('button', { name: /Procesamiento|Procesar/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Analizar y aprobar un lote' })).toBeVisible();
  await expect(page.getByLabel('Desde')).toHaveValue('2026-01-01');
  await expect(page.getByText('Siguiente fecha de búsqueda: 01 ago 2026')).toBeVisible();
  await expect(page.getByText('factura-demo-lista.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir detalle' }).first().click();
  await expect(page.getByRole('heading', { name: 'Revisión manual' })).toBeVisible();
  await expect(page.getByText('factura-demo-lista.pdf').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previsualizar PDF' })).toBeVisible();
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

test('reconoce automáticamente el CSV de CaixaBank con moneda integrada', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Conciliación' }).last().click();
  } else await page.getByRole('button', { name: 'Conciliación' }).first().click();
  await expect(page.getByText('CaixaBank CSV').first()).toBeVisible();
  await page.getByLabel('Archivo').setInputFiles({ name: 'CaixaBank_sintetico.csv', mimeType: 'text/csv', buffer: Buffer.from('Concepto;Fecha;Importe;Saldo\nFACTURA DEMO;20/07/2026;-12,34EUR;-100,00EUR') });
  await page.getByLabel('Cuenta o fuente').fill('CaixaBank');
  await page.getByRole('button', { name: 'Previsualizar' }).click();
  await expect(page.getByText('58 movimientos')).toBeVisible();
  await expect(page.getByText('Formato aplicado: CaixaBank CSV')).toBeVisible();
});

test('permite guardar y reutilizar un mapeo manual de CSV', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Conciliación' }).last().click();
  } else await page.getByRole('button', { name: 'Conciliación' }).first().click();
  await page.getByLabel('Archivo').setInputFiles({ name: 'cuenta-personalizada.csv', mimeType: 'text/csv', buffer: Buffer.from('Concepto;Fecha;Importe;Saldo\nPAGO DEMO;20/07/2026;-12,34EUR;-100,00EUR') });
  await page.getByLabel('Cuenta o fuente').fill('Cuenta personalizada');
  await page.getByRole('button', { name: 'Mapear manualmente' }).click();
  await expect(page.getByText('Mapear formato bancario')).toBeVisible();
  await expect(page.getByLabel('Origen de la moneda *')).toHaveValue('EMBEDDED');
  await expect(page.getByLabel('Nombre del perfil *')).toHaveValue('Cuenta personalizada CSV');
  await page.getByRole('button', { name: 'Aplicar mapeo' }).click();
  await expect(page.getByText('Formato aplicado: Cuenta personalizada CSV')).toBeVisible();
  await expect(page.getByText('Cuenta personalizada CSV').first()).toBeVisible();
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

test('conserva borradores al navegar y recargar y permite guardarlos juntos', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await page.getByRole('button', { name: /factura-demo-revision\.pdf/ }).click();
  await page.getByLabel('Número de factura').fill('DRAFT-2026-01');
  await expect(page.getByRole('button', { name: 'Guardar todas (1)' })).toBeVisible();
  await page.getByRole('button', { name: /factura-demo-lista\.pdf/ }).click();
  await page.reload();
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await page.getByRole('button', { name: /factura-demo-revision\.pdf/ }).click();
  await expect(page.getByLabel('Número de factura')).toHaveValue('DRAFT-2026-01');
  await page.getByRole('button', { name: 'Guardar todas (1)' }).click();
  await expect(page.getByText(/1 guardadas/)).toBeVisible();
});

test('muestra fiscalidad, categorías y cierre mensual sin ocultar la cobertura', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Cierre mensual' }).last().click();
  } else await page.getByRole('button', { name: 'Cierre mensual' }).first().click();
  await page.getByLabel('Periodo').fill('2026-07');
  await page.getByRole('button', { name: 'Calcular cierre' }).click();
  await expect(page.getByText('Facturas procesadas')).toBeVisible();
  await expect(page.getByText(/Cobertura:/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Categorías de gasto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preparar entrega a gestoría' })).toBeVisible();
});

test('confirma y deshace una asignación desde la matriz avanzada', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Conciliación' }).last().click();
  } else await page.getByRole('button', { name: 'Conciliación' }).first().click();
  await expect(page.getByRole('heading', { name: 'Asignar pagos y facturas' })).toBeVisible();
  await page.getByLabel('Movimiento').selectOption({ index: 1 });
  await page.getByLabel('Factura').selectOption({ index: 1 });
  await expect(page.getByText('DIFERENCIA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar relación' }).click();
  await expect(page.getByText('Relación confirmada y saldos recalculados.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeVisible();
});

test('organiza la semana en cuatro pasos y separa la cobertura de Gmail y bancos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Qué necesita atención hoy' })).toBeVisible();
  const workflow = page.getByRole('navigation', { name: 'Flujo semanal' });
  await expect(workflow.getByRole('button', { name: /Capturar/ })).toBeVisible();
  await expect(workflow.getByRole('button', { name: /Validar/ })).toBeVisible();
  await expect(workflow.getByRole('button', { name: /Conciliar/ })).toBeVisible();
  await expect(workflow.getByRole('button', { name: /Cerrar/ })).toBeVisible();
  await expect(page.getByText('Siguiente acción recomendada')).toBeVisible();
  await expect(page.getByRole('button', { name: /Correos sin analizar/ })).toBeVisible();
  const coverage = page.locator('.coverage-panel');
  await expect(coverage.getByText('Gmail', { exact: true })).toBeVisible();
  await expect(coverage.getByText('CaixaBank', { exact: true })).toBeVisible();
  await expect(coverage.getByText('Santander', { exact: true })).toBeVisible();
  await expect(coverage.getByRole('button', { name: /Gmail: CON HUECOS/ })).toBeVisible();
  await expect(coverage.getByRole('button', { name: /Gmail: COMPLETA/ })).toBeVisible();
  const resume = page.getByRole('button', { name: /Continuar Gmail desde 10 feb 2026/ });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(page.getByLabel('Desde')).toHaveValue('2026-02-10');
  await expect(page.getByText(/El formulario usa este cursor para evitar volver a enero/)).toBeVisible();
});

test('guarda una revisión y abre el siguiente documento', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await page.getByRole('button', { name: /factura-demo-revision\.pdf/ }).click();
  await page.getByLabel('Número de factura').fill('DEMO-SIGUIENTE-01');
  await page.getByRole('button', { name: 'Guardar y abrir siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'factura-demo-lista.pdf' })).toBeVisible();
  await expect(page.getByText(/1 guardadas/)).toBeVisible();
});

test('permite seleccionar y aprobar documentos listos como conjunto', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Revisión/ }).first().click();
  await page.getByLabel('Seleccionar factura-demo-lista.pdf para aprobar').check();
  await page.getByRole('button', { name: 'Aprobar seleccionadas (1)' }).click();
  const approvalDialog = page.getByRole('dialog', { name: 'Confirmar aprobación conjunta' });
  await expect(approvalDialog.getByText(/A.2 - FA-GASTOS/)).toBeVisible();
  await approvalDialog.getByRole('button', { name: 'Aprobar 1 documentos' }).click();
  await expect(page.getByText('1 documentos aprobados.')).toBeVisible();
  await expect(page.getByLabel('Seleccionar factura-demo-lista.pdf para aprobar')).toHaveCount(0);
});

test('decide propuestas inequívocas desde la bandeja visual de conciliación', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Conciliación' }).last().click();
  } else await page.getByRole('button', { name: 'Conciliación' }).first().click();
  await expect(page.getByRole('heading', { name: 'Bandeja de propuestas' })).toBeVisible();
  await page.getByLabel('Seleccionar todas las propuestas inequívocas').check();
  await page.getByRole('button', { name: 'Confirmar seleccionadas (2)' }).click();
  await expect(page.getByText('2 decisiones guardadas.')).toBeVisible();
  await page.getByRole('tab', { name: /Casos complejos/ }).click();
  await expect(page.getByText('SIN COINCIDENCIA EN ESTA COBERTURA').first()).toBeVisible();
  await expect(page.getByText(/impagada/i)).toHaveCount(0);
});

test('consulta reglas y confirma una frecuencia de proveedor sin automatizar decisiones', async ({ page }) => {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1200) < 860) {
    await page.getByRole('button', { name: /Más/ }).click();
    await page.getByRole('button', { name: 'Proveedores' }).last().click();
  } else await page.getByRole('button', { name: 'Proveedores' }).first().click();
  const supplier = page.locator('.supplier-grid article').filter({ hasText: 'Componentes Demo Europa BV' });
  await supplier.getByRole('button', { name: 'Reglas y frecuencia' }).click();
  const dialog = page.getByRole('dialog', { name: /Reglas y frecuencia · Componentes Demo Europa BV/ });
  await expect(dialog.getByText('CONCEPTO BANCARIO', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/nunca crean proveedores, aprueban ni concilian/)).toBeVisible();
  await dialog.getByLabel('Frecuencia', { exact: true }).selectOption('MONTHLY');
  await dialog.getByLabel('Evidencia de frecuencia').fill('Confirmada manualmente por el histórico sintético de cinco facturas.');
  await dialog.getByRole('button', { name: 'Guardar frecuencia' }).click();
  await expect(dialog.getByText(/La agenda hará sugerencias/)).toBeVisible();
});
