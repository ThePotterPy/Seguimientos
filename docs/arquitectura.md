# Arquitectura y funcionamiento

## Qué resuelve el proyecto

Desarrollé Seguimiento BGH para consultar envíos de Urbano, Andreani y Entregar desde una misma interfaz. Reuní información que estaba distribuida entre tres portales y la presenté con campos comunes: guía, estado, destino, productos y movimientos disponibles.

La aplicación permite consultar un pedido o hasta 20 códigos por lote, ver la evolución del envío, alternar entre resultados de Entregar, copiar un resumen y abrir el seguimiento de origen. También interpreta referencias de cambios y devoluciones. No crea envíos, modifica pedidos, coordina retiros ni confirma entregas por cuenta propia.

## Recorrido de una consulta

```text
Navegador: ingreso del código y selección del transportista
    ↓
API Node.js: validación, límites y selección de la integración
    ↓
Urbano: portal HTML + solicitud de detalle
Andreani: solicitud cifrada + respuesta JSON
Entregar: formulario con cookie de sesión + respuesta HTML
    ↓
Adaptador: extracción de campos e interpretación de estados
    ↓
Respuesta JSON común → ficha, movimientos y resumen del lote
```

1. El navegador envía el código a `/api/track`, junto con el transportista y la cuenta de despacho. La consulta por lote utiliza `/api/track-batch`.
2. El servidor valida formato, tamaño y cantidad de códigos, y aplica una cuota por dirección de conexión. Una selección automática utiliza patrones del código; no consulta a los tres proveedores para descubrir dónde está el envío.
3. El adaptador correspondiente realiza solicitudes HTTPS al proveedor. Los accesos de Andreani y la cookie de Entregar se utilizan en el servidor, no se incluyen en los archivos públicos.
4. El adaptador extrae la información disponible y devuelve un objeto común con `summary`, `detail`, `movements`, `statusCategory` y el enlace de origen. Entregar puede agregar `allOrders` y la clasificación operativa.
5. La interfaz muestra la ficha y guarda hasta ocho búsquedas recientes en el navegador. Al iniciar otra búsqueda, cancela la anterior y evita que una respuesta vieja reemplace el resultado nuevo.

Los estados se obtienen al consultar. No implementé notificaciones automáticas de los proveedores, un proceso de actualización continua ni una base central de envíos. El historial del navegador conserva referencias de búsqueda, no una copia histórica completa de los movimientos.

## Cómo consulto Urbano

Normalizo el código para evitar repetir el prefijo de la cuenta de despacho y lo combino con el shipper, por defecto `004185`. Consulto `https://apis.urbano.com.ar/cespecifica/?tracking=...`.

Aunque el dominio contenga «apis», la respuesta utilizada por este proyecto es una página HTML. Localizo una fila que contiene un atributo `data`, decodifico el JSON incrustado y obtengo el resumen del envío. Después envío un formulario con `accion=getDetalle` y ese resumen a `cespecifica/class/especifica_controller.php`.

De la segunda respuesta extraigo campos como producto, servicio, dirección y teléfono, además de la tabla de movimientos. Conservo el orden recibido del portal y convierto el estado a una categoría común.

**Limitaciones:** dependo de la estructura HTML, los nombres de campos y el controlador del portal. Un cambio del proveedor puede requerir ajustes aunque el sitio siga funcionando para una persona. Si falla la segunda solicitud, puedo mostrar solo el resumen. No descargo firmas, imágenes ni comprobantes; una descripción de producto no equivale a un inventario de SKU.

## Cómo consulto Andreani

Envío el código ingresado en el campo `numeroAndreani`, junto con los identificadores que espera la integración. Serializo esa solicitud como JSON, la cifro con AES-256-CBC, la codifico en Base64 y la envío en el parámetro `payload` de `https://tracking-api.andreani.com/api/v3/Tracking`. La conexión utiliza HTTPS y el encabezado de autorización configurado en el servidor.

La respuesta se interpreta directamente como JSON: el cifrado AES se aplica a la solicitud, no a una etapa de descifrado de la respuesta. Extraigo la guía, el proceso actual, el remitente, la dirección y los eventos de `timelines`. Ordeno los eventos por fecha y reviso el último movimiento para evitar interpretar una incidencia como entrega.

La conexión intenta primero resolver el dominio y dispone de dos IP alternativas. Conserva el nombre del proveedor y la validación del certificado. Estas direcciones también son una dependencia que puede cambiar.

**Limitaciones:** no implementé una consulta adicional para convertir referencias de compra o números de Mercado Libre en guías. Envío el identificador y dependo de que el servicio lo acepte. La descripción de producto procede del contrato y la cantidad de bultos se fija en uno por defecto: no confirman SKU ni paquetes físicos. La integración depende de su autorización, claves y formato de solicitud. HTTP 206, HTTP 404 y una respuesta `null` se interpretan como no encontrado según el comportamiento contemplado por este adaptador.

Consumir un servicio del dominio de Andreani no demuestra que el proyecto tenga un acceso comercial asignado y soportado. Eso debe confirmarse con la logística.

## Cómo consulto Entregar

Reutilizo una cookie de sesión vigente para enviar un formulario de búsqueda rápida al portal de Scriptcase en `svr.entregar.net.ar/e_transport/grid_view_consulta_pedidos/index.php`. El formulario conserva el contexto `script_case_init=491`. No automatizo el ingreso con usuario y contraseña.

Leo el HTML mediante identificadores de campos `id_sc_field_...`. Extraigo los pedidos y las tablas de eventos y productos que ya vienen incluidas en esa respuesta. Uso el primer resultado como principal y presento las demás coincidencias como tramos seleccionables.

