# Especificación funcional y operativa

## Gestión de facturas de gasto de ReparaPRO

**Versión:** 1.0  
**Fecha de referencia:** 20 de julio de 2026  
**Estado:** flujo inicial completado y documentado  
**Ámbito:** Gmail, Google Drive, Google Sheets, proveedores, informes y conciliación bancaria

---

## 1. Objetivo

Crear y mantener un proceso seguro y auditable para:

1. localizar en Gmail documentos PDF que puedan ser facturas de gasto;
2. analizar el contenido real del documento;
3. extraer sus datos fiscales y contables;
4. identificar al proveedor sin inventar información;
5. detectar duplicados;
6. archivar las facturas válidas en Google Drive;
7. registrar el resultado en Google Sheets;
8. conservar para revisión los documentos dudosos;
9. producir listados de proveedores y métricas mensuales;
10. conciliar las facturas con movimientos bancarios.

El sistema debe priorizar la trazabilidad y evitar que un documento dudoso se archive como factura válida.

---

## 2. Sistemas y ubicaciones

### 2.1 Gmail

- Fuente principal de correos y adjuntos.
- Periodo inicial del histórico: desde el 1 de enero de 2026.
- Los correos y adjuntos originales no se eliminan ni modifican.
- La referencia estable utilizada para evitar reprocesados combina el identificador del mensaje y el nombre del adjunto.

Ejemplo:

```text
gmail:<message_id>|<nombre_original.pdf>
```

### 2.2 Google Drive

- Carpeta raíz de facturas de gasto: **A.2 - FA-Gastos**.
- ID de la carpeta: `1hv9U-HJxLkLSB__IBnbLl02lCzqEOgu5`.
- Estructura de archivo:

```text
A.2 - FA-Gastos
└── AÑO
    └── TRIMESTRE
        └── MES
```

Las carpetas existentes deben reutilizarse. Solo se crearán las que falten.

### 2.3 Google Sheets

- Archivo: **ReparaPRO Docs**.
- ID: `1ivQ30ZjxNEMOXZCZEordOZFOVJopQS6xTj8Iy4m4yvU`.
- Pestañas utilizadas:

| Pestaña | sheetId | Uso |
|---|---:|---|
| CONFIG | 624282184 | Configuración general |
| PROVEEDORES | 101 | Proveedores activos y dominios |
| REGLAS | 102 | Reglas de clasificación |
| FACTURAS | 103 | Registro documental y contable |
| LOG | 104 | Trazabilidad de lotes y errores |

---

## 3. Alcance documental

### 3.1 Documentos incluidos

Se consideran candidatos los PDF adjuntos que contengan varias señales coherentes de factura, por ejemplo:

- factura, invoice o tax invoice;
- número de factura;
- fecha de emisión;
- proveedor o razón social;
- subtotal e impuestos;
- IVA o VAT;
- importe total;
- moneda;
- total a pagar.

Una palabra aislada o el nombre del archivo no son suficientes. Debe evaluarse el documento completo.

### 3.2 Documentos excluidos

No deben archivarse automáticamente como facturas de gasto:

- presupuestos;
- propuestas comerciales;
- pedidos y confirmaciones de pedido;
- albaranes y notas de entrega;
- shipment slips;
- etiquetas de devolución;
- contratos y escrituras;
- formularios;
- documentos bancarios;
- facturas emitidas por ReparaPRO;
- documentos ilegibles o no identificables;
- notas de crédito y abonos sin tratamiento contable aprobado;
- PDF que contengan varias facturas si esas facturas ya están archivadas individualmente.

---

## 4. Datos extraídos por factura

Para cada documento se intenta obtener:

- fecha de factura;
- proveedor;
- CIF, NIF o VAT ID;
- número de factura;
- importe total final con impuestos;
- moneda;
- remitente;
- asunto del correo;
- fecha del correo;
- nombre original del PDF;
- referencia o enlace del correo;
- identificador único;
- nombre final del archivo;
- enlace de Drive;
- estado;
- observaciones;
- motivo de revisión.

