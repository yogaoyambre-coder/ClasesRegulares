# ClasesRegulares

App para gestión de clases, cobros y asistencia. Pensada para uso personal desde el móvil, sin login, con Google Sheets como base de datos.

## Estado actual

- ✅ Módulo de **Clientes**
- ✅ Módulo de **Cobros**
- ✅ Módulo de **Asistencia**
- ✅ Módulo de **Consultas** (historial de sesiones de un cliente)
- ✅ Módulo de **Configuración** (catálogo de clases y tarifas)

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

Crea una hoja de cálculo nueva en Google Sheets con cuatro pestañas:

**Pestaña "Clientes"** (fila 1 = cabeceras exactas):

| ID | Nombre | Referencia | Telefono | Notas |
|----|--------|-----------|----------|-------|

`Referencia` es texto libre tuyo para identificar de un vistazo en qué grupo(s) está (ej. `SV L 17:30`, o `SV L 17:30 + GL X 09:00` si está en varias) — no se calcula solo, lo escribes tú.

**Pestaña "Inscripciones"** (fila 1 = cabeceras exactas) — un cliente inscrito en una clase concreta:

| ID | ID_Cliente | Nombre | Centro | Dia | Hora | Estado | FechaAlta | FechaBaja | TarifaEspecial |
|----|-----------|--------|--------|-----|------|--------|-----------|-----------|----------------|

**Pestaña "Pagos"** (fila 1 = cabeceras exactas) — una fila por **cliente y centro** (una cuota de suscripción, no una clase suelta):

| ID | Mes | ID_Cliente | Nombre | Centro | ClasesSemana | Importe | Pagado | FechaPago | MetodoPago | Notas |
|----|-----|-----------|--------|--------|--------------|---------|--------|-----------|------------|-------|

`MetodoPago` es libre: `efectivo`, `bizum` u `otro` desde el selector de la app.

**Pestaña "Asistencia"** (fila 1 = cabeceras exactas):

| ID | Fecha | ID_Alumno | Nombre | Centro | Dia | Hora | Tipo | Estado | Notas |
|----|-------|-----------|--------|--------|-----|------|------|--------|-------|

> `ID_Alumno` en Asistencia apunta al `ID` de **Inscripciones**, no al de Clientes — el nombre de columna se mantuvo por compatibilidad con datos ya existentes.

**Pestaña "Clases"** (fila 1 = cabeceras exactas) — catálogo de horarios (Centro+Día+Hora) de cada centro, se gestiona desde el módulo Configuración:

| ID | Centro | Dia | Hora | Estado |
|----|--------|-----|------|--------|

**Pestaña "Servicios"** (fila 1 = cabeceras exactas) — tarifa de suscripción mensual según centro y clases/semana, también editable desde Configuración:

| ID | Centro | ClasesSemana | Importe |
|----|--------|--------------|---------|

Todo se puede rellenar desde la propia app (Configuración → Clientes → Cobros → Asistencia). Si vienes de una versión anterior, ver las migraciones abajo.

#### Migraciones (una sola vez cada una, seguras de repetir)

- **`migrarAClientes`**: si tu Sheet viene de antes de que existiera el módulo de Clientes (una sola pestaña "Alumnos"), haz un POST a `TU_URL/exec` con `{"action":"migrarAClientes"}`. Crea "Clientes" a partir de los nombres únicos que había en "Alumnos" y renombra "Alumnos" a "Inscripciones". Si no encuentra la hoja "Alumnos" no hace nada.
- **`migrarASuscripciones`**: si vienes de antes del modelo de tarifas por suscripción, haz un POST con `{"action":"migrarASuscripciones"}`. Renombra `Apellidos`→`Referencia` en Clientes, añade `TarifaEspecial` a Inscripciones (quitando `PrecioDefecto`, que ya no se usa), y reestructura Pagos de "una fila por clase" a "una fila por cliente+centro" recalculando el importe según la tabla de tarifas. Cada paso comprueba si ya se aplicó, así que es segura de ejecutar más de una vez.
- **`migrarAConfiguracion`**: si vienes de antes del módulo de Configuración, haz un POST con `{"action":"migrarAConfiguracion"}`. Crea la hoja "Clases" a partir de los horarios ya usados en Inscripciones/Asistencia, y la hoja "Servicios" a partir de la tarifa que hasta entonces estaba fija en el código. No toca ningún dato de Clientes, Inscripciones, Pagos ni Asistencia. Si las hojas ya existen, no hace nada.
- **`migrarMetodoPagoPagos`**: si vienes de antes de poder anotar el método de cobro, haz un POST con `{"action":"migrarMetodoPagoPagos"}`. Añade la columna `MetodoPago` a Pagos (vacía por defecto). Segura de repetir.

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

### Configuración

