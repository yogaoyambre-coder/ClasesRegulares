# ClasesRegulares

App para gestión de clases, cobros y asistencia. Pensada para uso personal desde el móvil, sin login, con Google Sheets como base de datos.

## Estado actual

- ✅ Módulo de **Cobros**
- ✅ Módulo de **Asistencia**

## Estructura del repo

```
index.html          → interfaz del módulo de cobros
css/styles.css       → estilos (mobile-first)
js/api.js            → wrapper de llamadas al backend (Apps Script)
js/app.js            → lógica de la app (estado, pantallas, eventos)
apps-script/Code.gs  → código del backend (Google Apps Script)
```

## Cómo desplegar

### 1. Crea el Google Sheet

Crea una hoja de cálculo nueva en Google Sheets con tres pestañas:

**Pestaña "Alumnos"** (fila 1 = cabeceras exactas):

| ID | Nombre | Centro | Dia | Hora | PrecioDefecto | Estado | FechaAlta | FechaBaja |
|----|--------|--------|-----|------|---------------|--------|-----------|-----------|

**Pestaña "Pagos"** (fila 1 = cabeceras exactas):

| Mes | ID_Alumno | Nombre | Centro | Dia | Hora | Importe | Pagado | FechaPago | Notas |
|-----|-----------|--------|--------|-----|------|---------|--------|-----------|-------|

**Pestaña "Asistencia"** (fila 1 = cabeceras exactas):

| ID | Fecha | ID_Alumno | Nombre | Centro | Dia | Hora | Tipo | Estado | Notas |
|----|-------|-----------|--------|--------|-----|------|------|--------|-------|

Rellena la pestaña "Alumnos" con tus alumnos actuales (Estado = `activo`, FechaAlta = fecha real o la de hoy). Las pestañas "Pagos" y "Asistencia" pueden quedar vacías: la app genera las filas automáticamente al abrir un mes/sesión.

### 2. Despliega el backend (Apps Script)

1. En el Sheet: **Extensiones → Apps Script**.
2. Borra el contenido por defecto y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. Sustituye `SS_ID` por el ID de tu Sheet (la parte de la URL entre `/d/` y `/edit`).
4. **Implementar → Nueva implementación → Tipo: Aplicación web**.
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Copia la URL que termina en `/exec`.

> **Actualizar el código más adelante:** cuando cambies `Code.gs`, no confíes en editar la implementación existente y elegir "Nueva versión" en Gestionar implementaciones — en la práctica ha resultado poco fiable (a veces no recoge el código nuevo sin avisar). Es más seguro crear cada vez una **Nueva implementación** desde cero (Implementar → Nueva implementación) y actualizar `API_URL` con la URL nueva. Para verificar rápido que una URL está sirviendo el código actual, hay un endpoint de diagnóstico: `TU_URL/exec?action=ping`, que devuelve un campo `version` que se actualiza en el código.

### 3. Conecta el frontend

Abre [`js/api.js`](js/api.js) y sustituye:

```js
const API_URL = 'PON_AQUI_LA_URL_DE_TU_APPS_SCRIPT';
```

por la URL copiada en el paso anterior.

### 4. Publica la web

Sube `index.html`, `css/` y `js/` a tu hosting habitual (por ejemplo, embebido en WordPress como en la app anterior), o ábrelo directamente desde un hosting estático. Al ser una SPA sin build, no requiere ningún paso de compilación.

## Notas del modelo de datos

### Cobros

- Un alumno tiene un **precio por defecto**, pero el importe de cada mes es editable individualmente (por si aplica un descuento puntual).
- Dar de baja a un alumno no borra su historial: solo deja de generar filas de pago en los meses futuros.
- Al abrir un mes/clase por primera vez, la app crea automáticamente las filas de pago (pendientes) para todos los alumnos activos de esa clase.

### Asistencia

- Cada clase recurrente (Centro + Día + Hora) genera automáticamente una sesión por cada semana del mes (p.ej. "Lunes 17:30" da una sesión cada lunes).
- Al abrir una sesión se comprueba la fecha de alta/baja de cada alumno **contra la fecha exacta de esa sesión** (no el mes completo). Por eso una baja hecha en Cobros deja de mostrar a esa persona en cualquier sesión futura sin tocar nada más.
- Se puede añadir gente puntual a una sesión (recuperación, clase suelta, prueba) sin que afecte a la lista de Cobros.
- "Sesión extra" sirve para clases movidas de día (festivos, etc.): abre una fecha cualquiera con la misma lista de alumnos del horario habitual, y esa fecha queda guardada para volver a encontrarla en el listado del mes.
- "Cancelar toda la clase" marca a todos los apuntados de esa sesión como `cancelada` de golpe; se puede deshacer persona a persona después.
