# Auditoría de features de WANT

Fecha: 7 de junio de 2026  
Perspectiva: dueño de un restaurante que necesita operar un servicio completo sin perder ventas, comandas, stock ni control.

## Veredicto ejecutivo

WANT ya tiene la forma de un sistema operativo para restaurantes, no solamente de un menú QR. El núcleo visible es amplio: mesas, pedidos, cocina, barra, runner, caja, facturación, menú, stock, promociones, personal, analytics, reservas, espera y turnos.

El problema principal no es que falten muchas features. Es que varias features actuales no cierran su promesa de punta a punta. Hoy yo no pondría el sistema como fuente única de verdad de un restaurante hasta resolver los P0, porque hay caminos donde el cliente ve un precio y se cobra otro, una cancelación no llega a cocina ni stock, o una acción crítica parece registrada pero falla.

### Orden recomendado

1. Hacer verdaderos los importes, cancelaciones, pagos y auditoría.
2. Cerrar los flujos diarios entre salón, cocina, runner y caja.
3. Integrar reservas, espera y turnos con la operación existente.
4. Recién después profundizar analytics y optimización.

## P0: problemas que bloquean una operación real

### 1. El carrito puede perderse al navegar

Cada ruta de cliente monta su propio `CartProvider` en `src/App.tsx`. Al pasar de Menú a Carrito cambia el provider y el estado puede reiniciarse.

**Impacto para mí como dueño:** clientes que arman el pedido y llegan a un carrito vacío.

**Mejora:** un único `CartProvider` que envuelva todo el flujo cliente y persistencia temporal por restaurante + mesa + sesión.

### 2. Las promociones muestran un precio y el servidor cobra otro

`useMenuData` modifica el precio mostrado para promociones normales, pero `api/create-order.ts` vuelve a leer `menuData.price` y guarda el precio base. Además, Caja solamente calcula 2x1; no aplica las promociones normales.

**Impacto:** reclamos, diferencias en caja y riesgo de cobrar más que lo anunciado.

**Mejora:** motor único de precios en backend. El pedido debe guardar precio base, promoción aplicada, descuento y precio final. Menú, cuenta, caja, factura y analytics deben leer ese mismo resultado.

### 3. Cancelar un ítem no cancela realmente su operación

Caja agrega `cancelledItems`, pero Cocina y Barra no los excluyen, el endpoint de cuenta no los descuenta, no se devuelve stock y la facturación/analytics pueden seguir contándolos.

**Impacto:** preparo comida cancelada, pierdo materia prima y sobreestimo ventas.

**Mejora:** cancelación transaccional con estado por ítem, motivo, actor, aviso inmediato a estación, devolución de stock según etapa y recálculo de cuenta/factura/reportes.

### 4. Auditoría está rota para varias acciones

Las reglas exigen `actorUid`, pero `createAuditLog` no lo escribe. Muchas acciones actualizan primero el estado y luego intentan auditar, por lo que pueden mostrar error aunque el cambio ya ocurrió. A la vez, la UI permite al admin borrar logs, pero las reglas sólo se lo permiten al superadmin.

**Impacto:** no puedo confiar en el historial ni investigar diferencias.

**Mejora:** contrato único de audit log, escritura atómica con la acción, etiquetas para todas las acciones y UI alineada con permisos reales.

### 5. Caja no representa una caja real

La apertura, ajustes y cierre viven principalmente en `localStorage`. No hay una sesión de caja compartida y persistida por terminal/usuario. El cierre se registra como audit log, no como cierre contable consultable.

**Impacto:** si cambia el dispositivo, se limpia el navegador o trabajan dos cajeros, pierdo el control.

**Mejora:** sesión de caja persistida en backend, apertura/cierre, responsable, arqueo esperado vs. contado, diferencia, retiros/ingresos y bloqueo de cobro sin caja abierta.

### 6. Runner puede marcar una cuenta como pagada sin registrar el cobro

