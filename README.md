# ReparaPRO Gastos

Aplicación web interna para localizar, revisar, archivar y conciliar facturas de gasto sin modificar Gmail ni completar datos sin evidencia.

## Qué incluye

- análisis manual y reanudable de Gmail en lotes de hasta 20 correos;
- OCR gratuito mediante Google Drive y reglas conservadoras;
- aprobación humana antes de archivar en Drive o registrar en `FACTURAS`;
- revisión manual, catálogo de proveedores y exportación CSV;
- mesa semanal con siguiente acción, vencimientos y mapa de cobertura por fuente;
- métricas mensuales y medias diferenciando meses completos;
- importación XLSX/CSV, soporte nativo para CaixaBank y perfiles de mapeo bancario reutilizables;
- bandeja de propuestas de conciliación y matriz para pagos parciales o relaciones múltiples;
- reglas de proveedor auditadas que sugieren categoría, moneda y conceptos bancarios sin aprobar automáticamente;
- registro de usuario, evento, evidencia y cambios anteriores/nuevos.

La aplicación funciona online. No contabiliza, no paga, no usa Document AI, no modifica correos y nunca aplica por sí sola una clasificación o conciliación propuesta.

## Desarrollo local

Requisitos: Node.js 20 o superior.

```powershell
npm install
npm run dev
```

En desarrollo usa un adaptador local con datos ficticios. Ningún dato real sale de Google Workspace.

Comprobaciones:

```powershell
npm run check
npm run build
npm run test:e2e
```

## Google Apps Script

La salida preparada para `clasp` se genera en `dist/apps-script`:

```powershell
npm run build
npx clasp login
npx clasp create --type standalone --title "ReparaPRO Gastos PROD" --rootDir dist/apps-script
npx clasp push
```

El proyecto debe crearse y desplegarse desde `compras@reparapro.com`, como aplicación web restringida al dominio y ejecutada como el usuario que despliega. No se versionan `.clasprc.json` ni `.clasp.json`.

El primer acceso muestra la migración pendiente. La acción **Crear copia y migrar**:

1. crea una copia independiente de `ReparaPRO Docs`;
2. añade columnas al final de las pestañas existentes;
3. crea las pestañas aditivas de lotes, documentos, movimientos, conciliaciones, formatos bancarios, coberturas y reglas de proveedor;
4. mantiene `APP_MODE=DRY_RUN`.

No cambies a `PRODUCTION` hasta revisar el piloto de 10 correos. Consulta [docs/operations.md](docs/operations.md).

## Datos y seguridad

- El repositorio nunca contiene facturas, extractos, tokens ni exportaciones.
- Gmail usa `gmail.readonly`.
- Cada función comprueba dominio, lista blanca, usuario activo y usuario efectivo.
- Las aprobaciones y conciliaciones se serializan y llevan identificador idempotente.
- El modo seco impide el archivo y el registro definitivo.

Consulta [spec.md](spec.md) para el contrato funcional y [docs/architecture.md](docs/architecture.md) para la implementación.

## Diseño de referencia

La aplicación funcional conserva los entregables visuales del Sprint 2 como referencia de producto:

- [Sistema de diseño](DESIGN.md)
- [Presentación de las cuatro pantallas](ENTREGA_SPRINT_2.md)
- [Imágenes finales](diseño/)
