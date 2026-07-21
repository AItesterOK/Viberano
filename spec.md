# Especificación de Feature: Gestión de facturas de gasto para MicroPymes

**Rama**: `001-gestion-facturas-gasto`
**Creada**: 2026-07-20
**Estado**: Borrador
**Input**: Descripción del usuario: "Documentar y reproducir el flujo realizado para localizar, validar, archivar y registrar facturas de gasto, gestionar proveedores, obtener métricas mensuales y compararlas con movimientos bancarios, sin inventar datos ni duplicar documentos."

## Problema y propósito

La persona responsable de administración necesita controlar las facturas de gasto recibidas por correo sin revisar y archivar manualmente cada adjunto. El proceso actual debe distinguir una factura válida de otros documentos, evitar duplicados, mantener una trazabilidad completa y señalar cualquier caso dudoso antes de archivarlo.

El resultado esperado es un registro fiable de las facturas de gasto, organizado por periodo, que permita consultar proveedores, medir el volumen mensual y contrastar las facturas con los movimientos bancarios disponibles sin confundir una ausencia de coincidencia con una factura impagada.

## Alcance

Esta feature incluye:

- revisión de correos recibidos que contengan documentos PDF;
- identificación y clasificación del contenido real de cada documento;
- extracción de los datos acreditados de cada factura de gasto;
- validación de proveedores activos;
- prevención de duplicados;
- archivo de facturas válidas por año, trimestre y mes;
- registro auditable de resultados, excepciones y progreso;
- mantenimiento de un listado de proveedores con datos demostrables;
- cálculo del número de facturas recibidas por mes y de su media;
- conciliación de facturas con los movimientos bancarios aportados;
- continuidad del procesamiento en lotes sin repetir elementos ya revisados.

### Fuera de alcance

- eliminar o modificar correos y adjuntos originales;
- procesar facturas de venta emitidas por la empresa como gastos;
- inventar o completar datos fiscales, dominios o contactos sin evidencia;
- decidir el tratamiento contable definitivo de notas de crédito o abonos;
- afirmar que una factura está pagada o impagada sin evidencia suficiente;
- contabilizar, pagar o aprobar pagos a proveedores;
- modificar el contenido de una factura;
- desarrollar en esta especificación el plan técnico, las tareas o el código;
- garantizar una conciliación completa cuando no se hayan aportado todas las cuentas y tarjetas utilizadas para pagar.

## Personas implicadas

- **Responsable de administración de la empresa**: revisa resultados, aprueba lotes, resuelve excepciones y utiliza los informes.
- **Responsable contable de la empresa**: consulta facturas, proveedores y conciliaciones para verificar la documentación de gasto.

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia de Usuario 1 - Identificar y clasificar documentos de gasto (Prioridad: P1)

Como responsable de administración, quiero que cada PDF recibido se evalúe por su contenido completo, para distinguir las facturas de gasto de otros documentos sin depender únicamente del asunto o del nombre del archivo.

**Por qué esta prioridad**: toda acción posterior depende de clasificar correctamente el documento y de excluir facturas de venta o documentos que no sean facturas.

**Test independiente**: se puede probar con un lote que contenga una factura de gasto, una factura emitida por la empresa, un presupuesto, un albarán y un documento ilegible, verificando que cada uno recibe el estado correcto.

**Escenarios de aceptación**:

1. **Dado** un PDF que contiene proveedor, número de factura, fecha, impuestos e importe total coherentes, **Cuando** se analiza el documento completo, **Entonces** se clasifica como factura de gasto candidata.
2. **Dado** un PDF cuyo nombre contiene la palabra “factura” pero cuyo contenido es un presupuesto, **Cuando** se analiza el documento completo, **Entonces** se clasifica como `NO ES FACTURA`.
3. **Dado** un documento emitido por la empresa, **Cuando** se identifica al emisor, **Entonces** se clasifica como `FACTURA DE VENTA` y no se incorpora a los gastos.
4. **Dado** un PDF ilegible o sin señales suficientes para identificar su naturaleza, **Cuando** se intenta clasificar, **Entonces** se registra como `REVISIÓN MANUAL` con el motivo correspondiente.
5. **Dado** un correo sin archivos PDF, **Cuando** se revisa dentro del periodo, **Entonces** no se genera una factura ni se altera el correo.

