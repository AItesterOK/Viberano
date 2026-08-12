# Arquitectura

## Límites de confianza

```text
Navegador autorizado
  └─ google.script.run
      └─ Apps Script ejecutado como compras@reparapro.com
          ├─ Gmail API v1 · solo lectura
          ├─ Drive API v3 · OCR, archivo y extractos
          └─ ReparaPRO Docs · registro canónico
```

El navegador no envía identidades fiables. Cada función obtiene `Session.getActiveUser()` y `Session.getEffectiveUser()`, aplica la lista de `CONFIG` y falla de forma cerrada si Google no identifica al usuario.

## Flujo documental

1. `apiStartBatch` crea un lote de borrador y lee como máximo cinco correos.
2. Cada PDF se recupera desde Gmail, se calcula su SHA-256 y se convierte temporalmente a Google Docs para OCR.
3. La copia OCR creada por la aplicación se envía a la papelera al terminar; el adjunto original no se modifica.
4. La clasificación guarda propuesta, campos y evidencia en `DOCUMENTOS`.
5. `apiContinueBatch` conserva la página, los identificadores pendientes y los correos ya terminados; una interrupción reanuda el mensaje pendiente sin saltar el resto de la página.
6. `apiSaveDocumentReview` conserva correcciones y motivo, y vuelve a validar.
7. `apiApproveBatch`, bajo bloqueo global, vuelve a comprobar duplicados, archiva y registra cada elemento de forma idempotente.

Un documento solo recibe `PROCESADA` cuando tanto el archivo como el registro definitivo terminan correctamente. Los fallos quedan en `ERROR` y `apiRetryBatch` reintenta solo esos elementos. Las excepciones permanecen en una cola transversal aunque el lote original ya esté cerrado y se pueden aprobar individualmente tras resolverlas.

## Identidad y duplicados

Se utilizan tres identidades independientes:

- `SOURCE_KEY`: mensaje, adjunto y nombre originales;
- `HASH_PDF`: SHA-256 exacto de los bytes;
- identidad contable: proveedor, número, fecha, total y moneda normalizados.

La coincidencia de cualquiera de las dos primeras evita una segunda copia. La identidad contable evita facturas equivalentes con archivos distintos.

## Datos

Las pestañas históricas conservan su orden original. Las columnas nuevas se añaden al final.

- `LOTES`: cursor, estado, progreso, creador y aprobación.
- `DOCUMENTOS`: borrador por PDF, evidencia y decisión.
- `FACTURAS`: resultado definitivo y enlaces.
- `MOVIMIENTOS`: importación bancaria normalizada y su archivo fuente.
- `CONCILIACIONES`: propuestas y decisiones humanas.
- `COBERTURAS`: intervalos acreditados por fuente, manteniendo huecos y parciales.
- `REGLAS_PROVEEDOR`: reglas y frecuencias confirmadas que únicamente generan sugerencias.
- `LOG`: eventos inmutables con usuario, lote y request ID.

## Conciliación

El parser localiza encabezados conocidos incluso si empiezan después de varias filas —como el extracto real, cuyo encabezado comienza en la fila 9—. Las propuestas comparan importe, moneda, fecha, proveedor, concepto y referencia, y explican su confianza. Varias candidatas, pagos parciales y relaciones múltiples permanecen bajo decisión humana. La bandeja permite decidir propuestas inequívocas en conjunto y la matriz avanzada conserva la asignación detallada y la posibilidad de deshacer.

## Mesa semanal

La pantalla inicial consume un resumen calculado, no una copia de los registros. Ordena la siguiente acción y las tareas de captura, validación, conciliación y cierre. El mapa de cobertura combina únicamente intervalos acreditados por lotes e importaciones confirmadas; no convierte una fecha máxima en cobertura continua.

Las listas de facturas, movimientos, proveedores e historial se consultan por páginas para evitar que el arranque crezca con todo el histórico. Las mutaciones masivas aceptan como máximo veinte decisiones, utilizan un único bloqueo y devuelven un resultado por elemento.

## Construcción

Vite genera una única página HTML con React y CSS integrados. `scripts/build-apps-script.mjs` incrusta el logotipo oficial y copia el servidor y `appsscript.json` a `dist/apps-script`.
