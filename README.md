# Seguimiento BGH

Desarrollé esta aplicación para consultar envíos de Urbano, Andreani y Entregar desde una misma interfaz. Mi objetivo fue reunir la información de los tres transportistas y facilitar el seguimiento de pedidos.

## Funciones

- Consulta individual por pedido, guía o referencia.
- Consulta de hasta 20 códigos por lote, con selección de transportista o detección por formato.
- Ficha con estado, guía, destino y movimientos disponibles.
- Identificación de cambios y devoluciones en Entregar.
- Copia del resumen, enlace al transportista e historial reciente en el navegador.

## Tecnología

Elegí Node.js 22 o posterior para el servidor y HTML, CSS y JavaScript para la interfaz. Utilicé módulos nativos de Node.js en el servidor, y Tailwind CSS y Font Awesome para generar los recursos estáticos incluidos en `public/`.

## Inicio local

1. Copiar `.env.example` a `.env` y completar los accesos necesarios para cada proveedor.
2. Ejecutar:

```sh
npm start
```

Abrir `http://localhost:3333`. En Windows también se puede ejecutar `iniciar.bat`.

Los recursos compilados están incluidos. Para iniciar el servidor no hace falta instalar dependencias de desarrollo.

## Desarrollo

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build:assets
npm run build
```

`build:assets` regenera los estilos e iconos. `build` comprueba que los archivos requeridos por la página existen y no están vacíos, sin descargar paquetes ni recompilar recursos. CI ejecuta ambos comandos y verifica que los archivos generados coincidan con los versionados.

## Configuración y despliegue

Las variables disponibles están en `.env.example`. La configuración local se carga desde `.env`; en Railway se utilizan las variables del servicio. Los accesos y archivos de sesión no se versionan.

[Configuración, límites y operación](docs/operacion.md).

## Integraciones y alcance

Para integrar Urbano y Entregar, implementé la lectura del HTML de sus portales. Para Andreani, utilicé las respuestas JSON de su API. El detalle disponible depende de cada proveedor y los cambios en sus respuestas pueden requerir ajustes del adaptador.

Para esta versión decidí mantener las consultas sin inicio de sesión y guardar el historial reciente en cada navegador, sin un historial central de envíos. La API tampoco requiere autenticación; sus rutas están disponibles para cualquier cliente que pueda acceder al servidor, dentro de los límites configurados.

[Arquitectura y explicación completa del funcionamiento](docs/arquitectura.md).

[Funcionamiento y límites por transportista](docs/integraciones.md).

## Estructura

- `server.js`: adaptadores y arranque del servidor.
- `lib/`: API, validación, consultas externas y gestión de sesión.
- `public/`: interfaz y recursos estáticos.
- `scripts/`: generación y verificación de recursos.
- `test/`: pruebas de regresión.
