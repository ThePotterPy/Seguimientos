# Integraciones

Para el recorrido completo de una consulta, la tecnología utilizada y las posibilidades de migración a APIs oficiales, ver [arquitectura y funcionamiento](arquitectura.md).

El navegador consulta la API del proyecto. El servidor envía la petición al transportista, interpreta su respuesta y devuelve una ficha con campos comunes.

## Urbano

1. Normaliza el pedido y el prefijo de la cuenta de despacho.
2. Consulta `apis.urbano.com.ar/cespecifica/` con el identificador de seguimiento.
3. Lee el JSON incluido en el atributo `data` de una fila HTML.
4. Solicita `getDetalle` a `cespecifica/class/especifica_controller.php` y extrae campos descriptivos y movimientos.

El resumen puede incluir guía, estado, fecha, servicio, peso y bultos. El detalle puede agregar dirección, teléfono y movimientos con sucursal, zona y repartidor. La integración conserva el orden de movimientos recibido del portal.

Si falla la consulta del detalle, puede devolverse el resumen sin el historial completo. El código no descarga firmas, imágenes ni comprobantes. La descripción de producto no garantiza un desglose de SKU.

## Andreani

El adaptador envía el código ingresado en `numeroAndreani`, junto con los identificadores requeridos por la integración. Cifra la solicitud con AES-256-CBC y consulta `tracking-api.andreani.com/api/v3/Tracking` por HTTPS con la autorización configurada.

La respuesta JSON puede incluir guía, remitente, servicio, estado, dirección y eventos. El adaptador ordena los eventos por fecha. Intenta resolver el dominio y conserva dos IP alternativas de la integración, con Host/SNI del proveedor y verificación de certificado.

No hay una consulta separada que convierta referencias de compra en guías: la aceptación del código depende del proveedor. La descripción de producto utiliza información del contrato y los bultos se muestran como uno por defecto. Esos campos no confirman SKU ni cantidad física de paquetes.

La integración trata HTTP 206, HTTP 404 y una respuesta `null` como envío no encontrado, según el comportamiento registrado para este proveedor. Otros estados HTTP se presentan como fallos de consulta.

## Entregar

El adaptador reutiliza una cookie de sesión vigente para enviar un formulario al buscador de Scriptcase en `svr.entregar.net.ar/e_transport/grid_view_consulta_pedidos/index.php`. No automatiza el ingreso con usuario y contraseña.

El parser identifica los campos de cada pedido y las tablas de eventos y productos incluidas en la misma respuesta. No recorre la paginación ni solicita tablas que el portal cargue por separado. El primer resultado se usa como principal y las demás coincidencias se presentan como tramos.

La búsqueda general puede devolver varias coincidencias. El código no comprueba de nuevo que la primera sea una coincidencia exacta del pedido. El formulario conserva `script_case_init=491`; ese contexto puede requerir ajustes si cambia el portal o su sesión.

Los movimientos conservan el orden del HTML recibido. El campo de cantidad de producto se utiliza como bultos y puede sumarse si falta un total. La equivalencia entre unidades y paquetes requiere validación operativa.

### Referencias de operación

| Prefijo | Interpretación del proyecto |
| --- | --- |
| `ZECO` | Entrega original |
| `ZECH` | Despacho por cambio |
| `ZRE7` | Retiro por cambio |
| `ZRE2` | Retiro por devolución |

El campo auxiliar 2 puede identificar la operación complementaria. La vinculación de ZECH y ZRE7 exige identificadores exactos, sin contradicciones ni candidatos ambiguos entre los pedidos recibidos.

No mostrar un vínculo no demuestra que no exista un cambio: el otro tramo puede no estar incluido en esa respuesta.

## Interpretación de datos

Los estados de cada proveedor se convierten a categorías comunes. `NO ENTREGADO` se interpreta como incidencia. En Entregar, `RECIBIDO DC` significa recepción en depósito y `RENDIDO` significa cierre administrativo. Estos dos últimos no suman como entregas al cliente en el resumen del lote.

Para validar una integración, comparar pedidos conocidos contra el portal de origen. Revisar estado, guía, fechas, orden de eventos y cantidades. Las pruebas automáticas utilizan respuestas ficticias y no certifican la disponibilidad actual de los proveedores.