Runner pasa una cuenta de `en_camino` a `pagada` sin monto, medio real, comprobante ni control de caja.

**Impacto:** una mesa puede quedar “pagada” sin que exista dinero registrado.

**Mejora:** Runner puede entregar precuenta y solicitar cobro, pero solamente Caja debería confirmar pago, salvo un flujo explícito de cobro móvil que registre todos los datos.

### 7. “Dividir cuenta” no divide la cuenta

Para el cliente es un booleano y en Caja es una calculadora visual. Caja exige cobrar como mínimo todo el saldo restante, por lo que no permite pagos parciales reales ni múltiples medios.

**Impacto:** el caso cotidiano de “cada uno paga lo suyo” no se puede operar.

**Mejora:** pagos parciales acumulables, división por partes o por productos, múltiples medios, propina por pago y saldo restante consistente.

### 8. Combos y modificadores parecen existir, pero no operan

Los modificadores se configuran y muestran, pero el cliente no puede elegirlos ni llegan al pedido. Los combos guardan subítems, pero backend los trata como un único ítem de cocina y no enruta sus componentes ni consume sus recetas.

**Impacto:** la configuración promete algo que cocina, barra y stock no reciben.

**Mejora:** selección obligatoria/opcional de modificadores con precio y receta; explosión de combos en componentes operativos sin perder su precio comercial.

## Auditoría feature por feature

## 1. Menú QR y experiencia del cliente — Madurez: 2/5

**Lo valioso actual:** branding, categorías, imágenes, horarios, alérgenos, promociones visibles, notas, asistencia y stock validado en servidor.

**Qué me falta como dueño:**

- Garantizar que el carrito sobreviva toda la navegación y una recarga accidental.
- Mostrar al cliente el mismo precio final que después llega a Caja.
- Permitir elegir modificadores y variantes, no sólo ver sus nombres.
- Mostrar combos correctamente y mandar cada componente a su estación.
- Actualización en tiempo real cuando pauso un plato o cambio precio.
- Evitar que anónimos vean platos agotados hasta recién fallar al enviar el pedido.
- Estado del pedido visible para el cliente: recibido, preparando, listo/entregado.
- Protección contra pedidos duplicados por reintentos o mala conexión.

**Criterio de terminado:** nunca se pierde el carrito, nunca cambia el precio al cobrar y todo lo elegido por el cliente llega idéntico a cocina/barra/caja.

## 2. Pedidos y comandas — Madurez: 2/5

**Lo valioso actual:** sesión por mesa, bloqueo al pedir cuenta, separación cocina/barra y validación transaccional de stock.

**Qué falta:**

- Idempotencia: un mismo envío/reintento no debe crear dos pedidos.
- Estados por ítem, no solamente por pedido completo.
- Prioridad, curso/paso, “demorar”, “salir junto” y hora prometida.
- Edición/cancelación consistente antes y después de empezar preparación.
- Identificar origen: cliente QR, caja, mozo, admin.
- Reabrir o corregir un pedido marcado listo por error.
- Conservar historial de transiciones y tiempos por ítem.

**Criterio de terminado:** una excepción no obliga a cancelar o demorar toda la comanda y cada cambio deja trazabilidad.

## 3. Cocina — Madurez: 3/5

**Lo valioso actual:** tiempo real, sonido, wake lock, timers, alertas por demora, observaciones y flujo pendiente → preparando → listo.

**Qué falta:**

- Excluir y destacar inmediatamente ítems cancelados.
- Manejar parcialmente una comanda: un plato listo y otro demorado.
- Estaciones dentro de cocina: parrilla, fritura, frío, pastelería.
- Prioridad manual y coordinación “todo junto”.
- Vista de comandas listas recientes para corregir errores.
- Aviso claro si el pedido cambió después de empezar.
- Límites/alertas configurables por categoría, no tiempos fijos globales.

**Criterio de terminado:** cocina nunca prepara algo cancelado y puede manejar demoras parciales sin perder el ticket.

