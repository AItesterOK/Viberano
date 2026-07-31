# Operación y despliegue seguro

## Antes del primer despliegue

1. Confirmar que la sesión corresponde a `compras@reparapro.com`.
2. Habilitar Apps Script API, Gmail API y Drive API en el proyecto Google asociado.
3. Inventariar el proyecto Apps Script 0.2.0 existente y sus activadores. No desactivar nada sin revisar la lista exacta.
4. Ejecutar `npm run check` y `npm run build`.
5. Crear una versión de Apps Script y desplegar con acceso al dominio y ejecución como desplegador.

## Migración

La pantalla Configuración exige una confirmación explícita. El servidor copia primero `ReparaPRO Docs` y después realiza una migración aditiva. Conservar el enlace de la copia en el registro de cambio.

Tras migrar, comprobar que los recuentos históricos siguen siendo idénticos. No rellenar hashes, CIF/NIF, dominios u otros campos históricos sin evidencia.

## Piloto obligatorio

1. Mantener `APP_MODE=DRY_RUN`.
2. Analizar exactamente 10 correos posteriores al último punto de control.
3. Revisar proveedor, tipo, fecha, importe, número, decisión, carpeta y nombre final.
4. Confirmar que no hay PDF nuevo en `A.2 - FA-GASTOS` ni fila definitiva nueva en `FACTURAS`.
5. Solo después de la aprobación humana, cambiar a `PRODUCTION`, marcar la confirmación separada de que el piloto fue revisado y aprobar la selección.
6. Verificar los enlaces, estados y hashes.
7. Repetir la petición con el mismo request ID o volver a presentar el documento: no debe crearse una segunda copia.

## Reversión

- Volver a desplegar la versión Apps Script anterior.
- Mantener las pestañas y columnas aditivas; no borrar registros de auditoría.
- Fusionar proveedores solo con motivo acreditado: se desactiva el origen, se trasladan los documentos pendientes y no se reescribe el histórico.
- Usar la copia previa de la hoja para comparar, no para sobrescribir silenciosamente producción.
- Nunca borrar automáticamente facturas ya aprobadas.

## Incorporar otro usuario

1. Compartir en lectura las carpetas de facturas y bancos con la cuenta concreta.
2. Añadir su correo a `APP_ALLOWED_USERS`.
3. Verificar que `activeUser` identifica esa cuenta y `effectiveUser` sigue siendo `compras@reparapro.com`.
4. Si `activeUser` está vacío, retirar el correo de la lista y mantener el fallo cerrado.