### Historia de Usuario 2 - Extraer y validar los datos de la factura (Prioridad: P1)

Como responsable de administración, quiero obtener únicamente los datos respaldados por la factura y el correo, para disponer de registros fiscales fiables sin información inventada.

**Por qué esta prioridad**: una factura no puede archivarse ni conciliarse con seguridad si faltan o son inválidos sus datos esenciales.

**Test independiente**: se puede probar con facturas completas, facturas con importe cero, facturas sin número y facturas con campos ambiguos, comprobando qué documentos se procesan y cuáles quedan en revisión.

**Escenarios de aceptación**:

1. **Dado** una factura de gasto con proveedor, número, fecha, total positivo y moneda identificables, **Cuando** se extraen sus datos, **Entonces** todos los valores acreditados quedan asociados al documento.
2. **Dado** una factura en la que no aparece un CIF, NIF o VAT ID verificable, **Cuando** se extraen los datos, **Entonces** ese campo queda vacío y no se inventa ningún valor.
3. **Dado** una factura sin número inequívoco, **Cuando** se valida para archivo, **Entonces** se registra como `REVISIÓN MANUAL` y no se archiva automáticamente.
4. **Dado** una factura cuyo total no es numérico o no es superior a cero, **Cuando** se valida para archivo, **Entonces** se registra como `REVISIÓN MANUAL` con el motivo.
5. **Dado** que el total y el subtotal aparecen en el mismo documento, **Cuando** se determina el importe de la factura, **Entonces** se utiliza el total final con impuestos incluidos.

### Historia de Usuario 3 - Identificar al proveedor sin inventar datos (Prioridad: P1)

Como responsable de administración, quiero contrastar el proveedor de cada factura con el catálogo de proveedores activos, para archivar automáticamente solo documentos cuya procedencia sea segura.

**Por qué esta prioridad**: la identificación del proveedor determina el nombre, la trazabilidad y la fiabilidad fiscal del registro.

**Test independiente**: se puede probar con un proveedor activo inequívoco, un proveedor desconocido, un proveedor inactivo y una factura reenviada desde un correo personal.

**Escenarios de aceptación**:

1. **Dado** una factura cuya razón social, identificación fiscal o dominio coincide de forma coherente con un proveedor activo, **Cuando** se valida el proveedor, **Entonces** se asocia la factura a ese proveedor.
2. **Dado** una factura cuyo proveedor no figura entre los proveedores activos, **Cuando** se intenta identificarlo, **Entonces** se registra como `REVISIÓN MANUAL` con el posible nombre y el dominio observado.
3. **Dado** una factura de un proveedor inactivo, **Cuando** se valida el proveedor, **Entonces** no se archiva automáticamente.
4. **Dado** una factura reenviada desde una cuenta personal, **Cuando** se identifica el proveedor, **Entonces** el dominio personal no se presenta como dominio corporativo del proveedor.
5. **Dado** dos registros que representan inequívocamente al mismo proveedor, **Cuando** se revisa el catálogo, **Entonces** se conserva una única identidad canónica sin perder la evidencia disponible.

### Historia de Usuario 4 - Evitar duplicados y conservar la trazabilidad (Prioridad: P1)

Como responsable de administración, quiero impedir que un correo, adjunto o factura ya procesados se archiven de nuevo, para mantener un registro contable sin duplicidades.

**Por qué esta prioridad**: los duplicados distorsionan el gasto, las métricas y la conciliación bancaria.

**Test independiente**: se puede probar presentando dos veces el mismo adjunto y presentando archivos diferentes con la misma combinación de proveedor, número, fecha e importe.

**Escenarios de aceptación**:

1. **Dado** un adjunto cuya referencia de correo y nombre original ya fueron registrados, **Cuando** vuelve a aparecer, **Entonces** se marca como `DUPLICADO IGNORADO` y no se vuelve a archivar.
2. **Dado** una factura que coincide con otra en proveedor, número, fecha e importe, **Cuando** se comprueba antes del archivo, **Entonces** se marca como posible duplicado y no se crea una segunda copia.
3. **Dado** un PDF que agrupa facturas ya archivadas individualmente, **Cuando** se analiza el documento agrupado, **Entonces** no se archiva como una factura adicional.
4. **Dado** un documento considerado duplicado, **Cuando** finaliza su revisión, **Entonces** el correo y el adjunto originales permanecen intactos.

### Historia de Usuario 5 - Archivar y registrar facturas válidas (Prioridad: P1)

Como responsable de administración, quiero que las facturas válidas se archiven en el periodo que corresponde a su fecha de emisión y queden enlazadas desde el registro, para poder localizarlas y auditarlas fácilmente.

**Por qué esta prioridad**: el valor mínimo del flujo exige que una factura validada quede organizada, accesible y trazable.

**Test independiente**: se puede probar con una factura válida de cada trimestre, verificando su destino, nombre final, estado y enlace sin depender de los informes o la conciliación.

**Escenarios de aceptación**:

1. **Dado** una factura válida y no duplicada, **Cuando** se aprueba su archivo, **Entonces** se guarda en el año, trimestre y mes de su fecha de emisión.
2. **Dado** una factura válida y no duplicada, **Cuando** se archiva, **Entonces** su nombre final incluye fecha, proveedor, importe, moneda y número de factura.
3. **Dado** que ya existe un archivo con el nombre de destino, **Cuando** se intenta archivar la factura, **Entonces** no se sobrescribe el archivo existente y el caso queda registrado para revisión.
4. **Dado** una factura archivada correctamente, **Cuando** finaliza el proceso, **Entonces** su estado es `PROCESADA` y el registro permite abrir el archivo archivado y localizar el correo de origen cuando esa referencia esté disponible.
5. **Dado** que falla el archivo o el registro de una factura, **Cuando** termina el intento, **Entonces** no se informa como procesada y el error queda trazado.

### Historia de Usuario 6 - Resolver documentos dudosos con control humano (Prioridad: P2)

Como responsable de administración, quiero revisar los documentos que no cumplen todos los criterios automáticos, para resolver excepciones sin contaminar el archivo de facturas válidas.

**Por qué esta prioridad**: el proceso principal puede operar sin resolver inmediatamente todas las excepciones, pero estas deben quedar visibles y recuperables.

**Test independiente**: se puede probar con un proveedor desconocido, una factura ilegible, una nota de crédito y un documento con varias facturas.

**Escenarios de aceptación**:

1. **Dado** un documento con información insuficiente o contradictoria, **Cuando** no puede validarse con seguridad, **Entonces** queda en `REVISIÓN MANUAL` con un motivo concreto.
2. **Dado** un documento en revisión, **Cuando** el responsable aporta o valida la información que faltaba, **Entonces** puede volver a evaluarse sin crear un registro duplicado.
3. **Dado** una nota de crédito o un abono, **Cuando** se identifica su naturaleza, **Entonces** permanece en revisión hasta disponer de una política contable aprobada.
4. **Dado** un documento rechazado como factura, **Cuando** se consulta el registro, **Entonces** se puede conocer la razón del descarte.

### Historia de Usuario 7 - Mantener un catálogo fiable de proveedores (Prioridad: P2)

Como responsable de administración, quiero consultar y exportar los proveedores encontrados con sus datos acreditados, para reutilizarlos en tareas administrativas sin rellenar campos a ciegas.

**Por qué esta prioridad**: mejora la consistencia del flujo y reduce revisiones futuras, aunque no es necesaria para clasificar manualmente una primera factura.

**Test independiente**: se puede probar generando un listado de proveedores que incluya solo nombre, dominio e identificación fiscal cuando exista evidencia para cada dato.

