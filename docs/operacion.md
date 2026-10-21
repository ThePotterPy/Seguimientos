# Configuración y operación

## Variables

El servidor carga `.env` cuando existe. Las variables ya definidas en el entorno tienen prioridad sobre ese archivo.

| Variable | Uso |
| --- | --- |
| `ANDREANI_AUTHORIZATION` | Autorización para las consultas de Andreani |
| `ANDREANI_AES_KEY` | Clave del protocolo de Andreani, de 32 bytes UTF-8 |
| `ANDREANI_AES_IV` | IV del protocolo de Andreani, de 16 bytes UTF-8 |
| `ENTREGAR_COOKIE` | Sesión inicial de Entregar si no existe un archivo privado |
| `ENTREGAR_SESSION_FILE` | Archivo privado de sesión, por defecto `.private/entregar-session.json` |
| `PORT` | Puerto del servidor, por defecto 3333 |
| `HOST` | Dirección de escucha, por defecto `0.0.0.0` |

Para restringir el acceso al equipo local, configurar `HOST=127.0.0.1`. El alcance de `0.0.0.0` depende de la red y el firewall.

No subir `.env`, archivos de sesión ni copias privadas. Si un acceso estuvo versionado, retirarlo del código actual no lo elimina de commits anteriores. Su renovación y cualquier limpieza del historial requieren un procedimiento separado.

## Sesión de Entregar

Una renovación verificada y guardada en el archivo privado prevalece sobre `ENTREGAR_COOKIE`, incluso después de reiniciar. La cookie candidata se comprueba antes de reemplazar la vigente. Un fallo de verificación o escritura conserva la anterior.

El servidor comprueba la sesión cada diez minutos. Esa comprobación no garantiza que el proveedor evite su vencimiento.

## API

La aplicación no implementa autenticación de usuarios. Cualquier cliente que alcance el servidor puede utilizar sus rutas, sujeto a los límites configurados.

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/track` | Consultar `order`, con `carrier` y `shipper` opcionales |
| POST | `/api/track-batch` | Consultar un objeto JSON con `orders`, `carrier` y `shipper` |
| GET | `/api/entregar/session` | Obtener el estado de sesión sin devolver la cookie |
| POST | `/api/entregar/session` | Verificar y guardar una cookie candidata |
| GET | `/api/health` | Comprobar que el proceso HTTP responde |

`carrier` admite `auto`, `urbano`, `andreani` y `entregar`. La selección explícita se respeta en consultas individuales y lotes. Un lote admite entre uno y veinte códigos y se rechaza completo si contiene una entrada inválida o supera el límite.

## Límites

- Código: 120 caracteres. Cuenta de despacho: 20 caracteres.
- Cuerpo JSON: 16 KB. Cookie: 4096 caracteres.
- Hasta 120 unidades de consulta por dirección de conexión en 60 segundos. Cada pedido del lote consume una unidad.
- Respuesta externa: 2 MB. Cada petición tiene un plazo absoluto y de inactividad.
- Cada consulta iniciada tiene un máximo de 25 segundos. El lote procesa hasta tres tareas a la vez y serializa Entregar por su sesión compartida.

Los límites son locales a cada proceso. Detrás de un proxy, los usuarios pueden compartir la dirección de conexión y su cuota. Varias réplicas requieren coordinar los límites y la sesión de Entregar.

## Railway

El manifiesto existente usa Nixpacks, arranca con `node server.js` y comprueba `/api/health`. La comprobación de salud no consulta transportistas.

`npm run build` verifica los recursos ya versionados y solo requiere Node.js. No ejecuta Tailwind ni necesita dependencias de desarrollo. Para actualizar los recursos antes de publicarlos, ejecutar `npm ci --ignore-scripts`, `npm run build:assets` y `npm run build`.

Para conservar las renovaciones de sesión entre despliegues, montar un volumen y configurar `ENTREGAR_SESSION_FILE` en una ruta persistente, por ejemplo `/data/entregar-session.json`. Sin volumen, el reemplazo del contenedor puede perder ese archivo.

Los registros HTTP incluyen identificador de petición, método, estado y duración, sin códigos de pedido ni cookies.

## Recuperación

Conservar el identificador de la última versión comprobada y una copia privada de la sesión. Para volver a una versión anterior en Railway, usar el historial de despliegues y conservar la configuración y el volumen correspondientes.

El proceso atiende SIGINT y SIGTERM y permite hasta diez segundos para finalizar conexiones. Ante un error de inicio, comprobar puerto, variables y formato del archivo privado sin publicar sus valores.