No se completan datos que no estén respaldados por el documento, el correo o una fuente ya validada.

---

## 5. Identificación de proveedores

La identificación utiliza conjuntamente:

1. razón social mostrada en la factura;
2. nombre comercial;
3. CIF, NIF o VAT ID;
4. dominio y dirección del remitente;
5. proveedor activo registrado en la pestaña `PROVEEDORES`.

Si la identidad no es segura:

- no se archiva automáticamente;
- se registra como `REVISIÓN MANUAL`;
- se conserva el posible proveedor y el dominio como evidencia.

### 5.1 Normalización

- Las variantes con y sin prefijo de país pueden considerarse equivalentes cuando están acreditadas en las facturas.
- Los alias comerciales se consolidan con su razón social cuando la relación es verificable.
- Los correos personales utilizados solo para reenviar una factura no se consideran correos del proveedor.
- Los dominios genéricos como Gmail u Outlook no se presentan como dominio corporativo.

### 5.2 Estado actual de proveedores

- Se consolidaron **38 proveedores activos**.
- El duplicado de MobileSentrix se unificó.
- `shenzhenshiyalaitongkejiyouxiangongsi` fue eliminado del listado de proveedores habituales por decisión del usuario.
- La factura histórica de ese proveedor permanece archivada como justificante.

---

## 6. Validación de una factura

Una factura puede pasar a `PROCESADA` cuando:

- es una factura de gasto;
- no fue emitida por ReparaPRO;
- el proveedor está identificado;
- tiene fecha válida;
- tiene número de factura;
- el importe es numérico y superior a cero;
- la moneda está identificada;
- no es una nota de crédito o abono pendiente;
- no es un duplicado;
- el PDF puede asociarse inequívocamente a una sola factura.

Si falla una condición, el documento se registra para revisión o se descarta según corresponda.

---

## 7. Control de duplicados

Antes de archivar se comprueba:

1. identificador del correo y adjunto;
2. existencia previa en `FACTURAS`;
3. nombre final en la carpeta de Drive;
4. combinación de proveedor, número, fecha e importe;
5. existencia de una factura individual procedente de un PDF múltiple.

Un duplicado:

- no se vuelve a subir;
- se registra como `DUPLICADO IGNORADO`;
- no provoca la eliminación del correo original.

---

## 8. Archivo y nomenclatura

### 8.1 Carpeta

La carpeta se determina por la fecha de emisión:

```text
AÑO / TRIMESTRE / MES
```

### 8.2 Nombre final

```text
YYYY-MM-DD - Proveedor - 0.00 MONEDA - NúmeroFactura.pdf
```

Ejemplo:

```text
2026-07-09 - Orange Energía - 94.49 EUR - E26OR0000621589.pdf
```

No se sobrescriben archivos existentes.

---

## 9. Estados permitidos

| Estado | Significado |
|---|---|
| PROCESADA | Factura válida y archivada |
| REVISIÓN MANUAL | Falta validación o decisión humana |
| DUPLICADO IGNORADO | Documento ya registrado o archivado |
| NO ES FACTURA | Documento descartado |
| FACTURA DE VENTA | Factura emitida por ReparaPRO y excluida del gasto |

---

## 10. Estructura de la pestaña FACTURAS

La implementación actual utiliza las columnas A:R:

| Columna | Campo |
|---|---|
| A | FECHA_FACTURA |
| B | PROVEEDOR |
| C | CIF_NIF |
| D | NÚMERO_FACTURA |
| E | IMPORTE_TOTAL |
| F | MONEDA |
| G | ESTADO |
| H | ARCHIVO_DRIVE |
| I | URL_DRIVE |
| J | REMITENTE |
| K | ASUNTO |
| L | FECHA_PROCESO |
| M | OBSERVACIONES |
| N | FECHA_CORREO |
| O | NOMBRE_ORIGINAL |
| P | MOTIVO_REVISION |
| Q | REFERENCIA_CORREO |
| R | ID_UNICO |