## 4. Barra — Madurez: 3/5

Tiene las mismas fortalezas y faltantes que Cocina.

**Mejoras específicas:**

- Separar bebidas simples de preparación y tragos.
- Poder despachar parcialmente.
- Mostrar modificadores reales: sin hielo, medida, marca, garnish.
- Descontar insumos y botellas con una unidad coherente.

**Criterio de terminado:** la barra puede despachar una parte sin cerrar todo y sus consumos impactan correctamente en stock.

## 5. Runner, entregas y asistencia — Madurez: 2.5/5

**Lo valioso actual:** une comida, bebida, cuentas y llamadas; tiene alertas sonoras y entregas parciales.

**Qué falta:**

- “Tomar tarea” para evitar que dos runners atiendan lo mismo.
- Estados pendiente → asignado → en camino → resuelto.
- Responsable y tiempo de resolución por tarea.
- Prioridad y agrupación por zona.
- No limitar la operación a los últimos 50 pedidos/cuentas: un activo viejo puede desaparecer.
- No permitir marcar pagos sin registrar el cobro.
- Evitar llamadas duplicadas de la misma mesa mientras una sigue pendiente.
- Más contexto en asistencia y posibilidad de responder “no disponible”.

**Criterio de terminado:** cada tarea tiene dueño, estado y tiempo, y ninguna desaparece por volumen.

## 6. Mesas, sesiones y panel operativo — Madurez: 3/5

**Lo valioso actual:** estados libre/ocupada/limpieza, sesiones, zonas, QR, historial, consumo y prioridades.

**Qué falta:**

- Capacidad de cada mesa y validación de cantidad de comensales.
- Transferir una mesa, unir/separar mesas y mover una cuenta.
- Evitar cerrar una sesión o mandar a limpieza si hay cuenta impaga o pedidos activos.
- Plano visual del salón o, como mínimo, vista operativa por zona.
- Responsable/mozo asignado a mesa.
- Tiempo ocupada, tiempo desde última atención y próxima reserva.
- Apertura manual segura por staff, no sólo al escanear QR.
- Historial que use total final real, no total original.

**Criterio de terminado:** mover o cerrar una mesa nunca pierde pedidos, deuda ni trazabilidad.

## 7. Caja y cobros — Madurez: 3/5 por amplitud, 1.5/5 por integridad contable

**Lo valioso actual:** cobro, descuentos, extras, propina, vuelto, impresión, factura, reapertura, notas y cancelación.

**Qué falta:**

- Sesión de caja persistida y compartida.
- Pagos parciales y mixtos reales.
- El monto recibido en efectivo debe calcular vuelto, pero el pago guardado debe ser el importe exacto adeudado.
- Persistir el total final con descuentos/2x1/cancelaciones; hoy analytics puede usar el total original.
- Aprobación o permiso especial para descuentos, reaperturas y cancelaciones.
- Reembolsos y anulaciones después del cobro.
- Cuentas manuales con ítems persistidos y envío opcional a cocina/barra.
- Cerrar correctamente cuentas manuales, que hoy pueden quedar visibles al no tener sesión.
- Arqueo contado vs. esperado, diferencia y firma/responsable.
- Registro de intentos fallidos y referencia de transferencias/tarjetas.

**Criterio de terminado:** ventas, efectivo, medios de pago, factura y analytics dan exactamente el mismo total.

## 8. Facturación electrónica / ARCA — Madurez: 3/5

**Lo valioso actual:** onboarding de certificado, homologación/simulación/producción, solicitud, emisión y CAE.

**Qué falta:**

- Emitir sobre el total final real después de descuentos y cancelaciones.
- Notas de crédito/anulación y relación con la factura original.
- Reintentos claros, cola de pendientes y alertas de certificados por vencer.
- Validar datos fiscales según tipo de comprobante antes de cobrar.
- Reporte/exportación para contador y conciliación diaria.
- Evitar una segunda “facturación manual” paralela que pueda contradecir ARCA.