**Escenarios de aceptación**:

1. **Dado** un proveedor con nombre, dominio e identificación fiscal acreditados, **Cuando** se consulta o exporta, **Entonces** aparecen esos tres datos asociados correctamente.
2. **Dado** un proveedor sin identificación fiscal acreditada, **Cuando** se exporta, **Entonces** el campo correspondiente queda vacío.
3. **Dado** un dominio genérico o personal usado para reenviar una factura, **Cuando** se genera el listado, **Entonces** no se presenta como dominio corporativo confirmado.
4. **Dado** un proveedor eliminado o marcado como inactivo por el responsable, **Cuando** se procesan facturas futuras, **Entonces** no se utiliza para la identificación automática.
5. **Dado** la eliminación de un proveedor del catálogo habitual, **Cuando** se consulta el histórico, **Entonces** sus facturas previamente archivadas se conservan como justificantes.

### Historia de Usuario 8 - Consultar el volumen mensual de facturas (Prioridad: P2)

Como responsable de administración, quiero conocer cuántas facturas de gasto se reciben por mes y su media, para estimar la carga administrativa y detectar variaciones.

**Por qué esta prioridad**: aporta visibilidad operativa una vez que existe un registro fiable de facturas procesadas.

**Test independiente**: se puede probar con un conjunto cerrado de facturas procesadas de varios meses y comprobar el recuento y la media resultantes.

**Escenarios de aceptación**:

1. **Dado** un periodo con facturas `PROCESADA` y fecha de emisión válida, **Cuando** se solicita el volumen mensual, **Entonces** se muestra el número de facturas de cada mes del periodo.
2. **Dado** un periodo que incluye meses completos y un mes en curso, **Cuando** se calcula la media, **Entonces** se distingue la media de meses completos de la media que incluye el mes parcial.
3. **Dado** registros con estado distinto de `PROCESADA`, **Cuando** se calcula el volumen de facturas archivadas, **Entonces** esos registros no incrementan el recuento.
4. **Dado** datos parciales de años anteriores, **Cuando** se presenta la métrica, **Entonces** se identifican como parciales y no se mezclan silenciosamente con la media operativa.

### Historia de Usuario 9 - Conciliar facturas con movimientos bancarios (Prioridad: P2)

Como responsable de administración, quiero comparar las facturas de gasto con los movimientos bancarios aportados, para saber cuáles tienen una coincidencia respaldada y cuáles necesitan investigación.

**Por qué esta prioridad**: permite controlar la documentación de pagos, pero depende de disponer previamente de facturas validadas y extractos suficientes.

**Test independiente**: se puede probar con un extracto que contenga una coincidencia exacta, un cargo sin factura, un ingreso, un traspaso interno y una factura sin movimiento coincidente.

**Escenarios de aceptación**:

1. **Dado** una factura y un cargo con la misma moneda e importe, y evidencia coherente de fecha, proveedor, concepto o referencia, **Cuando** se realiza la conciliación, **Entonces** la factura se informa como coincidencia encontrada.
2. **Dado** una factura sin coincidencia suficiente en los extractos aportados, **Cuando** se realiza la conciliación, **Entonces** se informa como `NO ENCONTRADA EN ESTE EXTRACTO` y no como impagada.
3. **Dado** un cargo bancario relevante sin factura registrada, **Cuando** se realiza la conciliación, **Entonces** se muestra como movimiento pendiente de justificar.
4. **Dado** un ingreso o un traspaso entre cuentas propias, **Cuando** se realiza la conciliación, **Entonces** se excluye de los cargos pendientes de factura.
5. **Dado** varias coincidencias posibles para una factura, **Cuando** no existe evidencia para elegir una de forma inequívoca, **Entonces** el caso queda pendiente de revisión manual.
6. **Dado** que el extracto cubre solo parte del mes o solo una cuenta, **Cuando** se presenta el reporte, **Entonces** se indica expresamente el periodo y la cobertura disponibles.