---

## 11. Registro en LOG

Cada lote debe registrar:

- inicio y fin;
- identificador del lote;
- rango o punto de continuación;
- cantidad de elementos;
- subidas realizadas;
- duplicados;
- revisiones;
- descartes;
- errores;
- resultado final.

El log permite reanudar el proceso sin repetir correos ni adjuntos.

---

## 12. Procesamiento por lotes

1. Empezar con un lote de prueba.
2. Presentar una propuesta antes de la primera escritura masiva.
3. Solicitar aprobación.
4. Ejecutar en lotes pequeños o medianos.
5. Comprobar duplicados antes de cada subida.
6. Actualizar `FACTURAS` y `LOG`.
7. Auditar el lote antes de continuar.
8. Mantener un punto de control.

En la ejecución aprobada se trabajó en varios bloques hasta completar 159 facturas.

---

## 13. Resultados del archivo documental

### 13.1 Lote aprobado

- Facturas archivadas: **159**.
- Errores de subida: **0**.
- Duplicados creados: **0**.
- Enlaces ausentes: **0**.
- Correos eliminados o modificados: **0**.

### 13.2 Estado global de FACTURAS

| Estado | Cantidad |
|---|---:|
| PROCESADA | 177 |
| NO ES FACTURA | 208 |
| DUPLICADO IGNORADO | 45 |
| REVISIÓN MANUAL | 44 |
| **Total** | **474** |

La lectura utilizada incluía la fila de encabezado y 474 registros de datos.

### 13.3 Revisión manual pendiente

| Categoría | Cantidad |
|---|---:|
| Notas de crédito o abonos | 25 |
| Ilegibles o con OCR insuficiente | 14 |
| PDF con dos facturas ya archivadas individualmente | 5 |
| **Total** | **44** |

---

## 14. Archivo de proveedores

Se generó un archivo compatible con la plantilla `contact.xls`:

```text
outputs/019f70f8-e2b2-7aa1-bd63-9e16c054b5f4/Proveedores_ReparaPRO.xlsx
```

### 14.1 Campos cumplimentados

Solo cuando existe evidencia:

- Name;
- Email;
- Company;
- Supplier;
- Notes;
- Tax identification number.

Los dominios confirmados se incluyen en `Notes`. Los campos sin información acreditada quedan vacíos.

---

## 15. Volumen mensual de facturas

Conteo basado en facturas con estado `PROCESADA` y fecha de emisión:

| Mes | Facturas |
|---|---:|
| Febrero 2025 | 1 |
| Noviembre 2025 | 1 |
| Diciembre 2025 | 4 |
| Enero 2026 | 30 |
| Febrero 2026 | 26 |
| Marzo 2026 | 23 |
| Abril 2026 | 29 |
| Mayo 2026 | 26 |
| Junio 2026 | 20 |
| Julio 2026 | 17 |

Indicadores de 2026:

- media enero-julio: **24,4 facturas/mes**;
- media de meses completos enero-junio: **25,7 facturas/mes**.

Julio era un mes incompleto en la fecha del cálculo. Los datos de 2025 son parciales y no deben utilizarse como media operativa.

---

## 16. Conciliación bancaria

### 16.1 Fuente bancaria

- Archivo: `MovimientosCuenta.xlsx`.
- ID de Drive: `1cA2QLjlcyVSeD3h2wAGI7wi7bRKdxAxU`.
- Periodo del extracto: **01/07/2026–20/07/2026**.
- Movimientos: **51**.

### 16.2 Reglas de conciliación

Para una coincidencia automática se exige:

- movimiento de cargo;
- movimiento no identificado como traspaso interno;
- misma moneda;
- mismo importe con tolerancia máxima de 0,01 EUR;
- evidencia suficiente en fecha, proveedor, concepto o referencia.

Los ingresos y traspasos entre cuentas propias se excluyen.

### 16.3 Resultados de julio