**Criterio de terminado:** cualquier corrección de Caja tiene un camino fiscal correcto y trazable.

## 9. Gestión de menú — Madurez: 3/5

**Lo valioso actual:** alta/edición, imágenes, categorías, tipos, recetas, horarios, alérgenos, combos y modificadores.

**Qué falta:**

- Hacer operativos combos, variantes y modificadores en cliente/backend/estaciones.
- Administrar categorías como entidades ordenables; hoy son texto libre y pueden duplicarse.
- Referenciar promociones por ID de producto, no por nombre.
- Programar cambios de precio/activación y tener historial.
- Duplicar productos y edición masiva para cambios de carta.
- Validar que un producto de Barra/Cocina tenga receta y ruteo coherentes.
- Mostrar margen con conversiones correctas de unidades.

**Criterio de terminado:** toda configuración visible produce el mismo comportamiento en venta, producción y stock.

## 10. Stock y recetas — Madurez: 2.5/5

**Lo valioso actual:** insumos, mínimos, costos, proveedor, recetas, esenciales/secundarios y descuento transaccional al pedir.

**Qué falta:**

- Kardex/movimientos con cantidad, motivo, actor y costo.
- Ajustes por cantidades reales; hoy la operación rápida es sólo +1/-1.
- Editar mínimos, costo, proveedor, unidad y notas luego de crear.
- Devolución automática por cancelaciones según etapa.
- Merma, desperdicio, consumo interno e inventario físico.
- Conversión correcta para costo/margen entre kg↔g y l↔ml.
- Consumo correcto de componentes de combos y modificadores.
- Alertas accionables y lista de reposición por proveedor.
- Separar stock disponible, comprometido y consumido.

**Criterio de terminado:** puedo explicar por qué cambió cada insumo y reconciliar stock teórico contra conteo físico.

## 11. Promociones y 2x1 — Madurez: 1/5

**Lo valioso actual:** horarios, días, alcance por producto/categoría/todo el menú y visibilidad al cliente.

**Qué falta:**

- Motor único server-side para garantizar precio final.
- Aplicar promociones normales en Caja; hoy sólo se calcula 2x1.
- Persistir promoción aplicada en pedido/cuenta/factura/analytics.
- Definir acumulación y prioridad entre promociones.
- Editar, pausar y duplicar; hoy principalmente se crean o eliminan.
- Usar IDs de producto/categoría, no nombres.
- Validar topes: porcentaje máximo, monto mayor al producto, horario inválido.
- Medir ventas incrementales, descuento otorgado y margen.

**Criterio de terminado:** el precio promocional es idéntico en menú, pedido, precuenta, cobro, factura y reporte.

## 12. Reservas — Madurez: 1/5

**Lo valioso actual:** fecha, hora, personas, teléfono, notas, mesa y confirmación/cancelación.

**Qué falta para resolver mi problema real:**

- Validar mesa existente, capacidad, solapamiento y disponibilidad.
- Duración estimada y turnos/franjas del restaurante.
- Estados: pendiente, confirmada, llegó, sentada, completada, no-show, cancelada.
- Editar/reprogramar, no sólo confirmar o cancelar.
- Sentar una reserva debe abrir/asignar la mesa y sacarla del flujo de reservas.
- Ver próximas llegadas junto al panel de mesas.
- Recordatorios reales y confirmación del cliente.
- Historial por teléfono, notas importantes y no-shows.
- Métricas de ocupación, cancelación y no-show.

**Criterio de terminado:** nunca confirmo dos reservas incompatibles y al llegar el cliente pasa a una mesa sin recargar datos.

## 13. Lista de espera — Madurez: 1/5

**Lo valioso actual:** orden, tiempo esperando, cantidad de personas, teléfono y estado avisado.

**Qué falta:**

