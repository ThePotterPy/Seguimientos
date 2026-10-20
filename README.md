# SEGUIMIENTO BGH

Portal de consulta de envíos de Urbano, Andreani y Entregar. La API se mantiene sin autenticación por decisión del operador.

## Ejecutar

Requiere Node.js 22 o posterior. Los estilos e iconos compilados están incluidos: para ejecutar el servidor no se necesita instalar paquetes.

1. Copiar `.env.example` a `.env` y configurar la conexión de Andreani. `.env` se carga automáticamente y está ignorado por Git.
2. Ejecutar `npm start` o `iniciar.bat`.
3. Abrir `http://localhost:3333`.

Para desarrollo de estilos y verificaciones:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

Las dependencias de desarrollo tienen versiones fijadas y archivo de bloqueo. Tailwind y Font Awesome se generan/actualizan con `npm run build`; el navegador carga los recursos desde el propio servidor. La tipografía utiliza fuentes disponibles en el sistema.

## Configuración privada

- `ANDREANI_AUTHORIZATION`: autorización del proveedor.
- `ANDREANI_AES_KEY`: clave del protocolo, exactamente 32 bytes UTF-8.
- `ANDREANI_AES_IV`: IV del protocolo, exactamente 16 bytes UTF-8.
- `ENTREGAR_COOKIE`: sesión inicial opcional. Se utiliza si todavía no hay archivo privado.
- `ENTREGAR_SESSION_FILE`: ruta del archivo privado de sesión. Por defecto `.private/entregar-session.json`.
- `PORT`: puerto, por defecto 3333.
- `HOST`: dirección de escucha, por defecto `0.0.0.0`. Usar `127.0.0.1` para acceso exclusivo desde este equipo.

Una renovación verificada y guardada prevalece sobre `ENTREGAR_COOKIE`, incluso tras reiniciar. La sesión candidata se comprueba antes de reemplazar la vigente; un fallo de verificación o escritura conserva la anterior. El ping cada diez minutos comprueba la sesión, pero no garantiza que el proveedor la mantenga vigente.

No versionar `.env`, `.private` ni archivos de sesión. Eliminar un secreto del estado actual de Git no lo elimina de commits anteriores. Si se compartió, corresponde renovar el acceso con el proveedor y evaluar por separado la limpieza coordinada del historial.

## Consultas e integraciones

- `GET /api/track?order=...&carrier=auto&shipper=004185`.
- `POST /api/track-batch` con `{ "orders": ["codigo"], "carrier": "auto" }`.
- `GET /api/entregar/session`: estado de configuración y última comprobación, sin devolver la cookie.
- `POST /api/entregar/session` con `{ "cookie": "PHPSESSID=..." }`: verifica y persiste la candidata.
- `GET /api/health`: salud del proceso HTTP; no comprueba proveedores ni inicia consultas.

`carrier` admite `auto`, `urbano`, `andreani` y `entregar`. La detección es la misma para individual y lote; seleccionar un transportista explícito se respeta para todos los códigos. El lote acepta de 1 a 20 entradas y rechaza el conjunto si alguna es inválida. Mantiene el orden de entrada y procesa hasta tres tareas a la vez; Entregar se serializa por su sesión compartida.

Urbano y Entregar se interpretan a partir de HTML del proveedor. Los cambios en ese HTML pueden requerir actualizar parsers. Los productos de Entregar se extraen de las tablas embebidas en la respuesta; no se realiza una consulta secundaria recursiva.

Andreani usa HTTPS con verificación de certificado y el cifrado de payload requerido por su protocolo. Intenta resolución DNS y conserva como alternativas las dos direcciones IP presentes en la integración anterior, con Host/SNI del proveedor. Estas IP pueden cambiar y su vigencia requiere verificación operativa.

«NO ENTREGADO» se trata como incidencia. «RECIBIDO DC» se muestra como recepción en depósito y «RENDIDO» como cierre administrativo, sin contarlos como entregas al cliente. Los cambios ZECH/ZRE7 se vinculan únicamente con referencias exactas y sin contradicciones; si falta evidencia se conserva la descripción de la operación, sin afirmar una pareja.

## Límites y recuperación

- Código: máximo 120 caracteres; shipper: máximo 20.
- Cuerpo JSON: máximo 16 KB; cookie: máximo 4096 caracteres.
- Máximo 120 unidades de consulta por dirección de conexión en 60 segundos; cada pedido del lote consume una unidad.
- Respuesta externa: máximo 2 MB. Cada petición externa tiene un plazo absoluto y de inactividad; cada consulta iniciada tiene un máximo de 25 segundos.
- Hasta tres solicitudes externas por transportista, y una para Entregar; cola acotada. La desconexión del navegador cancela las tareas asociadas.

Los límites son locales a cada proceso. No se usa `X-Forwarded-For` sin una política de proxies confiables: detrás de un proxy, la cuota puede compartirse entre usuarios. Para escalar en varias réplicas debe diseñarse un límite compartido y coordinar la sesión de Entregar.

Los errores de proveedor se diferencian de la ausencia de un pedido. Los registros HTTP incluyen identificador, método, estado y duración, sin códigos de pedido ni cookies. La interfaz anuncia errores y resultados y permite operar diálogos mediante teclado.

## Railway

Configurar las variables privadas desde Railway. No subir `.env`. El manifiesto usa `/api/health` para comprobar el proceso.

Para conservar renovaciones entre despliegues, montar un volumen persistente y configurar `ENTREGAR_SESSION_FILE=/data/entregar-session.json`. Sin volumen, el archivo del contenedor puede desaparecer al reemplazarlo. `ENTREGAR_COOKIE` puede servir como sesión inicial; para cambiar esa fuente en un volumen existente hay que gestionar el archivo privado de forma explícita.

Antes de desplegar: ejecutar comprobaciones, pruebas y compilación. Hacer una prueba operativa autorizada con un pedido conocido de cada transportista; los tests automáticos usan respuestas sintéticas, no sesiones ni envíos reales.

## Recuperación de una versión

Conservar el identificador del último commit comprobado y una copia privada del archivo de sesión. En Railway, volver a desplegar la versión anterior desde el historial de despliegues; conservar el volumen y la configuración privada. Si hubo exposición de credenciales, restaurar código no sustituye renovar esas credenciales.

El proceso responde a SIGTERM/SIGINT y deja hasta diez segundos para finalizar conexiones. En caso de error de inicio, comprobar el puerto, el JSON privado y las variables sin publicar sus valores.

## Estructura

- `server.js`: adaptadores y arranque.
- `lib/router.js`: rutas, validación, estáticos y cuota.
- `lib/runtime.js`: red acotada, cancelación, detección y concurrencia.
- `lib/session.js`: verificación y persistencia de sesión.
- `lib/config.js`: carga de configuración privada.
- `public/`: interfaz y recursos que se pueden publicar.
- `test/`: regresiones de seguridad y funcionamiento.

Los tiempos de inicio, RAM y despliegue dependen del entorno; no se garantizan cifras sin medición.
