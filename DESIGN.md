# DESIGN.md · Gestión de facturas para MicroPymes

**Producto**: aplicación web responsive de gestión de facturas de gasto

**Plataforma**: navegador de escritorio y móvil; añadible a la pantalla de inicio, sin modo offline

**Público**: responsables de administración y contabilidad de microempresas

**Idioma**: español

## Principios

- **Claridad sobre decoración.** La información fiscal debe poder comprobarse rápidamente.
- **Control humano visible.** Ningún documento dudoso se archiva sin una decisión explícita.
- **Estados reconocibles.** Cada estado combina texto, color e icono.
- **Trazabilidad.** El PDF y el correo de origen permanecen accesibles desde el detalle.
- **Uso adaptable.** La navegación lateral de escritorio se convierte en navegación inferior móvil, manteniendo objetivos táctiles amplios.

## Pantallas seleccionadas

1. **Facturas de gasto**: dashboard explicativo y pantalla estrella; comunica de inmediato que la app localiza facturas PDF en el correo, valida sus datos y duplicados, solicita revisión humana y las archiva por fecha y proveedor.
2. **Revisión manual**: bandeja de documentos que requieren intervención.
3. **Detalle de factura**: contraste de evidencia y validación de campos.
4. **Aprobar lote**: confirmación segura antes del archivo masivo.

## Color

### Base

| Token | Valor | Uso |
|---|---:|---|
| `background` | `#FFFFFF` | Fondo principal |
| `surface` | `#FFFFFF` | Tarjetas y barras |
| `surface-muted` | `#F5F7F7` | Fondos secundarios |
| `border` | `#DDE2E3` | Separadores y contornos |
| `text-primary` | `#3B4443` | Títulos, etiquetas e importes |
| `text-secondary` | `#505C5F` | Metadatos y ayudas |
| `primary` | `#0062FF` | Acciones, enlaces y navegación activa |
| `primary-secondary` | `#00A9FF` | Selección y progreso |
| `primary-light` | `#00C4FF` | Acentos informativos |

No se usan degradados ni fondos ornamentales. El blanco mantiene la interfaz limpia y los azules crean una jerarquía funcional.

### Estados documentales

| Estado | Fondo | Texto | Acento |
|---|---:|---:|---:|
| `PROCESADA` | `#DCFCE7` | `#14532D` | `#16A34A` |
| `REVISIÓN MANUAL` | `#FEF3C7` | `#78350F` | `#D97706` |
| `DUPLICADO IGNORADO` | `#F3E8FF` | `#4C1D95` | `#7C3AED` |
| `NO ES FACTURA` | `#F1F5F9` | `#334155` | `#64748B` |
| `FACTURA DE VENTA` | `#E0F2FE` | `#0C4A6E` | `#0284C7` |

## Tipografía

- **Familia**: Montserrat.
- **Pesos**: Regular 400, SemiBold 600 y Bold 700.
- **Cuerpo**: 15–17 px con 24 px de altura de línea.
- **Título de pantalla**: 24–32 px, Bold.
- **Metadatos y chips**: 11–13 px, Regular o SemiBold.
- Los importes usan Montserrat SemiBold, cifras tabulares y alineación a la derecha cuando aparecen en listas.

## Espaciado y geometría

- Retícula basada en múltiplos de 4 px.
- Margen lateral de pantalla: 16 px.
- Separación habitual entre bloques: 16, 24 o 32 px.
- Tarjetas: radio de 12 px y borde fino.
- Botones e inputs: radio de 8 px.
- Objetivo táctil mínimo: 44 × 44 px.
- Botón principal: mínimo 48 px de alto; 56 px cuando ocupa la barra inferior.
- Se respetan las áreas seguras superior e inferior del dispositivo.

## Componentes

### Mesa semanal

La tarea principal se organiza como una secuencia estable de cuatro pasos: **Capturar**, **Validar**, **Conciliar** y **Cerrar**. La interfaz muestra el paso actual, lo pendiente y la siguiente acción disponible, sin ocultar incidencias ni permitir que el cierre se confunda con una revisión incompleta.

### Mapa de cobertura multifuente

La cobertura se presenta por fuente y periodo para distinguir con claridad que se ha consultado, que falta y que requiere atencion. Un resumen global nunca sustituye el desglose por fuente; los vacios de cobertura se muestran como estado verificable, no como ausencia silenciosa de resultados.

### Bandeja de conciliacion

La conciliacion usa una bandeja de trabajo que agrupa coincidencias propuestas, diferencias y elementos sin pareja. Cada fila conserva acceso a ambas evidencias, explica el motivo de la propuesta y permite confirmar o descartar de forma individual antes de aplicar acciones en lote.

### Estados seguros

Los estados distinguen como minimo entre **pendiente**, **requiere revision**, **confirmado** y **descartado**. Toda transicion sensible es explicita, reversible cuando sea posible y deja trazabilidad. La interfaz no interpreta silencio, falta de evidencia o cobertura parcial como confirmacion.

### Botones

- **Primario**: fondo `primary`, texto blanco y verbo de acción directo.
- **Secundario**: fondo blanco, borde `primary` y texto `primary`.
- **Destructivo**: rojo semántico y confirmación previa obligatoria.
- No se usa botón flotante; cada acción se presenta en su contexto.

### Tarjetas de factura

- Muestran proveedor o nombre de archivo, fecha, importe y estado.
- El importe y el estado se reconocen sin abrir el detalle.
- La tarjeta completa puede actuar como objetivo táctil.

### Chips de estado

- Conservan las denominaciones exactas de `spec.md`.
- Incluyen texto y señal visual; nunca dependen solo del color.
- Usan mayúsculas, peso SemiBold y radio de 6 px.

### Navegación

En escritorio se usa navegación lateral completa. En móvil la barra inferior mantiene cinco destinos: **Inicio**, **Procesar**, **Revisión**, **Facturas** y **Más**. La pestaña activa usa `primary`; las demás usan `text-secondary`.

## Tono de interfaz

- Español directo, profesional y comprensible.
- Verbos en infinitivo para las acciones: “Revisar”, “Confirmar”, “Aprobar”.
- Mensajes cortos que explican el motivo y el siguiente paso.
- No se afirma que una factura está pagada o impagada sin evidencia.
- No se inventan datos fiscales, proveedores, números ni resultados.
- Las acciones masivas indican cuántos documentos afectan y conservan los originales.

## Accesibilidad

- Contraste mínimo de 4,5:1 para texto normal y 3:1 para texto grande.
- Estados expresados mediante texto, color e icono.
- Etiquetas visibles en formularios; el placeholder no sustituye a la etiqueta.
- Tipografía legible al tamaño real de pantalla.
- Controles táctiles de al menos 44 × 44 px.

## Verificación de pantallas

Cada cambio de interfaz se comprueba al menos en escritorio y móvil reales. El mapa de cobertura debe mostrar todas las fuentes y periodos sin depender de desplazamiento horizontal oculto, y la primera vista debe priorizar una única acción recomendada.