- “Avisar” debe enviar realmente WhatsApp/SMS o registrar que se llamó; hoy sólo cambia estado.
- Diferenciar sentado, abandonó, canceló y no respondió. Hoy “sentado/cerrar” termina como cancelado.
- Asignar mesa y abrir sesión al sentar.
- Estimación de espera basada en mesas/capacidad/rotación.
- Priorizar por compatibilidad de tamaño, accesibilidad y zona, no sólo orden.
- Integrar reservas demoradas o walk-ins.
- Permitir alta desde recepción/runner/caja; actualmente la pantalla está dentro de Admin.
- Filtrar por día y archivar; hoy la colección histórica sigue creciendo en la vista.

**Criterio de terminado:** sé quién espera, cuánto prometí, quién fue avisado, quién se sentó y en qué mesa.

## 14. Turnos del personal — Madurez: 1/5

**Lo valioso actual:** entrada, salida, duración, activos y cierre por admin.

**Qué falta:**

- Cada empleado debe poder acceder desde su propia pantalla. Hoy Turnos vive sólo en Admin.
- Guardar el rol real; actualmente inicia con rol genérico `"staff"`.
- Impedir dos turnos abiertos para la misma persona.
- Descansos, correcciones con motivo y aprobación.
- Horas programadas vs. reales, tardanzas y horas extra.
- Auditoría de cierres/correcciones hechos por admin.
- Integrar con login/logout sin convertirlos automáticamente en la misma acción.
- Exportación por período para liquidación.

**Criterio de terminado:** las horas son confiables para pagar y cada corrección tiene responsable.

## 15. Empleados, roles y acceso — Madurez: 2.5/5

**Lo valioso actual:** creación real en Auth, roles, activación, límites por plan y protección del último admin.

**Qué falta:**

- Un empleado puede cumplir más de un rol; hoy sólo puede tener uno.
- Permisos granulares para descuentos, cancelaciones, cierres y reaperturas.
- Cambiar “email visible” también debe cambiar el email de autenticación; hoy puede quedar inconsistente.
- Invitación/reset inicial en vez de que el admin defina y conozca la contraseña.
- Sesiones/dispositivos activos y revocación.
- PIN o cambio rápido de usuario para dispositivos compartidos.
- Acceso a Turnos y tareas transversales sin convertir al empleado en admin.

**Criterio de terminado:** cada persona puede hacer exactamente lo necesario y nada más, con acceso fácil de revocar.

## 16. Performance por empleado — Madurez: 1/5

**Problema actual:** cuenta acciones del audit log, pero no calidad ni resultado; además depende de logs que hoy pueden fallar. En desktop tampoco aparece en el sidebar principal.

**Qué falta:**

- Métricas según rol: preparación, entrega, cobro, resolución y tiempos.
- Separar volumen de calidad: errores, reaperturas, cancelaciones, descuentos.
- Contexto de horas trabajadas para comparar productividad de forma justa.
- Metas y tendencias, no ranking crudo por cantidad de clicks.
- Acceso consistente desde desktop y mobile.

**Criterio de terminado:** ayuda a detectar capacitación/proceso, no a premiar a quien tocó más botones.

## 17. Analytics — Madurez: 2/5

**Lo valioso actual:** ventas, ticket, pagos, productos, tiempos de cocina/barra, rotación y horas pico.

**Qué falta:**

- Fuente de verdad basada en total final cobrado, no cuenta original.
- Excluir cancelaciones y reflejar descuentos, 2x1, propinas, reembolsos y facturas.
- Margen y costo de venta conectados con recetas/stock.
- Comparar períodos y objetivos.
- Exportar datos y cierre diario.
- Métricas de promociones, reservas, espera, no-show, mermas y mano de obra.
- Filtros por zona, categoría, producto, turno y canal.
- Días sin ventas visibles en gráficos, no simplemente ausentes.

**Criterio de terminado:** el total de Analytics coincide con Caja y puedo entender por qué gané o perdí margen.

## 18. Audit log — Madurez: 1/5

**Qué falta además del P0 técnico:**

