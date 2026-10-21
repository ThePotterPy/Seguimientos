# Seguimiento BGH

Aplicación web para consultar envíos de Urbano, Andreani y Entregar desde una misma interfaz.

## Funciones

- Consulta individual por pedido, guía o referencia.
- Consulta de hasta 20 códigos por lote, con selección de transportista o detección por formato.
- Ficha con estado, guía, destino y movimientos disponibles.
- Identificación de cambios y devoluciones en Entregar.
- Copia del resumen, enlace al transportista e historial reciente en el navegador.

## Tecnología

Node.js 22 o posterior, HTML, CSS y JavaScript. El servidor utiliza módulos nativos de Node.js. Tailwind CSS y Font Awesome se usan durante el desarrollo para generar los recursos estáticos incluidos en `public/`.

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

Urbano y Entregar se consultan a partir del HTML de sus portales. Andreani devuelve datos JSON mediante su API. El detalle disponible depende de cada proveedor y los cambios en sus respuestas pueden requerir ajustes del adaptador.

La aplicación no implementa inicio de sesión para sus usuarios ni guarda un historial central de envíos. El historial reciente permanece en cada navegador.

[Funcionamiento y límites por transportista](docs/integraciones.md).

## Estructura

- `server.js`: adaptadores y arranque del servidor.
- `lib/`: API, validación, consultas externas y gestión de sesión.
- `public/`: interfaz y recursos estáticos.
- `scripts/`: generación y verificación de recursos.
- `test/`: pruebas de regresión.
