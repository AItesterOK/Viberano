# ReparaPRO Gastos

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

La persona principal es el responsable de administración de ReparaPRO, que revisa semanalmente las facturas de gasto recibidas, resuelve excepciones, contrasta pagos y prepara la documentación mensual para la gestoría. Inicialmente accede únicamente `compras@reparapro.com`.

## Product Purpose

Localizar facturas de gasto recibidas desde el 1 de enero de 2026, extraer solo datos acreditados, impedir duplicados, someter las dudas a revisión humana y conservar una cadena verificable entre correo, PDF, registro, archivo y movimiento bancario.

El producto tiene éxito cuando el usuario puede saber rápidamente qué periodos están cubiertos, cuál es la siguiente decisión necesaria y qué impide completar el cierre documental de un mes.

## Positioning

Su mecanismo distintivo es un mapa de cobertura documental y bancaria que conserva recorridos separados, huecos y extractos parciales. La ausencia de coincidencia dentro de una cobertura limitada nunca se presenta como impago.

## Operating Context

- Gmail `compras@reparapro.com` en modo de solo lectura.
- Google Sheets `ReparaPRO Docs` como registro canónico y auditable.
- Google Drive para conservar facturas, extractos y exportaciones mensuales.
- Revisión semanal en lotes pequeños, con aprobación humana antes de escrituras definitivas.
- Extractos bancarios incorporados manualmente mediante XLSX o CSV.

## Capabilities and Constraints

- Clasifica facturas, notas de crédito, documentos no contables, duplicados y facturas de venta.
- Permite revisar campos, crear o asociar proveedores, marcar proveedores no habituales y conservar borradores.
- Admite conciliaciones 1:1, 1:N, N:1, pagos parciales, exclusiones justificadas y deshacer.
- Mantiene originales, auditoría e idempotencia; nunca sobrescribe archivos.
- No modifica Gmail, no contabiliza, no paga, no conecta bancos directamente y no usa servicios de pago.
- Las reglas y coincidencias son propuestas: nunca crean, aprueban ni concilian automáticamente.
- Funciona exclusivamente online mediante React y Google Apps Script.

## Brand Commitments

Nombre: ReparaPRO Gastos. Voz española directa, profesional y comprensible. Se conserva la identidad oficial ReparaPRO, Montserrat, el azul de acción y los estados con texto, icono y color. No se copiará la identidad visual de Banktrack.

## Evidence on Hand

- `spec.md` contiene el flujo documental y los criterios de seguridad aprobados.
- `DESIGN.md` contiene la identidad y los patrones visuales actuales.
- La aplicación y sus pruebas locales incluyen datos sintéticos; ningún dato bancario o PDF real se incorpora al repositorio.
- Los estados reales permanecen en Gmail, Drive y `ReparaPRO Docs` y deben verificarse antes de afirmar cobertura o completar una migración.

## Product Principles

1. Evidencia antes que inferencia.
2. La siguiente acción debe ser evidente.
3. La cobertura se muestra con sus límites y huecos.
4. Toda automatización propone; una persona decide.
5. Los originales y el histórico se conservan íntegros.

## Accessibility & Inclusion

Contraste AA, navegación por teclado, controles táctiles de al menos 44 × 44 px y estados que nunca dependan únicamente del color.