- Todas las acciones críticas: descuentos, cancelaciones, reaperturas, stock, turnos, reservas y cambios de configuración.
- Filtro por fecha, usuario, mesa, cuenta y búsqueda.
- Exportación y retención definida.
- Antes/después del cambio, no sólo descripción.
- No ofrecer acciones que las reglas no permiten.
- Identidad consistente (`actorUid`/`userUid`) y etiquetas para acciones de Caja.

**Criterio de terminado:** puedo reconstruir una diferencia de caja o una queja sin mirar otras colecciones.

## 19. Branding — Madurez: 3/5

**Lo valioso actual:** nombre, logo, portada, colores, mensaje y preview.

**Qué falta:**

- El botón “Vista previa” debe abrir una preview real.
- Recorte, compresión y eliminación/reemplazo claro de imágenes.
- Bloquear guardado de colores inválidos y advertir contraste ilegible.
- Previsualizar estados reales: menú, plato, carrito y cuenta.
- Datos operativos públicos útiles: horarios, contacto y medios aceptados, si se decide ampliar la misma feature.

**Criterio de terminado:** lo que previsualizo es exactamente lo que verá el cliente.

## 20. Suscripción, planes y onboarding — Madurez: 3/5

**Lo valioso actual:** trial, bloqueo por pago, planes, límites, upgrade/downgrade e historial.

**Qué falta:**

- Mostrar impacto concreto antes de bajar de plan: mesas, staff y features afectadas.
- Estado de pago y facturación SaaS reconciliable/exportable.
- Camino visible de soporte ante bloqueo o webhook fallido.
- Checklist de puesta en marcha operativa, no sólo creación del restaurante.
- Prueba de funcionamiento antes de abrir: pedido → cocina → entrega → caja → cierre.

**Criterio de terminado:** un dueño puede configurar y probar el circuito completo sin asistencia técnica.

## Features nuevas realmente indispensables

Intentaría resolver casi todo mejorando lo existente. Sólo considero indispensable una feature nueva:

### Comanda de mozo / handheld POS

Hoy el restaurante depende del auto-pedido QR o de una intervención limitada desde Caja. Necesito que un mozo pueda abrir una mesa, cargar productos/modificadores, enviar a cocina/barra, agregar rondas y transferir/unir mesas. Sin esto, WANT no puede reemplazar el flujo central de un restaurante que no opera exclusivamente con QR.

No separaría “Host/Recepción”, “Compras” o “Devoluciones” como features nuevas todavía: primero las resolvería profundizando Mesas + Reservas + Espera, Stock y Caja/Facturación respectivamente.

## Roadmap recomendado sin inflar el producto

### Fase 0 — Confiabilidad comercial

- Corregir persistencia del carrito.
- Motor de precios/promociones server-side.
- Cancelación integral por ítem.
- Arreglar audit logs y permisos.
- Caja persistida y pagos reales.
- Quitar pago libre desde Runner.

### Fase 1 — Servicio diario completo

- Comandas por ítem, modificadores y combos operativos.
- Asignación/claim de tareas Runner.
- Transferir/unir mesas y proteger cierres impagos.
- Integrar Reserva/Espera → Mesa.
- Dar acceso real a Turnos por empleado.
- Kardex y devoluciones de stock.

### Fase 2 — Control del dueño

- Total final único para Caja, Factura y Analytics.
- Margen, merma, promociones y mano de obra.
- Reservas/no-show/espera medibles.
- Exportes y cierres diarios confiables.

## Calidad y riesgo técnico observado

- `npm run build`: correcto.
- `npm run lint`: sin errores, 34 warnings.
- `npm test`: pasa, pero existe solamente 1 test de ejemplo.

La falta de tests es especialmente riesgosa en los flujos que mueven dinero y estado: precio promocional, cancelación, devolución de stock, pago, reapertura, cierre de mesa, facturación y permisos. Antes de ampliar features, esos recorridos necesitan pruebas de integración de punta a punta.
