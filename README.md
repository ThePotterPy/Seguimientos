# 📦 Página sin nombre
> *porque a Jorge no se le ocurre nada*

Centro de seguimiento y rastreo oficial unificado para envíos de **Urbano Express** (cuenta consolidada `004185`) y **Correo Andreani** (con soporte para pedidos de Mercado Libre y acceso internacional directo sin bloqueo de IP).

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
