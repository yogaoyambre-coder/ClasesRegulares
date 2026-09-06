const CENTROS = ['Gema Lanza', 'Soma'];
const ORDEN_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIA_A_NUM = { 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6, 'Domingo': 0 };
const ESTADOS_ASISTENCIA = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'asiste', label: 'Asiste' },
  { value: 'cancelada', label: 'Cancelada (avisó)' },
  { value: 'no_show', label: 'No show' }
];

const state = {
  modulo: 'cobros', // 'cobros' | 'asistencia'
  mes: mesActual(),
  screen: 'centro', // 'centro' | 'horario' | 'alumnos' | 'sesiones' | 'sesion'
  centro: null,
  horario: null, // { dia, hora }
  alumnos: [],
  pagos: [],
  fechasGuardadas: [], // fechas de sesiones ya usadas para el horario/mes actual
  sesionFecha: null,
  asistencias: [],
  cargando: false
};

function mesActual() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const app = document.getElementById('app');

async function init() {
  await cargarAlumnos();
  render();
}

async function cargarAlumnos() {
  state.cargando = true;
  render();
  try {
    state.alumnos = await apiGet('getAlumnos');
  } catch (err) {
    mostrarToast('Error cargando alumnos: ' + err.message);
  }
  state.cargando = false;
}

async function cargarPagosMes() {
  state.cargando = true;
  render();
  try {
    state.pagos = await apiGet('getPagosMes', { mes: state.mes });
  } catch (err) {
    mostrarToast('Error cargando pagos: ' + err.message);
  }
  state.cargando = false;
  render();
}

async function cargarFechasSesion() {
  state.cargando = true;
  render();
  try {
    state.fechasGuardadas = await apiGet('getFechasSesion', {
      centro: state.centro, dia: state.horario.dia, hora: state.horario.hora, mes: state.mes
    });
  } catch (err) {
    mostrarToast('Error cargando sesiones: ' + err.message);
    state.fechasGuardadas = [];
  }
  state.cargando = false;
  render();
}

async function cargarAsistenciaFecha(fecha) {
  state.cargando = true;
  render();
  try {
    state.asistencias = await apiGet('getAsistencia', {
      fecha: fecha, centro: state.centro, dia: state.horario.dia, hora: state.horario.hora
    });
  } catch (err) {
    mostrarToast('Error cargando asistencia: ' + err.message);
  }
  state.cargando = false;
  render();
}

function alumnosActivos() {
  return state.alumnos.filter(function (a) { return a.Estado === 'activo'; });
}

function horariosDeCentro(centro) {
  const combos = {};
  alumnosActivos()
    .filter(function (a) { return a.Centro === centro; })
    .forEach(function (a) {
      const key = a.Dia + '|' + a.Hora;
      combos[key] = { dia: a.Dia, hora: a.Hora };
    });
  return Object.values(combos).sort(function (a, b) {
    const diffDia = ORDEN_DIAS.indexOf(a.dia) - ORDEN_DIAS.indexOf(b.dia);
    if (diffDia !== 0) return diffDia;
    return a.hora.localeCompare(b.hora);
  });
}

function pagosDeHorario() {
  if (!state.horario) return [];
  return state.pagos
    .filter(function (p) {
      return p.Centro === state.centro && p.Dia === state.horario.dia && p.Hora === state.horario.hora;
    })
    .sort(function (a, b) { return a.Nombre.localeCompare(b.Nombre); });
}

// --- Cálculo de fechas de sesión (recurrencia semanal) ---

function formatoFechaLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fechasRegularesDelMes(dia, mes) {
  const partes = mes.split('-').map(Number);
  const objetivo = DIA_A_NUM[dia];
  const fechas = [];
  const d = new Date(partes[0], partes[1] - 1, 1);
  while (d.getMonth() === partes[1] - 1) {
    if (d.getDay() === objetivo) fechas.push(formatoFechaLocal(d));
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}

// Combina las fechas regulares (recurrencia semanal) con las que ya tienen
// algún registro guardado (sesiones extra por clases movidas, festivos, etc.)
function fechasParaMostrar() {
  const regulares = fechasRegularesDelMes(state.horario.dia, state.mes);
  const regularesSet = {};
  regulares.forEach(function (f) { regularesSet[f] = true; });
  const todas = {};
  regulares.forEach(function (f) { todas[f] = true; });
  (state.fechasGuardadas || []).forEach(function (f) { todas[f] = true; });
  return Object.keys(todas).sort().map(function (f) {
    return { fecha: f, extra: !regularesSet[f] };
  });
}

function render() {
  app.innerHTML = '' +
    '<header class="app-header"><h1>' + (state.modulo === 'cobros' ? 'Cobros' : 'Asistencia') + '</h1></header>' +
    '<div class="pill-row">' +
      '<button class="pill ' + (state.modulo === 'cobros' ? 'active' : '') + '" data-accion="cambiar-modulo" data-modulo="cobros">Cobros</button>' +
      '<button class="pill ' + (state.modulo === 'asistencia' ? 'active' : '') + '" data-accion="cambiar-modulo" data-modulo="asistencia">Asistencia</button>' +
    '</div>' +
    '<input type="month" id="mes-input" value="' + state.mes + '">' +
    renderScreen();

  document.getElementById('mes-input').addEventListener('change', async function (e) {
    state.mes = e.target.value;
    if (state.modulo === 'cobros' && state.screen === 'alumnos') {
      await cargarPagosMes();
    } else if (state.modulo === 'asistencia' && (state.screen === 'sesiones' || state.screen === 'sesion')) {
      state.screen = 'sesiones';
      await cargarFechasSesion();
    } else {
      render();
    }
  });

  bindScreenEvents();
}

function renderScreen() {
  if (state.cargando && state.alumnos.length === 0) {
    return '<p class="empty-state">Cargando...</p>';
  }
  if (state.screen === 'centro') return renderCentros();
  if (state.screen === 'horario') return renderHorarios();
  if (state.modulo === 'cobros') return renderAlumnos();
  if (state.screen === 'sesiones') return renderSesiones();
  return renderSesion();
}

function renderCentros() {
  return '' +
    '<div class="section-title">Centro</div>' +
    '<div class="pill-row">' +
    CENTROS.map(function (c) {
      return '<button class="pill" data-accion="elegir-centro" data-centro="' + c + '">' + c + '</button>';
    }).join('') +
    '</div>';
}

function renderHorarios() {
  const horarios = horariosDeCentro(state.centro);
  return '' +
    '<div class="top-bar"><button class="back-link" data-accion="volver-centro">&larr; Centros</button></div>' +
    '<div class="section-title">' + state.centro + ' — Clases</div>' +
    (horarios.length === 0
      ? '<p class="empty-state">No hay clases activas en este centro todavía.</p>'
      : '<div class="pill-row">' +
        horarios.map(function (h) {
          return '<button class="pill" data-accion="elegir-horario" data-dia="' + h.dia + '" data-hora="' + h.hora + '">' +
            h.dia + ' ' + h.hora + '</button>';
        }).join('') +
        '</div>') +
    (state.modulo === 'cobros'
      ? '<button class="btn btn-secondary btn-block" data-accion="abrir-alta-clase">+ Añadir alumno/a a una clase nueva</button>'
      : '');
}

function renderAlumnos() {
  const pagos = pagosDeHorario();
  const pagados = pagos.filter(esPagado).length;
  return '' +
    '<div class="top-bar"><button class="back-link" data-accion="volver-horario">&larr; Clases</button></div>' +
    '<div class="section-title">' + state.centro + ' — ' + state.horario.dia + ' ' + state.horario.hora + '</div>' +
    '<div class="resumen-mes">' + pagados + ' de ' + pagos.length + ' pagados este mes</div>' +
    (pagos.length === 0
      ? '<p class="empty-state">No hay alumnos/as en esta clase para este mes.</p>'
      : pagos.map(renderAlumnoCard).join('')) +
    '<button class="btn btn-primary btn-block" data-accion="abrir-alta-alumno">+ Alta en esta clase</button>';
}

function esPagado(p) {
  return p.Pagado === true || p.Pagado === 'TRUE' || p.Pagado === 'true';
}

function renderAlumnoCard(p) {
  const pagado = esPagado(p);
  return '' +
    '<div class="card alumno-card ' + (pagado ? 'pagado' : 'pendiente') + '">' +
      '<div class="alumno-top">' +
        '<span class="alumno-nombre">' + p.Nombre + '</span>' +
        '<button class="btn-danger-link" data-accion="confirmar-baja" data-id="' + p.ID_Alumno + '" data-nombre="' + p.Nombre + '">Dar de baja</button>' +
      '</div>' +
      '<div class="alumno-controls">' +
        '<input type="checkbox" class="checkbox-pagado" data-accion="toggle-pagado" data-id="' + p.ID_Alumno + '" ' + (pagado ? 'checked' : '') + '>' +
        '<span>Pagado</span>' +
        '<input type="number" class="importe-input" data-accion="cambiar-importe" data-id="' + p.ID_Alumno + '" value="' + p.Importe + '" step="0.5">' +
        '<span>€</span>' +
      '</div>' +
      (pagado && p.FechaPago ? '<div class="alumno-meta">Pagado el ' + formateaFecha(p.FechaPago) + '</div>' : '') +
    '</div>';
}

// --- Asistencia: listado de sesiones del mes ---

function renderSesiones() {
  const fechas = fechasParaMostrar();
  return '' +
    '<div class="top-bar"><button class="back-link" data-accion="volver-horario">&larr; Clases</button></div>' +
    '<div class="section-title">' + state.centro + ' — ' + state.horario.dia + ' ' + state.horario.hora + '</div>' +
    (fechas.length === 0
      ? '<p class="empty-state">No hay sesiones este mes.</p>'
      : '<div class="pill-row">' +
        fechas.map(function (f) {
          return '<button class="pill" data-accion="elegir-sesion" data-fecha="' + f.fecha + '">' +
            formateaFechaCorta(f.fecha) + (f.extra ? ' *' : '') +
            '</button>';
        }).join('') +
        '</div>') +
    (fechas.some(function (f) { return f.extra; })
      ? '<div class="alumno-meta">* sesión extra (no es el día habitual)</div>'
      : '') +
    '<button class="btn btn-secondary btn-block" data-accion="abrir-sesion-extra">+ Añadir sesión extra (clase movida)</button>';
}

// --- Asistencia: detalle de una sesión concreta ---

function renderSesion() {
  const filas = state.asistencias.slice().sort(function (a, b) { return a.Nombre.localeCompare(b.Nombre); });
  return '' +
    '<div class="top-bar"><button class="back-link" data-accion="volver-sesiones">&larr; Sesiones</button></div>' +
    '<div class="section-title">' + state.centro + ' — ' + state.horario.dia + ' ' + state.horario.hora + '</div>' +
    '<div class="resumen-mes">' + formateaFechaLarga(state.sesionFecha) + '</div>' +
    (filas.length === 0
      ? '<p class="empty-state">No hay nadie apuntado a esta sesión.</p>'
      : filas.map(renderAsistenteCard).join('')) +
    '<button class="btn btn-secondary btn-block" data-accion="abrir-anadir-asistente">+ Recuperación / suelta / prueba</button>' +
    '<button class="btn btn-danger btn-block" data-accion="cancelar-sesion-completa">Cancelar toda la clase (festivo)</button>';
}

function claseEstado(estado) {
  if (estado === 'asiste') return 'pagado';
  if (estado === 'cancelada') return 'cancelada';
  if (estado === 'no_show') return 'no-show';
  return 'pendiente';
}

function renderAsistenteCard(f) {
  const opciones = ESTADOS_ASISTENCIA.map(function (o) {
    return '<option value="' + o.value + '"' + (o.value === f.Estado ? ' selected' : '') + '>' + o.label + '</option>';
  }).join('');
  const tipoTag = f.Tipo !== 'regular' ? ' <span class="alumno-meta">(' + f.Tipo + ')</span>' : '';
  return '' +
    '<div class="card alumno-card ' + claseEstado(f.Estado) + '">' +
      '<div class="alumno-top"><span class="alumno-nombre">' + f.Nombre + tipoTag + '</span></div>' +
      '<div class="alumno-controls">' +
        '<select class="select-estado" data-accion="cambiar-estado" data-id="' + f.ID + '">' + opciones + '</select>' +
      '</div>' +
    '</div>';
}

function formateaFecha(f) {
  const d = new Date(f);
  if (isNaN(d)) return f;
  return d.toLocaleDateString('es-ES');
}

function formateaFechaCorta(f) {
  const d = new Date(f + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formateaFechaLarga(f) {
  const d = new Date(f + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function bindScreenEvents() {
  app.querySelectorAll('[data-accion]').forEach(function (el) {
    const accion = el.dataset.accion;
    if (accion === 'cambiar-modulo') {
      el.addEventListener('click', function () {
        state.modulo = el.dataset.modulo;
        state.screen = 'centro';
        state.centro = null;
        state.horario = null;
        render();
      });
    } else if (accion === 'elegir-centro') {
      el.addEventListener('click', function () {
        state.centro = el.dataset.centro;
        state.screen = 'horario';
        render();
      });
    } else if (accion === 'volver-centro') {
      el.addEventListener('click', function () {
        state.screen = 'centro';
        state.centro = null;
        render();
      });
    } else if (accion === 'elegir-horario') {
      el.addEventListener('click', async function () {
        state.horario = { dia: el.dataset.dia, hora: el.dataset.hora };
        if (state.modulo === 'asistencia') {
          state.screen = 'sesiones';
          await cargarFechasSesion();
        } else {
          state.screen = 'alumnos';
          await cargarPagosMes();
        }
      });
    } else if (accion === 'volver-horario') {
      el.addEventListener('click', function () {
        state.screen = 'horario';
        state.horario = null;
        render();
      });
    } else if (accion === 'toggle-pagado') {
      el.addEventListener('change', async function () {
        await actualizarPago(el.dataset.id, { Pagado: el.checked, FechaPago: el.checked ? hoyISO() : '' });
      });
    } else if (accion === 'cambiar-importe') {
      el.addEventListener('change', async function () {
        await actualizarPago(el.dataset.id, { Importe: parseFloat(el.value) || 0 });
      });
    } else if (accion === 'confirmar-baja') {
      el.addEventListener('click', function () {
        abrirModalBaja(el.dataset.id, el.dataset.nombre);
      });
    } else if (accion === 'abrir-alta-alumno') {
      el.addEventListener('click', function () {
        abrirModalAlta(state.centro, state.horario.dia, state.horario.hora);
      });
    } else if (accion === 'abrir-alta-clase') {
      el.addEventListener('click', function () {
        abrirModalAlta(state.centro, '', '');
      });
    } else if (accion === 'elegir-sesion') {
      el.addEventListener('click', async function () {
        state.sesionFecha = el.dataset.fecha;
        state.screen = 'sesion';
        await cargarAsistenciaFecha(state.sesionFecha);
      });
    } else if (accion === 'volver-sesiones') {
      el.addEventListener('click', function () {
        state.screen = 'sesiones';
        state.sesionFecha = null;
        render();
      });
    } else if (accion === 'cambiar-estado') {
      el.addEventListener('change', async function () {
        await actualizarEstadoAsistencia(el.dataset.id, el.value);
      });
    } else if (accion === 'abrir-anadir-asistente') {
      el.addEventListener('click', function () {
        abrirModalAsistente();
      });
    } else if (accion === 'abrir-sesion-extra') {
      el.addEventListener('click', function () {
        abrirModalSesionExtra();
      });
    } else if (accion === 'cancelar-sesion-completa') {
      el.addEventListener('click', function () {
        abrirModalCancelarSesion();
      });
    }
  });
}

async function actualizarPago(idAlumno, cambios) {
  const pago = state.pagos.find(function (p) { return String(p.ID_Alumno) === String(idAlumno); });
  if (!pago) return;
  Object.assign(pago, cambios);
  try {
    await apiPost('setPago', {
      mes: state.mes,
      idAlumno: idAlumno,
      importe: pago.Importe,
      pagado: pago.Pagado === true || pago.Pagado === 'true' || pago.Pagado === 'TRUE',
      fechaPago: pago.FechaPago,
      notas: pago.Notas || ''
    });
    mostrarToast('Guardado');
  } catch (err) {
    mostrarToast('Error guardando: ' + err.message);
  }
  render();
}

async function actualizarEstadoAsistencia(id, estado) {
  const fila = state.asistencias.find(function (f) { return String(f.ID) === String(id); });
  if (!fila) return;
  fila.Estado = estado;
  try {
    await apiPost('setAsistencia', { id: id, estado: estado });
    mostrarToast('Guardado');
  } catch (err) {
    mostrarToast('Error guardando: ' + err.message);
  }
  render();
}

function mostrarToast(texto) {
  const existente = document.querySelector('.toast');
  if (existente) existente.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = texto;
  document.body.appendChild(toast);
  setTimeout(function () { toast.remove(); }, 2200);
}

// --- Modal: dar de baja ---

function abrirModalBaja(id, nombre) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Dar de baja a ' + nombre + '</h2>' +
      '<p>Dejará de aparecer en los próximos meses y sesiones, pero se conserva su historial.</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-baja">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-baja-btn">Confirmar baja</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-baja').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-baja-btn').addEventListener('click', async function () {
    try {
      await apiPost('bajaAlumno', { id: id, fechaBaja: hoyISO() });
      mostrarToast('Alumno/a dado de baja');
      overlay.remove();
      await cargarAlumnos();
      await cargarPagosMes();
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: alta de alumno ---

function abrirModalAlta(centroFijo, diaFijo, horaFijo) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Nueva alta</h2>' +
      '<div class="field"><label>Nombre</label><input type="text" id="alta-nombre"></div>' +
      '<div class="field"><label>Centro</label><input type="text" id="alta-centro" value="' + centroFijo + '"></div>' +
      '<div class="field"><label>Día (ej. Lunes)</label><input type="text" id="alta-dia" value="' + diaFijo + '"></div>' +
      '<div class="field"><label>Hora (ej. 18:00)</label><input type="text" id="alta-hora" value="' + horaFijo + '"></div>' +
      '<div class="field"><label>Precio mensual (€)</label><input type="number" id="alta-precio" step="0.5"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-alta">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-alta-btn">Guardar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-alta').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-alta-btn').addEventListener('click', async function () {
    const nombre = document.getElementById('alta-nombre').value.trim();
    const centro = document.getElementById('alta-centro').value.trim();
    const dia = document.getElementById('alta-dia').value.trim();
    const hora = document.getElementById('alta-hora').value.trim();
    const precio = parseFloat(document.getElementById('alta-precio').value) || 0;
    if (!nombre || !centro || !dia || !hora) {
      mostrarToast('Rellena nombre, centro, día y hora');
      return;
    }
    try {
      await apiPost('addAlumno', {
        nombre: nombre, centro: centro, dia: dia, hora: hora,
        precioDefecto: precio, fechaAlta: hoyISO()
      });
      mostrarToast('Alumno/a dado de alta');
      overlay.remove();
      await cargarAlumnos();
      if (state.screen === 'alumnos') await cargarPagosMes();
      else render();
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: añadir recuperación / suelta / prueba ---

function abrirModalAsistente() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Añadir a esta sesión</h2>' +
      '<div class="field"><label>Nombre</label><input type="text" id="asis-nombre"></div>' +
      '<div class="field"><label>Tipo</label>' +
        '<select id="asis-tipo">' +
          '<option value="recuperacion">Recuperación</option>' +
          '<option value="suelta">Clase suelta</option>' +
          '<option value="prueba">Clase de prueba</option>' +
        '</select>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-asis">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-asis-btn">Añadir</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-asis').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-asis-btn').addEventListener('click', async function () {
    const nombre = document.getElementById('asis-nombre').value.trim();
    const tipo = document.getElementById('asis-tipo').value;
    if (!nombre) {
      mostrarToast('Escribe un nombre');
      return;
    }
    try {
      await apiPost('addAsistente', {
        fecha: state.sesionFecha, centro: state.centro, dia: state.horario.dia, hora: state.horario.hora,
        nombre: nombre, tipo: tipo
      });
      mostrarToast('Añadido/a');
      overlay.remove();
      await cargarAsistenciaFecha(state.sesionFecha);
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: añadir sesión extra (clase movida) ---

function abrirModalSesionExtra() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Sesión extra</h2>' +
      '<p>Para cuando mueves esta clase a otro día (festivo, etc.). Usa la misma lista de alumnos de ' +
        state.horario.dia + ' ' + state.horario.hora + '.</p>' +
      '<div class="field"><label>Fecha</label><input type="date" id="extra-fecha" value="' + hoyISO() + '"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-extra">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-extra-btn">Abrir sesión</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-extra').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-extra-btn').addEventListener('click', async function () {
    const fecha = document.getElementById('extra-fecha').value;
    if (!fecha) {
      mostrarToast('Elige una fecha');
      return;
    }
    if (state.fechasGuardadas.indexOf(fecha) === -1) state.fechasGuardadas.push(fecha);
    state.sesionFecha = fecha;
    state.screen = 'sesion';
    overlay.remove();
    await cargarAsistenciaFecha(fecha);
  });
}

// --- Modal: cancelar toda la sesión ---

function abrirModalCancelarSesion() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Cancelar toda la clase</h2>' +
      '<p>Se marcará a todos los apuntados de ' + formateaFechaLarga(state.sesionFecha) + ' como "cancelada". Se puede deshacer persona a persona después.</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-cancelacion">Cancelar</button>' +
        '<button class="btn btn-danger" id="confirmar-cancelacion-btn">Sí, cancelar la clase</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-cancelacion').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-cancelacion-btn').addEventListener('click', async function () {
    try {
      await apiPost('cancelarSesion', {
        fecha: state.sesionFecha, centro: state.centro, dia: state.horario.dia, hora: state.horario.hora
      });
      mostrarToast('Clase cancelada');
      overlay.remove();
      await cargarAsistenciaFecha(state.sesionFecha);
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

init();