### Historia de Usuario 10 - Procesar por lotes y reanudar sin repetir (Prioridad: P3)

Como responsable de administración, quiero procesar los correos en lotes controlados y continuar desde el último punto completado, para avanzar sobre históricos grandes de forma segura.

**Por qué esta prioridad**: mejora el control y la continuidad del trabajo, pero el valor principal ya puede demostrarse con un lote único.

**Test independiente**: se puede probar procesando un lote, interrumpiendo el trabajo y reanudándolo, verificando que no se repiten los correos ni los adjuntos ya tratados.

**Escenarios de aceptación**:

1. **Dado** un primer lote de documentos aún no aprobado, **Cuando** se completa su análisis preliminar, **Entonces** se presenta la decisión propuesta antes de archivar o registrar cambios masivos.
2. **Dado** un lote aprobado, **Cuando** se ejecuta, **Entonces** se registran su inicio, fin, alcance, resultados y errores.
3. **Dado** una interrupción después de completar un lote, **Cuando** se reanuda el proceso, **Entonces** continúa desde el punto de control sin reprocesar elementos completados.
4. **Dado** un lote con errores parciales, **Cuando** finaliza, **Entonces** los elementos correctos conservan su resultado y los fallidos quedan identificados para reintento o revisión.

### Casos límite

