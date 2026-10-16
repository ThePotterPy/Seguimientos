# 📦 Rastreador de Envíos Urbano Express

Aplicación web rápida para consultar el seguimiento de pedidos enviados por **Urbano Express Argentina** bajo cuentas remitentes consolidadas (por defecto **`004185`**).

---

## 🚀 Inicio Rápido

### En Windows (1 solo clic):
Hacé doble clic en el archivo:
```text
iniciar.bat
```
Esto abrirá automáticamente el navegador en `http://localhost:3333`.

### Desde la terminal:
```bash
npm start
# o directamente:
node server.js
```

---

## ✨ Características

1. **Búsqueda Directa por Número de Pedido**:
   - Pegás el código de compra (ej: `2745296ICBC` o `1638408422772-01`) y el sistema le añade automáticamente el Shipper `004185` para consultar la base de datos de Urbano sin errores.
2. **Enlace Oficial Directo**:
   - Cada búsqueda incluye un botón destacado **"Ver en Urbano Oficial ↗"** que abre exactamente la URL original en una pestaña nueva.
3. **Línea de Tiempo Completa (Timeline)**:
   - Extrae automáticamente todos los checkpoints y movimientos detallados de Urbano (Hora, Fecha, Agencia/Sucursal, Zona, Estado).
4. **Consulta Masiva (Lotes)**:
   - Permite ingresar una lista de pedidos y consultar el estado de todos en paralelo.
5. **Historial de Búsquedas Recientes**:
   - Guarda en memoria local tus últimos pedidos para re-consultarlos con un clic.
6. **Configuración de Cuenta Shipper**:
   - Podés cambiar el código de remitente si en el futuro necesitás consultar otra cuenta.
7. **Zero Dependencias Externas**:
   - El backend corre con Node.js puro sin necesidad de instalar paquetes pesados en `node_modules`.

---

## 📡 API Local

### 1. Consultar un pedido individual:
```http
GET /api/track?order=2745296ICBC&shipper=004185
```

### 2. Consulta por lotes:
```http
POST /api/track-batch
Content-Type: application/json

{
  "orders": ["2745296ICBC", "1638408422772-01"],
  "shipper": "004185"
}
```
