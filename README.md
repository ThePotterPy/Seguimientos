# 📦 SEGUIMIENTO BGH
> *Portal Unificado de Rastreo Logístico y Gestión de Cambios*

Centro de seguimiento y trazabilidad oficial unificado para envíos de **Urbano Express**, **Correo Andreani** y **Entregar** (BGH / Scriptcase), optimizado para distribución directa y logística inversa (cambios contra entrega y retiros).

---

## 🏗️ Arquitectura y Métodos de Rastreo por Courier

### 1. Urbano Express (Portal Corporativo BGH)
- **Identificación:** Opera con la cuenta consolidada corporativa BGH `004185`.
- **Mecanismo:** Petición automatizada sobre el portal `https://apis.urbano.com.ar/cespecifica/` y posterior consulta asíncrona a `cespecifica/class/especifica_controller.php` para extraer la trazabilidad completa, móviles de reparto y confirmación de entrega con firma.

### 2. Correo Andreani (Conexión Directa API Cifrada AES-256)
- **Mecanismo:** Conexión directa contra los endpoints oficiales de `tracking-api.andreani.com` enrutada a través de las direcciones IP de Cloudflare Gateway (prevención de bloqueos por DNS/WAF).
- **Criptografía:** Autenticación estricta y cifrado simétrico en tránsito **AES-256-CBC** (`idReceptor: 1, idSistema: 1`).
- **Resolución Inteligente:** Mapea directamente códigos de compra de Mercado Libre (ej: `2000018875238250`) o números de guía oficial de 15 dígitos de Andreani, auditando el historial sin falsos positivos de entrega.

### 3. Entregar (BGH / Scriptcase — Logística Inversa y Cambios)
- **Simulación de Sesión Activa:** Emula a un usuario humano logueado en la plataforma Scriptcase (`svr.entregar.net.ar`) inyectando cookies `PHPSESSID`.
- **Keep-Alive en Segundo Plano:** El servidor envía un ping silencioso cada 10 minutos para mantener la sesión viva permanentemente.
- **Logística Inversa BGH:** Todos los reclamos y cambios de productos (de Mercado Libre, Andreani o Urbano) se procesan por la red de **Entregar**.
  - `ZECO`: Venta original entregada por primera vez al cliente.
  - `ZECH` (Despacho cambio) + `ZRE7` (Retiro cambio): Cambio contra entrega. El sistema vincula ambos automáticamente leyendo el *Campo Auxiliar de Texto 2*.
  - `ZRE2`: Retiro directo de devolución por desistimiento.
- **Desglose de Bultos y SKU:** Consulta la aplicación secundaria `apl_grid_detalle_pedido` para obtener el listado exacto de unidades por producto y el conteo de bultos físicos.

---

## ⚡ Stack Tecnológico

- **Backend:** Node.js Nativo Puro (**Zero External Dependencies - 0 paquetes npm**). No utiliza Express, Axios ni Cheerio. Utiliza únicamente los módulos estándar `node:http`, `node:https`, `node:crypto`, `node:fs`. Consumo de memoria `<30 MB` de RAM y arranque en `<100 ms`.
- **Criptografía:** Módulo nativo `node:crypto` con algoritmos AES-256-CBC.
- **Frontend:** Single Page Application (SPA) ultraligera con HTML5 semántico, Tailwind CSS y Vanilla JS nativo sin pasos de build.
- **Despliegue:** Optimizado para despliegue instantáneo en [Railway](https://railway.app).

---

## 🚀 Inicio Local

### En Windows (1 solo clic):
Hacé doble clic en el archivo:
```text
iniciar.bat
```
Abre automáticamente el navegador en `http://localhost:3333`.

### Desde la terminal:
```bash
npm start
```

---

## ☁️ Deploy en Railway

El proyecto está 100% optimizado para desplegarse en **[Railway](https://railway.app)**:
- **Cero dependencias externas (`0 npm dependencies`)**: utiliza módulos nativos de Node.js (`http`, `https`, `crypto`).
- Despliegue ultrarrápido (< 5 segundos).
- Configuración de `railway.json` y `package.json` ya incluida con bind en `0.0.0.0` y soporte para `$PORT`.

### Pasos para deployar:
1. Subí este repositorio a tu GitHub:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git branch -M main
   git push -u origin main
   ```
2. Entrá en [Railway.app](https://railway.app) y hacé clic en **"New Project"**.
3. Seleccioná **"Deploy from GitHub repo"** y elegí este repositorio.
4. ¡Listo! Railway detectará automáticamente Node.js y desplegará la app al instante con su URL pública HTTPS.

---

## ✨ Características

1. **Urbano Express**:
   - Búsqueda por número de pedido de compras (ej: `2745296ICBC`, `1638408422772-01`).
   - Prefijado automático de la cuenta shipper (`004185`).
   - Extracción de timeline completo, sucursales y enlace oficial.
2. **Correo Andreani**:
   - Soporte para números de pedido de Mercado Libre (ej: `2000018697823352`) o números de guía oficial.
   - Conexión directa a la API de trazabilidad oficial de Andreani.
   - Muestra Referencia de Envío, Número de Guía Andreani, Remitente, Servicio y todos los eventos con fecha y sucursal.
3. **Modo Lotes**:
   - Consultas de múltiples paquetes en simultáneo.
4. **Diseño Limpio y Claro**:
   - Estilo profesional sobre fondo blanco puro (`#ffffff`), sin estilos oscuros ni estéticas genéricas de IA.