- Un correo contiene varios PDF y solo algunos son facturas.
- Un PDF contiene varias facturas, páginas repetidas o anexos que no son factura.
- La fecha del correo y la fecha de emisión pertenecen a meses diferentes.
- La moneda no aparece o existen importes en varias monedas.
- El nombre comercial, la razón social y el dominio parecen corresponder a entidades diferentes.
- Una factura procede de un intermediario o ha sido reenviada por una persona.
- El mismo número de factura aparece para proveedores diferentes.
- Dos facturas del mismo proveedor tienen el mismo importe y fecha, pero números distintos.
- El archivo de destino ya existe aunque el registro de control no lo contenga.
- El registro de control existe, pero falta el archivo archivado o su enlace.
- Un documento es una rectificativa, nota de crédito o abono.
- La extracción del texto es incompleta o contradictoria.
- Una factura se paga mediante varios movimientos o un movimiento agrupa varias facturas.
- El pago se realiza desde una cuenta, tarjeta o medio no incluido en los extractos aportados.
- El extracto bancario cubre un periodo incompleto.
- El mes sobre el que se calcula la media aún no ha terminado.
- Un proveedor se desactiva después de haberse archivado facturas históricas suyas.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: El sistema DEBE revisar los correos del periodo solicitado que contengan documentos PDF sin eliminar ni modificar sus originales.
- **FR-002**: El sistema DEBE determinar la naturaleza de cada PDF a partir de su contenido completo y no únicamente de su nombre o del asunto del correo.
- **FR-003**: El sistema DEBE distinguir entre `PROCESADA`, `REVISIÓN MANUAL`, `DUPLICADO IGNORADO`, `NO ES FACTURA` y `FACTURA DE VENTA`.
- **FR-004**: El sistema DEBE excluir del gasto las facturas emitidas por la empresa.
- **FR-005**: El sistema DEBE extraer, cuando estén acreditados, proveedor, identificación fiscal, número de factura, fecha de emisión, total con impuestos y moneda.
- **FR-006**: El sistema DEBE conservar la referencia del remitente, asunto, fecha del correo, nombre original del documento y referencia del correo cuando estén disponibles.
- **FR-007**: El sistema DEBE dejar vacío cualquier dato que no pueda respaldarse con evidencia disponible.
- **FR-008**: El sistema DEBE validar al proveedor contra el catálogo de proveedores activos antes del archivo automático.
- **FR-009**: El sistema DEBE enviar a revisión manual cualquier factura cuyo proveedor no pueda identificarse con seguridad.
- **FR-010**: El sistema DEBE exigir fecha válida, número de factura, total numérico superior a cero y moneda identificada antes del archivo automático.
- **FR-011**: El sistema DEBE comprobar si el correo, adjunto, archivo o identidad contable de la factura ya fueron registrados antes de crear una nueva copia.
- **FR-012**: El sistema DEBE impedir que un documento identificado como duplicado vuelva a archivarse.
- **FR-013**: El sistema DEBE conservar el correo y el adjunto originales aunque el documento sea duplicado, descartado o quede en revisión.
- **FR-014**: El sistema DEBE archivar cada factura válida según el año, trimestre y mes de su fecha de emisión.
- **FR-015**: El sistema DEBE nombrar cada factura archivada con su fecha, proveedor, importe, moneda y número de factura.
- **FR-016**: El sistema DEBE impedir la sobrescritura de archivos existentes.
- **FR-017**: El sistema DEBE registrar el resultado de cada documento y la evidencia necesaria para auditarlo.
- **FR-018**: El sistema DEBE registrar por cada lote su alcance, inicio, fin, cantidades, errores y punto de continuación.
- **FR-019**: El sistema DEBE permitir reanudar el procesamiento sin repetir correos ni adjuntos completados.
- **FR-020**: El sistema DEBE presentar para aprobación el primer lote antes de realizar escrituras masivas.
- **FR-021**: El sistema DEBE mantener un catálogo de proveedores que diferencie proveedores activos e inactivos.
- **FR-022**: El sistema DEBE permitir consultar o exportar el nombre, dominio e identificación fiscal del proveedor, dejando vacíos los datos no acreditados.
- **FR-023**: El sistema DEBE conservar las facturas históricas cuando un proveedor sea desactivado o eliminado del catálogo habitual.
- **FR-024**: El sistema DEBE calcular el número de facturas procesadas por mes a partir de la fecha de emisión.
- **FR-025**: El sistema DEBE calcular por separado la media de meses completos cuando el periodo incluya un mes en curso.
- **FR-026**: El sistema DEBE comparar facturas y cargos bancarios por moneda, importe y evidencia contextual suficiente.
- **FR-027**: El sistema DEBE aceptar una diferencia máxima de 0,01 en el importe para una posible coincidencia bancaria.
- **FR-028**: El sistema DEBE excluir ingresos y traspasos internos de los cargos pendientes de factura.
- **FR-029**: El sistema DEBE distinguir una factura no encontrada en los extractos aportados de una factura impagada.
- **FR-030**: El sistema DEBE identificar los cargos bancarios relevantes para los que no exista una factura registrada.
- **FR-031**: El reporte de conciliación DEBE indicar el periodo y las fuentes bancarias consideradas.
- **FR-032**: El sistema DEBE mantener en revisión las notas de crédito y los abonos hasta que exista una regla contable aprobada. **[NECESITA ACLARACIÓN: qué estados, datos y reglas de archivo deben aplicarse a notas de crédito, abonos y facturas rectificativas]**
- **FR-033**: El sistema DEBE resolver conciliaciones de un pago contra varias facturas o de varios pagos contra una factura. **[NECESITA ACLARACIÓN: deben incluirse estas conciliaciones en esta feature o tratarse en una especificación posterior]**

### Entidades clave