Compruebo la sesión cada diez minutos. Cuando se ingresa una nueva cookie, verifico el acceso antes de guardarla en el archivo privado; si falla la verificación o la escritura, conservo la anterior. En Railway, mantener ese archivo entre reemplazos del contenedor requiere un volumen persistente.

**Limitaciones:** la cookie puede vencer aunque exista una comprobación periódica. Los cambios del HTML o del contexto de Scriptcase pueden romper la lectura. No recorro la paginación ni solicito tablas cargadas por separado. La búsqueda es general y el código no vuelve a comprobar que el primer resultado corresponda exactamente a la referencia ingresada. Los eventos conservan el orden del portal. Las cantidades de producto pueden utilizarse o sumarse como bultos, pero esa equivalencia requiere validación operativa.

### Cambios y devoluciones

| Prefijo | Interpretación que aplica el proyecto |
| --- | --- |
| `ZECO` | Entrega original |
| `ZECH` | Despacho del producto de reemplazo |
| `ZRE7` | Retiro por cambio |
| `ZRE2` | Retiro por devolución |

Vinculo ZECH y ZRE7 cuando el campo auxiliar 2 permite identificar exactamente la operación complementaria y no hay contradicciones ni candidatos ambiguos entre los pedidos recibidos. Si la otra operación no vino en la respuesta, no puedo confirmar el vínculo. Tampoco doy por hecho que todos los cambios se gestionen por Entregar.

## Tecnología, organización y controles

Elegí Node.js 22 o posterior con módulos nativos para el servidor. La interfaz utiliza HTML, CSS y JavaScript, sin un framework de componentes. Tailwind CSS y Font Awesome son dependencias de desarrollo; los estilos e iconos generados están incluidos en `public/`.

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `server.js` | Adaptadores de los transportistas, transformación de respuestas y arranque |
| `lib/router.js` | Rutas HTTP, validación, cuota de consultas y acceso a archivos públicos |
| `lib/runtime.js` | Solicitudes HTTPS, cancelación, límites y concurrencia |
| `lib/session.js` | Verificación y persistencia de la sesión de Entregar |
| `lib/config.js` | Carga de configuración y ubicación del archivo privado |
| `public/index.html`, `public/app.js` | Interfaz, consultas, resultados, lotes e historial local |
| `scripts/`, `test/`, `.github/workflows/` | Recursos estáticos, regresiones y verificaciones automáticas |

Los lotes contienen hasta 20 códigos y ejecutan hasta tres tareas a la vez; no usan una consulta masiva del proveedor. Entregar se procesa de a una por su sesión compartida. Cada consulta iniciada tiene un plazo de 25 segundos; las respuestas externas están limitadas a 2 MB. La cuota es de 120 códigos por dirección de conexión en 60 segundos. Detrás de un proxy, varios usuarios pueden compartir esa cuota.

Unifico los estados para facilitar la lectura, conservando el detalle del proveedor. Por ejemplo, `NO ENTREGADO` es incidencia; en Entregar, `RECIBIDO DC` indica depósito y `RENDIDO` cierre administrativo. Ninguno de estos dos últimos significa entrega al cliente.

Para esta versión decidí mantener la API sin autenticación, incluida la ruta que renueva la sesión de Entregar. Proteger esa operación administrativa sigue pendiente antes de ampliar el acceso. Los límites de frecuencia no sustituyen una autorización.

Las pruebas automáticas comprueban el comportamiento con respuestas ficticias. No garantizan que los portales estén disponibles o sigan usando el mismo formato. Antes de una demostración, conviene contrastar pedidos conocidos contra cada portal.

## Qué mejoraría con APIs provistas por las logísticas

Priorizaría una API documentada, con credenciales asignadas a la cuenta, ambientes de prueba y soporte del proveedor. Una API devuelve datos estructurados y reduce la dependencia de etiquetas HTML, formularios y sesiones de navegador. Aun así, requiere manejar permisos, vencimientos, límites, errores y versiones.

| Logística | Posibilidad verificada y siguiente paso |
| --- | --- |
| Urbano | Publica una API REST con seguimiento, incluido seguimiento masivo. Para obtener accesos, su documentación indica gestionar las credenciales a través del ejecutivo de cuentas. Confirmaría los permisos de la cuenta BGH y los datos disponibles. |
| Andreani | Publica un portal de APIs con seguimiento y un entorno de pruebas para clientes. Gestionaría las credenciales correspondientes y contrastaría la API habilitada con el servicio que consumo hoy. |
| Entregar | No tengo confirmada una API disponible para esta cuenta. Solicitaría a su equipo técnico documentación, credenciales y alcance; no presupongo que exista acceso público. |

Podría conservar la interfaz y reemplazar las solicitudes y la transformación de cada adaptador. No sería simplemente cambiar una URL: tendría que mapear identificadores, estados, eventos, productos y errores, y validar casos reales contra el portal. Si el proveedor ofrece notificaciones de eventos, podría implementar actualizaciones automáticas como una etapa adicional.

Una API oficial no garantiza por sí sola acceso a referencias BGH, vínculos de cambios, SKU, cantidades o comprobantes. Esos campos y los costos, permisos y límites deben confirmarse con cada logística. Esta migración es una propuesta, no una función implementada.

Fuentes oficiales consultadas el 21 de octubre de 2026: [API REST de Urbano](https://integrate.urbano.com.ar/docs/api/es) y [Andreani Developers](https://developers.andreani.com/). El funcionamiento actual descrito en esta guía está contrastado con el código del proyecto.

Para más detalle: [integraciones](integraciones.md) y [configuración y operación](operacion.md).