- Es la fuente de verdad de qué clases existen: los selectores de Centro/Día/Hora en Cobros, Asistencia y en el alta de clientes se rellenan a partir de la hoja "Clases", no de quién esté ya inscrito. Así se puede crear una clase nueva (por ejemplo, un horario que arranca la semana que viene) y dejarla lista para inscribir gente antes de tener ningún alumno.
- Cada clase tiene tres acciones: **Editar** (cambia día/hora), **Desactivar/Reactivar** (reversible — deja de ofrecerse en los selectores pero no afecta a quien ya la tenga asignada ni borra histórico) y **Eliminar** (borrado definitivo de la fila del catálogo; como Inscripciones/Pagos/Asistencia guardan su propio Centro/Día/Hora como texto y no una referencia a esta fila, eliminarla no afecta a ningún dato ya existente).
- Las tarifas de suscripción se editan aquí en vez de estar fijas en el código: **1 clase/semana**, **2 clases/semana** y **Especial** (importe por defecto para clientes marcados con tarifa especial — ver Cobros). Cambiar un importe solo afecta a las cuotas que se generen a partir de ese momento — las ya creadas en Cobros no se recalculan solas.

### Clientes

- Un **cliente** es la persona (nombre completo, referencia, teléfono, notas). Una **inscripción** es su presencia en una clase concreta (centro+día+hora).
- Un mismo cliente puede tener varias inscripciones (estar en más de un grupo) sin repetir sus datos de contacto.
- El nombre que se guarda en Pagos/Asistencia es una copia del nombre del cliente en el momento de la inscripción — si luego cambias el nombre en Clientes, las inscripciones ya creadas no se actualizan solas.
- Por defecto la lista oculta a quien está de baja del todo (sin ninguna inscripción activa); hay un checkbox para mostrarlos.
- "Editar" (en la ficha del cliente o desde una fila de Cobros) es el único sitio donde se gestiona todo sobre un cliente: sus datos básicos, asignar centro+horario (añadir clase), dar de baja un grupo concreto, marcar/desmarcar tarifa especial por centro, y dar de baja o reactivar al cliente entero cuando no tiene ninguna clase activa. Un cliente nunca se borra: pasa a estado "baja" (o su última inscripción activa se da de baja) y su ficha se conserva por si vuelve.
- Al crear un cliente nuevo ("+ Nuevo cliente") también se puede asignar de una vez su primer centro y clase, sin tener que abrir "Editar" después — es opcional, se puede dejar "Sin asignar todavía".

### Cobros

- **Es una tarifa de suscripción, no de clases sueltas.** El importe depende de cuántas inscripciones activas tiene un cliente en un centro (1 o 2 clases/semana), según la tarifa configurada en Configuración → Servicios (por defecto Soma 35€/60€, Gema Lanza 35€/55€). Si algún día alguien tiene 3+ clases/semana en el mismo centro (hoy no hay ningún caso), no hay tarifa definida y el importe queda vacío.
- **Tarifa especial**: marcada por cliente+centro desde "Editar", precarga el importe de la tarifa "Especial" configurada en Configuración → Servicios (o lo deja vacío si esa tarifa no se ha definido) para rellenarlo o ajustarlo a mano (bonos, gente que no cobras, etc.) — el campo de importe siempre es editable.
- La pantalla de Cobros va por **Centro → lista de clientes** de ese centro (no por clase/horario, ya que la cuota es por cliente): cada fila es una cuota mensual, editable, con un selector de **método de pago** (efectivo, bizum, otro).
- Dar de baja un grupo no borra el historial: dentro del mes en curso, la cuota sigue visible (marcada "de baja" si ya no le queda ningún grupo activo en ese centro) por si falta cobrarla; desde el mes siguiente deja de generarse.
- Al abrir un mes/centro por primera vez, la app crea automáticamente las filas de pago (pendientes, con el importe de tarifa) para todos los clientes activos en ese centro.

### Asistencia

- Cada clase recurrente (Centro + Día + Hora) genera automáticamente una sesión por cada semana del mes (p.ej. "Lunes 17:30" da una sesión cada lunes).
- Al abrir una sesión se comprueba la fecha de alta/baja de cada alumno **contra la fecha exacta de esa sesión** (no el mes completo). Por eso una baja hecha en Cobros deja de mostrar a esa persona en cualquier sesión futura sin tocar nada más.
- Se puede añadir gente puntual a una sesión (recuperación, clase suelta, prueba) sin que afecte a la lista de Cobros.
- "Sesión extra" sirve para clases movidas de día (festivos, etc.): abre una fecha cualquiera con la misma lista de alumnos del horario habitual, y esa fecha queda guardada para volver a encontrarla en el listado del mes.
- "Cancelar toda la clase" marca a todos los apuntados de esa sesión como `cancelada` de golpe; se puede deshacer persona a persona después.