- **Correo de origen**: mensaje recibido que aporta remitente, asunto, fecha, referencia y uno o varios adjuntos.
- **Documento adjunto**: PDF candidato a clasificación; conserva su nombre original, su relación con el correo y su resultado de revisión.
- **Factura de gasto**: documento validado que representa una obligación o gasto de la empresa; contiene proveedor, identificación fiscal cuando exista, número, fecha, importe total y moneda.
- **Proveedor**: entidad emisora de la factura; mantiene nombre canónico, aliases acreditados, identificación fiscal, dominios confirmados y estado activo o inactivo.
- **Registro documental**: evidencia del procesamiento de un documento; relaciona origen, datos extraídos, estado, motivo, archivo y referencias disponibles.
- **Lote de procesamiento**: conjunto acotado de correos o documentos revisados en una ejecución; conserva alcance, resultados, errores y punto de continuidad.
- **Archivo de factura**: copia conservada de una factura válida, identificada mediante un nombre normalizado y organizada por el periodo de emisión.
- **Movimiento bancario**: apunte aportado para conciliación; contiene fecha, concepto, importe, moneda y clasificación como cargo, ingreso o traspaso.
- **Coincidencia de conciliación**: relación sustentada entre una factura y uno o varios movimientos, con el resultado y la evidencia que justifican la decisión.
- **Métrica mensual**: recuento de facturas procesadas por mes y media calculada para un periodo claramente definido.

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: El 100 % de los PDF revisados recibe un estado y, cuando corresponde, un motivo comprensible de revisión o descarte.
- **SC-002**: El 100 % de las facturas marcadas como `PROCESADA` dispone de proveedor, número, fecha válida, importe total positivo y moneda acreditados.
- **SC-003**: Ninguna factura se archiva más de una vez dentro del histórico controlado.
- **SC-004**: El 100 % de las facturas procesadas puede rastrearse hasta su archivo y hasta su correo de origen cuando la fuente proporcione esa referencia.
- **SC-005**: Ningún documento dudoso, factura de venta o documento que no sea factura se incorpora automáticamente al archivo de gastos.
- **SC-006**: El 100 % de los lotes completados deja un punto de continuidad y un resumen de resultados que permite reanudar sin repetir trabajo.
- **SC-007**: El 100 % de los datos incluidos en el listado de proveedores dispone de evidencia; los campos no acreditados permanecen vacíos.
- **SC-008**: Los recuentos mensuales cuadran con el número de facturas `PROCESADA` cuya fecha de emisión pertenece a cada mes informado.
- **SC-009**: El 100 % de las conciliaciones distingue entre coincidencia encontrada, no encontrada en los extractos aportados y cargo sin factura registrada.
- **SC-010**: Ninguna factura se etiqueta como impagada únicamente por no aparecer en un extracto parcial.
- **SC-011**: Cada informe de conciliación identifica el periodo y la cobertura bancaria utilizados, de modo que el responsable pueda interpretar sus límites.

## Suposiciones

- Gmail continúa siendo la fuente principal de correos y adjuntos de facturas de gasto.
- Existe un archivo documental de la empresa con una carpeta específica para facturas de gasto y organización por año, trimestre y mes.
- Existe un registro de control con áreas diferenciadas para configuración, proveedores, facturas y actividad.
- El responsable de administración tiene autoridad para aprobar lotes, activar o desactivar proveedores y resolver revisiones manuales.
- Los proveedores utilizados para identificación automática están marcados como activos y sus datos han sido validados previamente.
- La fecha de emisión, no la fecha del correo ni la fecha de pago, determina el mes de archivo y el recuento mensual.
- La métrica principal de volumen cuenta únicamente facturas con estado `PROCESADA`.
- Los importes de las facturas representan el total final con impuestos incluidos.
- La ausencia de un movimiento coincidente solo describe lo observado en las fuentes bancarias aportadas.
- Los extractos bancarios pueden no cubrir todas las cuentas, tarjetas, efectivo o fechas de pago utilizadas por la empresa.
- Las facturas históricas de un proveedor se conservan aunque ese proveedor deje de utilizarse.
- El histórico validado hasta el 20 de julio de 2026 sirve como línea base de aceptación: 474 documentos registrados, de los que 177 constaban como procesados, 208 como no factura, 45 como duplicados ignorados y 44 como revisión manual.
- La ejecución histórica archivó 159 facturas aprobadas sin errores de subida, duplicados creados ni enlaces ausentes.

## Aclaraciones pendientes

1. **Tratamiento de documentos rectificativos**: definir cómo se validan, archivan, contabilizan y concilian las notas de crédito, los abonos y las facturas rectificativas.
2. **Conciliaciones múltiples**: confirmar si esta primera feature debe admitir varios pagos para una factura y pagos agrupados para varias facturas, o si se especificará por separado.
