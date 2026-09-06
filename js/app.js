const CENTROS = ['Gema Lanza', 'Soma'];
const ORDEN_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const state = {
  mes: mesActual(),
  screen: 'centro', // 'centro' | 'horario' | 'alumnos'
  centro: null,
  horario: null, // { dia, hora }
  alumnos: [],
  pagos: [],
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

function render() {
  app.innerHTML = '' +
    '<header class="app-header">' +
      '<h1>Cobros</h1>' +
    '</header>' +
    '<input type="month" id="mes-input" value="' + state.mes + '">' +
    renderScreen();

  document.getElementById('mes-input').addEventListener('change', async function (e) {
    state.mes = e.target.value;
    if (state.screen === 'alumnos') await cargarPagosMes();
    else render();
  });

  bindScreenEvents();
}

function renderScreen() {
  if (state.cargando && state.alumnos.length === 0) {
    return '<p class="empty-state">Cargando...</p>';
  }
  if (state.screen === 'centro') return renderCentros();
  if (state.screen === 'horario') return renderHorarios();
  return renderAlumnos();
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
    '<button class="btn btn-secondary btn-block" data-accion="abrir-alta-clase">+ Añadir alumno/a a una clase nueva</button>';
}

function renderAlumnos() {
  const pagos = pagosDeHorario();
  const pagados = pagos.filter(function (p) { return p.Pagado === true || p.Pagado === 'TRUE' || p.Pagado === 'true'; }).length;
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

function formateaFecha(f) {
  const d = new Date(f);
  if (isNaN(d)) return f;
  return d.toLocaleDateString('es-ES');
}

function bindScreenEvents() {
  app.querySelectorAll('[data-accion]').forEach(function (el) {
    const accion = el.dataset.accion;
    if (accion === 'elegir-centro') {
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
        state.screen = 'alumnos';
        await cargarPagosMes();
      });
    } else if (accion === 'volver-horario') {
      el.addEventListener('click', function () {
        state.screen = 'horario';
        state.horario = null;
        render();
      });
    } else if (accion === 'toggle-pagado') {
      el.addEventListener('change', async function () {
        await actualizarPago(el.dataset.id, { pagado: el.checked, fechaPago: el.checked ? hoyISO() : '' });
      });
    } else if (accion === 'cambiar-importe') {
      el.addEventListener('change', async function () {
        await actualizarPago(el.dataset.id, { importe: parseFloat(el.value) || 0 });
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
      '<p>Dejará de aparecer en los próximos meses, pero se conserva su historial de pagos.</p>' +
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

init();