| Resultado | Cantidad |
|---|---:|
| Facturas revisadas | 17 |
| Facturas conciliadas automáticamente | 0 |
| Facturas no encontradas en el extracto | 17 |
| Cargos bancarios sin factura registrada | 2 |
| Traspasos internos excluidos | 20 |
| Ingresos excluidos | 29 |

- Importe total de facturas no localizado: **3.826,53 EUR**.
- Los dos cargos sin factura eran pagos a la AEAT.

### 16.4 Interpretación obligatoria

`NO ENCONTRADA EN ESTE EXTRACTO` no equivale a `IMPAGADA`.

Una factura puede:

- haberse pagado desde otra cuenta;
- haberse pagado mediante tarjeta;
- haberse pagado en efectivo;
- estar pendiente de pago;
- haberse pagado después del 20 de julio.

### 16.5 Reporte generado

```text
outputs/019f70f8-e2b2-7aa1-bd63-9e16c054b5f4/Conciliacion_facturas_banco_julio_2026.xlsx
```

El reporte contiene:

- resumen;
- facturas de julio;
- movimientos bancarios;
- reglas y fuentes.

---

## 17. Reglas de seguridad

- No eliminar correos.
- No eliminar adjuntos originales.
- No sobrescribir archivos de Drive.
- No convertir facturas de venta en gastos.
- No archivar automáticamente documentos dudosos.
- No inventar CIF, NIF, VAT ID, dominios, direcciones o contactos.
- No considerar un correo personal de reenvío como contacto del proveedor.
- No marcar una factura como pagada sin evidencia bancaria suficiente.
- Mantener enlaces a las fuentes siempre que estén disponibles.
- Conservar un registro de cada acción y excepción.

---

## 18. Limitaciones conocidas

- El OCR puede fallar en documentos escaneados o de baja calidad.
- Algunos PDF incluyen varias facturas.
- Las notas de crédito requieren una política contable específica.
- La fecha de factura y la fecha de pago pueden pertenecer a meses diferentes.
- Un único extracto bancario no representa necesariamente todas las cuentas y tarjetas.
- Los movimientos agregados pueden requerir conciliación por grupos.
- La ausencia de CIF o VAT ID impide completar el proveedor con plena seguridad.

---

## 19. Próximas mejoras recomendadas

1. Definir el tratamiento contable de notas de crédito y abonos.
2. Añadir todos los extractos de cuentas y tarjetas usados para pagar proveedores.
3. Incorporar conciliación por número de factura o referencia bancaria.
4. Permitir conciliaciones de varios pagos contra una factura y viceversa.
5. Registrar estado de pago separado del estado documental.
6. Añadir fecha de vencimiento cuando figure en la factura.
7. Crear un catálogo canónico de alias, CIF/VAT y dominios por proveedor.
8. Ejecutar una conciliación final cuando el mes esté cerrado.

---

## 20. Criterios de aceptación

El flujo se considera correcto cuando:

- cada PDF revisado tiene un estado;
- ninguna factura se archiva dos veces;
- todas las facturas procesadas tienen enlace de Drive;
- el nombre y la carpeta corresponden a la fecha de emisión;
- los documentos dudosos permanecen en revisión;
- las facturas emitidas por ReparaPRO están excluidas;
- `FACTURAS` y `LOG` permiten auditar la ejecución;
- los datos de proveedores proceden de fuentes verificables;
- la conciliación distingue entre no encontrado e impagado;
- los reportes incluyen fuentes, periodo y reglas utilizadas.

---

## 21. Procedimiento de continuidad

Para un nuevo lote o mes:

1. confirmar el periodo;
2. leer proveedores activos;
3. buscar correos con PDF no procesados;
4. analizar documentos;
5. validar y deduplicar;
6. presentar revisión cuando sea necesaria;
7. archivar las facturas aprobadas;
8. actualizar `FACTURAS` y `LOG`;
9. cargar todos los extractos bancarios del periodo;
10. ejecutar la conciliación;
11. revisar excepciones;
12. cerrar el mes con un resumen final.
