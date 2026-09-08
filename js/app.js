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
  modulo: 'cobros', // 'cobros' | 'asistencia' | 'clientes' | 'consultas' | 'configuracion'
  mes: mesActual(),
  screen: 'centro', // 'centro' | 'pagos' (cobros) | 'horario' | 'sesiones' | 'sesion' (asistencia)
  centro: null,
  horario: null, // { dia, hora }
  clientes: [],
  alumnos: [], // inscripciones (cliente + centro + día + hora)
  pagos: [], // cuotas de suscripción del mes (una fila por cliente+centro)
  clases: [], // catálogo de horarios (Centro+Dia+Hora) definidos en Configuración
  servicios: [], // tarifas de suscripción (Centro+ClasesSemana) definidas en Configuración
  fechasGuardadas: [], // fechas de sesiones ya usadas para el horario/mes actual
  sesionFecha: null,
  asistencias: [],
  cargando: false,
  filtroCentro: '', // filtro del módulo Clientes
  filtroHorario: null, // { dia, hora } | null
  mostrarBajas: false,
  filtroHorarioCobros: null, // { dia, hora } | null, filtro del módulo Cobros
  consultaCliente: null, // ID del cliente elegido en el módulo Consultas
  consultaRango: 'actual', // 'todas' | 'personalizada' | 'actual' | 'siguiente'
  consultaDesde: '',
  consultaHasta: '',
  sesionesCliente: []
};

function mesActual() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function sumarMeses(mes, n) {
  const partes = mes.split('-').map(Number);
  const d = new Date(partes[0], partes[1] - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function esVerdadero(v) {
  return v === true || v === 'true' || v === 'TRUE';
}

const app = document.getElementById('app');

async function init() {
  await Promise.all([cargarAlumnos(), cargarClientes(), cargarClases(), cargarServicios()]);
  render();
}

async function cargarAlumnos() {
  state.cargando = true;
  render();
  try {
    state.alumnos = await apiGet('getInscripciones');
  } catch (err) {
    mostrarToast('Error cargando inscripciones: ' + err.message);
  }
  state.cargando = false;
}

async function cargarClientes() {
  try {
    state.clientes = await apiGet('getClientes');
  } catch (err) {
    mostrarToast('Error cargando clientes: ' + err.message);
  }
}

async function cargarClases() {
  try {
    state.clases = await apiGet('getClases');
  } catch (err) {
    mostrarToast('Error cargando clases: ' + err.message);
  }
}

async function cargarServicios() {
  try {
    state.servicios = await apiGet('getServicios');
  } catch (err) {
    mostrarToast('Error cargando servicios: ' + err.message);
  }
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

function clasesActivas() {
  return state.clases.filter(function (c) { return c.Estado === 'activo'; });
}

// Horarios disponibles de un centro, según el catálogo definido en
// Configuración (no según quién esté ya inscrito, para poder crear una clase
// nueva y ofrecerla al dar de alta antes de tener ningún cliente en ella).
function horariosDeCentro(centro) {
  return clasesActivas()
    .filter(function (c) { return c.Centro === centro; })
    .map(function (c) { return { dia: c.Dia, hora: c.Hora }; })
    .sort(function (a, b) {
      const diffDia = ORDEN_DIAS.indexOf(a.dia) - ORDEN_DIAS.indexOf(b.dia);
      if (diffDia !== 0) return diffDia;
      return a.hora.localeCompare(b.hora);
    });
}

function inscripcionesDeCliente(idCliente) {
  return state.alumnos.filter(function (a) { return String(a.ID_Cliente) === String(idCliente); });
}

function clientePorId(id) {
  return state.clientes.find(function (c) { return String(c.ID) === String(id); });
}

function pagosDeCentro() {
  return state.pagos
    .filter(function (p) { return p.Centro === state.centro; })
    .filter(function (p) {
      if (!state.filtroHorarioCobros) return true;
      return inscripcionesDeCliente(p.ID_Cliente).some(function (i) {
        return i.Centro === state.centro && i.Estado === 'activo' &&
          i.Dia === state.filtroHorarioCobros.dia && i.Hora === state.filtroHorarioCobros.hora;
      });
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

const TITULOS_MODULO = { cobros: 'Cobros', asistencia: 'Asistencia', clientes: 'Clientes', consultas: 'Consultas', configuracion: 'Configuración' };

function render() {
  const mostrarMes = state.modulo === 'cobros' || state.modulo === 'asistencia';
  app.innerHTML = '' +
    '<header class="app-header"><h1>' + TITULOS_MODULO[state.modulo] + '</h1></header>' +
    '<div class="pill-row">' +
      '<button class="pill ' + (state.modulo === 'cobros' ? 'active' : '') + '" data-accion="cambiar-modulo" data-modulo="cobros">Cobros</button>' +
      '<button class="pill ' + (state.modulo === 'asistencia' ? 'active' : '') + '" data-accion="cambiar-modulo" data-modulo="asistencia">Asistencia</button>' +
      '<button class="pill ' + (state.modulo === 'clientes' ? 'active' : '') + '" data-accion="cambiar-modulo" data-modulo="clientes">Clientes</button>' +
      '<button class="pill ' + (state.modulo === 'consultas' ? 'active' : '') + '" data-accion="cambiar-modulo" data-modulo="consultas">Consultas</button>' +
      '<button class="pill ' + (state.modulo === 'configuracion' ? 'active' : '') + '" data-accion="cambiar-modulo" data-modulo="configuracion">Configuración</button>' +
    '</div>' +
    (mostrarMes ? '<input type="month" id="mes-input" value="' + state.mes + '">' : '') +
    renderScreen();

  if (mostrarMes) {
    document.getElementById('mes-input').addEventListener('change', async function (e) {
      state.mes = e.target.value;
      if (state.mes > sumarMeses(mesActual(), 1)) {
        mostrarToast('Los horarios solo están confirmados hasta el mes que viene — más adelante pueden cambiar.');
      }
      if (state.modulo === 'cobros' && state.screen !== 'centro') {
        await cargarPagosMes();
      } else if (state.modulo === 'asistencia' && (state.screen === 'sesiones' || state.screen === 'sesion')) {
        state.screen = 'sesiones';
        await cargarFechasSesion();
      } else {
        render();
      }
    });
  }

  if (state.modulo === 'clientes') {
    document.getElementById('filtro-centro').addEventListener('change', function (e) {
      state.filtroCentro = e.target.value;
      state.filtroHorario = null;
      render();
    });
    const selHorario = document.getElementById('filtro-horario');
    if (selHorario) {
      selHorario.addEventListener('change', function (e) {
        if (!e.target.value) {
          state.filtroHorario = null;
        } else {
          const partes = e.target.value.split('|');
          state.filtroHorario = { dia: partes[0], hora: partes[1] };
        }
        render();
      });
    }
    document.getElementById('filtro-mostrar-bajas').addEventListener('change', function (e) {
      state.mostrarBajas = e.target.checked;
      render();
    });
  }

  if (state.modulo === 'cobros' && state.screen === 'pagos') {
    const selHorarioCobros = document.getElementById('filtro-horario-cobros');
    if (selHorarioCobros) {
      selHorarioCobros.addEventListener('change', function (e) {
        if (!e.target.value) {
          state.filtroHorarioCobros = null;
        } else {
          const partes = e.target.value.split('|');
          state.filtroHorarioCobros = { dia: partes[0], hora: partes[1] };
        }
        render();
      });
    }
  }

  if (state.modulo === 'consultas') {
    const selCliente = document.getElementById('consulta-cliente-select');
    if (selCliente) {
      selCliente.addEventListener('change', async function (e) {
        state.consultaCliente = e.target.value || null;
        state.consultaRango = 'actual';
        if (state.consultaCliente) await cargarSesionesCliente();
        else render();
      });
    }
  }

  bindScreenEvents();
}

function renderScreen() {
  if (state.cargando && state.alumnos.length === 0) {
    return '<p class="empty-state">Cargando...</p>';
  }
  if (state.modulo === 'clientes') return renderClientes();
  if (state.modulo === 'consultas') return renderConsultas();
  if (state.modulo === 'configuracion') return renderConfiguracion();
  if (state.screen === 'centro') return renderCentros();
  if (state.modulo === 'cobros') return renderPagosCentro();
  if (state.screen === 'horario') return renderHorarios();
  if (state.screen === 'sesiones') return renderSesiones();
  return renderSesion();
}

// --- Clientes ---

// Compara solo los últimos 9 dígitos (formato móvil español) para que no
// falle por espacios/guiones, o por escribir el "+34" en una y en otra no.
function ultimosDigitos_(telefono) {
  const soloDigitos = String(telefono).replace(/\D/g, '');
  return soloDigitos.slice(-9);
}

function buscarClientePorTelefono(telefono, excluirId) {
  const limpio = ultimosDigitos_(telefono);
  if (!limpio) return null;
  return state.clientes.find(function (c) {
    if (excluirId && String(c.ID) === String(excluirId)) return false;
    return c.Telefono && ultimosDigitos_(c.Telefono) === limpio;
  });
}

function avisoTelefonoDuplicado(telefono, excluirId) {
  if (!telefono) return true;
  const existente = buscarClientePorTelefono(telefono, excluirId);
  if (!existente) return true;
  return confirm('Ya existe un cliente con este teléfono: ' + existente.Nombre + '.\n\n¿Crear de todas formas? (puede ser normal si comparten teléfono, ej. familiares)');
}

// "De baja del todo": o bien tiene inscripciones pero ninguna activa, o bien
// no tiene ninguna y se marcó de baja manualmente a nivel de ficha. Un
// cliente recién creado sin inscripciones y sin marcar no cuenta como baja.
function clienteDeBajaDelTodo(cliente) {
  const inscs = inscripcionesDeCliente(cliente.ID);
  if (inscs.length === 0) return cliente.Estado === 'baja';
  return !inscs.some(function (i) { return i.Estado === 'activo'; });
}

function clienteCoincideFiltro(cliente) {
  if (!state.mostrarBajas && clienteDeBajaDelTodo(cliente)) return false;
  if (!state.filtroCentro && !state.filtroHorario) return true;
  return inscripcionesDeCliente(cliente.ID).some(function (i) {
    if (state.filtroCentro && i.Centro !== state.filtroCentro) return false;
    if (state.filtroHorario && (i.Dia !== state.filtroHorario.dia || i.Hora !== state.filtroHorario.hora)) return false;
    return true;
  });
}

function renderClientes() {
  const clientes = state.clientes
    .filter(clienteCoincideFiltro)
    .sort(function (a, b) { return a.Nombre.localeCompare(b.Nombre); });
  const horariosDisponibles = state.filtroCentro ? horariosDeCentro(state.filtroCentro) : [];

  return '' +
    '<div class="pill-row">' +
      '<select class="select-estado" id="filtro-centro">' +
        '<option value="">Todos los centros</option>' +
        CENTROS.map(function (c) {
          return '<option value="' + c + '"' + (state.filtroCentro === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('') +
      '</select>' +
      (state.filtroCentro
        ? '<select class="select-estado" id="filtro-horario">' +
          '<option value="">Todos los horarios</option>' +
          horariosDisponibles.map(function (h) {
            const valor = h.dia + '|' + h.hora;
            const sel = state.filtroHorario && state.filtroHorario.dia === h.dia && state.filtroHorario.hora === h.hora;
            return '<option value="' + valor + '"' + (sel ? ' selected' : '') + '>' + h.dia + ' ' + h.hora + '</option>';
          }).join('') +
          '</select>'
        : '') +
    '</div>' +
    '<label class="alumno-meta" style="display:flex;align-items:center;gap:6px;">' +
      '<input type="checkbox" id="filtro-mostrar-bajas" ' + (state.mostrarBajas ? 'checked' : '') + '> Mostrar también las bajas' +
    '</label>' +
    '<div class="section-title">Clientes (' + clientes.length + ')</div>' +
    (clientes.length === 0
      ? '<p class="empty-state">No hay clientes con ese filtro.</p>'
      : clientes.map(renderClienteCard).join('')) +
    '<button class="btn btn-primary btn-block" data-accion="abrir-nuevo-cliente">+ Nuevo cliente</button>';
}

function renderClienteCard(c) {
  const deBaja = clienteDeBajaDelTodo(c);
  return '' +
    '<div class="card">' +
      '<div class="alumno-top">' +
        '<span class="alumno-nombre">' + c.Nombre + (c.Referencia ? ' — ' + c.Referencia : '') +
          (deBaja ? ' <span class="alumno-meta">(de baja)</span>' : '') +
        '</span>' +
        '<button class="back-link" data-accion="editar-cliente" data-id="' + c.ID + '">Editar</button>' +
      '</div>' +
      (c.Telefono ? '<div class="alumno-meta">' + renderTelefonoWhatsapp(c.Telefono) + '</div>' : '') +
      (c.Notas ? '<div class="alumno-meta">' + c.Notas + '</div>' : '') +
      '<button class="btn-danger-link" data-accion="gestionar-cliente" data-id="' + c.ID + '">Gestionar</button>' +
    '</div>';
}

// Enlace wa.me a partir del teléfono guardado. Asume España (prefijo 34) si
// el número tiene 9 dígitos sin prefijo — ajusta si algún cliente es de fuera.
function telefonoParaWhatsapp_(telefono) {
  let digitos = String(telefono).replace(/\D/g, '');
  if (digitos.length === 9) digitos = '34' + digitos;
  return digitos;
}

function renderTelefonoWhatsapp(telefono) {
  const digitos = telefonoParaWhatsapp_(telefono);
  if (!digitos) return telefono;
  return '<a class="whatsapp-link" href="https://wa.me/' + digitos + '" target="_blank" rel="noopener">💬 ' + telefono + '</a>';
}

// --- Consultas: historial de sesiones de un cliente ---

function primerDiaDeMes(mes) {
  return mes + '-01';
}

function ultimoDiaDeMes(mes) {
  const partes = mes.split('-').map(Number);
  return formatoFechaLocal(new Date(partes[0], partes[1], 0));
}

function rangoConsultaFechas() {
  if (state.consultaRango === 'actual') {
    const mes = mesActual();
    return { desde: primerDiaDeMes(mes), hasta: ultimoDiaDeMes(mes) };
  }
  if (state.consultaRango === 'siguiente') {
    const mes = sumarMeses(mesActual(), 1);
    return { desde: primerDiaDeMes(mes), hasta: ultimoDiaDeMes(mes) };
  }
  if (state.consultaRango === 'personalizada') {
    return { desde: state.consultaDesde || '', hasta: state.consultaHasta || '' };
  }
  return { desde: '', hasta: '' }; // todas
}

async function cargarSesionesCliente() {
  state.cargando = true;
  render();
  try {
    const rango = rangoConsultaFechas();
    const params = { idCliente: state.consultaCliente };
    if (rango.desde) params.desde = rango.desde;
    if (rango.hasta) params.hasta = rango.hasta;
    state.sesionesCliente = await apiGet('getSesionesCliente', params);
  } catch (err) {
    mostrarToast('Error cargando sesiones: ' + err.message);
  }
  state.cargando = false;
  render();
}

const ETIQUETAS_RANGO_CONSULTA = { todas: 'Todas', actual: 'Mes actual', siguiente: 'Mes siguiente', personalizada: 'Personalizada' };
const ETIQUETAS_ESTADO_ASISTENCIA = { pendiente: 'Pendiente', asiste: 'Asiste', cancelada: 'Cancelada', no_show: 'No show' };

function renderConsultas() {
  if (!state.consultaCliente) {
    const clientes = state.clientes.slice().sort(function (a, b) { return a.Nombre.localeCompare(b.Nombre); });
    return '' +
      '<div class="section-title">Consultar sesiones de un cliente</div>' +
      '<select class="select-estado" id="consulta-cliente-select">' +
        '<option value="">Elige un cliente…</option>' +
        clientes.map(function (c) {
          return '<option value="' + c.ID + '">' + c.Nombre + (c.Referencia ? ' (' + c.Referencia + ')' : '') + '</option>';
        }).join('') +
      '</select>';
  }

  const cliente = clientePorId(state.consultaCliente);
  const hoy = hoyISO();
  const pasadas = state.sesionesCliente.filter(function (f) { return f.Fecha < hoy; });
  const futuras = state.sesionesCliente.filter(function (f) { return f.Fecha >= hoy; });

  return '' +
    '<div class="top-bar"><button class="back-link" data-accion="volver-consultas">&larr; Elegir otro cliente</button></div>' +
    '<div class="section-title">' + (cliente ? cliente.Nombre : '') + '</div>' +
    '<div class="pill-row">' +
      Object.keys(ETIQUETAS_RANGO_CONSULTA).map(function (r) {
        return '<button class="pill ' + (state.consultaRango === r ? 'active' : '') + '" data-accion="consulta-rango" data-rango="' + r + '">' +
          ETIQUETAS_RANGO_CONSULTA[r] + '</button>';
      }).join('') +
    '</div>' +
    (state.consultaRango === 'personalizada'
      ? '<div class="field"><label>Desde</label><input type="date" id="consulta-desde" value="' + state.consultaDesde + '"></div>' +
        '<div class="field"><label>Hasta</label><input type="date" id="consulta-hasta" value="' + state.consultaHasta + '"></div>' +
        '<button class="btn btn-secondary btn-block" data-accion="consulta-buscar-personalizada">Buscar</button>'
      : '') +
    (state.sesionesCliente.length === 0
      ? '<p class="empty-state">No hay sesiones registradas en este rango.</p>'
      : '' +
        (pasadas.length > 0 ? '<div class="section-title">Pasadas</div>' + pasadas.map(renderSesionClienteCard).join('') : '') +
        (futuras.length > 0 ? '<div class="section-title">Futuras</div>' + futuras.map(renderSesionClienteCard).join('') : ''));
}

function renderSesionClienteCard(f) {
  const etiquetaEstado = ETIQUETAS_ESTADO_ASISTENCIA[f.Estado] || f.Estado;
  const tipoTag = f.Tipo !== 'regular' ? ' <span class="alumno-meta">(' + f.Tipo + ')</span>' : '';
  return '' +
    '<div class="card alumno-card ' + claseEstado(f.Estado) + '">' +
      '<div class="alumno-top"><span class="alumno-nombre">' + formateaFechaCorta(f.Fecha) + tipoTag + '</span></div>' +
      '<div class="alumno-meta">' + f.Centro + ' — ' + f.Dia + ' ' + f.Hora + ' · ' + etiquetaEstado + '</div>' +
    '</div>';
}

// --- Configuración: catálogo de clases y tarifas por centro ---

function servicioImporte(servicios, clases) {
  const s = servicios.find(function (x) { return Number(x.ClasesSemana) === clases; });
  return s ? s.Importe : '';
}

function renderConfiguracion() {
  return '' +
    CENTROS.map(renderConfiguracionClasesCentro).join('') +
    '<div class="section-title">Tarifas de suscripción</div>' +
    CENTROS.map(renderConfiguracionTarifasCentro).join('');
}

function renderConfiguracionClasesCentro(centro) {
  const clases = state.clases
    .filter(function (c) { return c.Centro === centro; })
    .sort(function (a, b) {
      const diffDia = ORDEN_DIAS.indexOf(a.Dia) - ORDEN_DIAS.indexOf(b.Dia);
      if (diffDia !== 0) return diffDia;
      return a.Hora.localeCompare(b.Hora);
    });
  return '' +
    '<div class="section-title">' + centro + ' — Clases</div>' +
    (clases.length === 0
      ? '<p class="empty-state">No hay clases definidas todavía en ' + centro + '.</p>'
      : clases.map(renderConfiguracionClaseCard).join('')) +
    '<button class="btn btn-secondary btn-block" data-accion="abrir-nueva-clase" data-centro="' + centro + '">+ Nueva clase en ' + centro + '</button>';
}

function renderConfiguracionClaseCard(c) {
  const activa = c.Estado === 'activo';
  return '' +
    '<div class="card alumno-card ' + (activa ? '' : 'cancelada') + '">' +
      '<div class="alumno-top">' +
        '<span class="alumno-nombre">' + c.Dia + ' ' + c.Hora + (activa ? '' : ' <span class="alumno-meta">(inactiva)</span>') + '</span>' +
        '<button class="btn-danger-link" data-accion="' + (activa ? 'baja-clase' : 'reactivar-clase') + '" data-id="' + c.ID + '">' +
          (activa ? 'Desactivar' : 'Reactivar') +
        '</button>' +
      '</div>' +
    '</div>';
}

function renderConfiguracionTarifasCentro(centro) {
  const servicios = state.servicios.filter(function (s) { return s.Centro === centro; });
  return '' +
    '<div class="card">' +
      '<div class="alumno-nombre">' + centro + '</div>' +
      '<div class="alumno-controls">' +
        '<span class="alumno-meta">1 clase/semana</span>' +
        '<input type="number" class="importe-input" data-accion="cambiar-tarifa" data-centro="' + centro + '" data-clases="1" value="' + servicioImporte(servicios, 1) + '" step="0.5">' +
        '<span>€</span>' +
      '</div>' +
      '<div class="alumno-controls">' +
        '<span class="alumno-meta">2 clases/semana</span>' +
        '<input type="number" class="importe-input" data-accion="cambiar-tarifa" data-centro="' + centro + '" data-clases="2" value="' + servicioImporte(servicios, 2) + '" step="0.5">' +
        '<span>€</span>' +
      '</div>' +
    '</div>';
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
        '</div>');
}

// --- Cobros: cuota de suscripción por cliente y centro ---

function clienteDeBajaEnCentro(idCliente, centro) {
  const insc = inscripcionesDeCliente(idCliente).filter(function (i) { return i.Centro === centro; });
  return insc.length > 0 && !insc.some(function (i) { return i.Estado === 'activo'; });
}

function renderPagosCentro() {
  const horarios = horariosDeCentro(state.centro);
  const pagos = pagosDeCentro();
  const pagados = pagos.filter(esPagado).length;
  return '' +
    '<div class="top-bar"><button class="back-link" data-accion="volver-centro">&larr; Centros</button></div>' +
    '<div class="section-title">' + state.centro + '</div>' +
    (horarios.length === 0 ? '' :
      '<select class="select-estado" id="filtro-horario-cobros">' +
        '<option value="">Todas las clases</option>' +
        horarios.map(function (h) {
          const valor = h.dia + '|' + h.hora;
          const sel = state.filtroHorarioCobros && state.filtroHorarioCobros.dia === h.dia && state.filtroHorarioCobros.hora === h.hora;
          return '<option value="' + valor + '"' + (sel ? ' selected' : '') + '>' + h.dia + ' ' + h.hora + '</option>';
        }).join('') +
      '</select>') +
    '<div class="resumen-mes">' + pagados + ' de ' + pagos.length + ' pagados este mes</div>' +
    (pagos.length === 0
      ? '<p class="empty-state">No hay clientes en este centro para este mes.</p>'
      : pagos.map(renderPagoCard).join('')) +
    '<button class="btn btn-primary btn-block" data-accion="abrir-alta-alumno">+ Alta en ' + state.centro + '</button>';
}

function esPagado(p) {
  return p.Pagado === true || p.Pagado === 'TRUE' || p.Pagado === 'true';
}

function renderPagoCard(p) {
  const pagado = esPagado(p);
  const especial = p.Importe === '' || p.Importe === null || p.Importe === undefined;
  const clases = Number(p.ClasesSemana) || 0;
  const etiqueta = especial
    ? 'Tarifa especial'
    : (clases + (clases === 1 ? ' clase/semana' : ' clases/semana'));
  const clave = p.ID_Cliente + '|' + p.Centro;
  const deBaja = clienteDeBajaEnCentro(p.ID_Cliente, p.Centro);
  const cliente = clientePorId(p.ID_Cliente);
  const referencia = cliente && cliente.Referencia ? cliente.Referencia : '';
  return '' +
    '<div class="card alumno-card ' + (pagado ? 'pagado' : 'pendiente') + '">' +
      '<div class="alumno-top">' +
        '<span class="alumno-nombre">' + p.Nombre + (deBaja ? ' <span class="alumno-meta">(de baja)</span>' : '') + '</span>' +
        '<button class="back-link" data-accion="gestionar-cliente" data-id="' + p.ID_Cliente + '">Gestionar</button>' +
      '</div>' +
      (referencia ? '<div class="alumno-meta">' + referencia + '</div>' : '') +
      '<div class="alumno-meta">' + etiqueta + '</div>' +
      '<div class="alumno-controls">' +
        '<input type="checkbox" class="checkbox-pagado" data-accion="toggle-pagado" data-key="' + clave + '" ' + (pagado ? 'checked' : '') + '>' +
        '<span>Pagado</span>' +
        '<input type="number" class="importe-input" data-accion="cambiar-importe" data-key="' + clave + '" value="' + (especial ? '' : p.Importe) + '" step="0.5" placeholder="' + (especial ? 'importe' : '') + '">' +
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
  const filas = state.asistencias
    .filter(function (f) { return f.Estado !== 'eliminado'; })
    .sort(function (a, b) { return a.Nombre.localeCompare(b.Nombre); });
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
      '<div class="alumno-top">' +
        '<span class="alumno-nombre">' + f.Nombre + tipoTag + '</span>' +
        '<button class="btn-danger-link" data-accion="eliminar-asistencia" data-id="' + f.ID + '" data-nombre="' + f.Nombre + '">Eliminar</button>' +
      '</div>' +
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
      el.addEventListener('click', async function () {
        state.centro = el.dataset.centro;
        if (state.modulo === 'cobros') {
          state.screen = 'pagos';
          state.filtroHorarioCobros = null;
          await cargarPagosMes();
        } else {
          state.screen = 'horario';
          render();
        }
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
        state.screen = 'sesiones';
        await cargarFechasSesion();
      });
    } else if (accion === 'volver-horario') {
      el.addEventListener('click', function () {
        state.screen = 'horario';
        state.horario = null;
        render();
      });
    } else if (accion === 'toggle-pagado') {
      el.addEventListener('change', async function () {
        const partes = el.dataset.key.split('|');
        await actualizarPago(partes[0], partes[1], { Pagado: el.checked, FechaPago: el.checked ? hoyISO() : '' });
      });
    } else if (accion === 'cambiar-importe') {
      el.addEventListener('change', async function () {
        const partes = el.dataset.key.split('|');
        await actualizarPago(partes[0], partes[1], { Importe: parseFloat(el.value) || 0 });
      });
    } else if (accion === 'abrir-alta-alumno') {
      el.addEventListener('click', function () {
        abrirModalAlta(state.centro);
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
    } else if (accion === 'eliminar-asistencia') {
      el.addEventListener('click', function () {
        abrirModalEliminarAsistencia(el.dataset.id, el.dataset.nombre);
      });
    } else if (accion === 'abrir-nuevo-cliente') {
      el.addEventListener('click', function () {
        abrirModalNuevoCliente();
      });
    } else if (accion === 'editar-cliente') {
      el.addEventListener('click', function () {
        abrirModalEditarCliente(el.dataset.id);
      });
    } else if (accion === 'gestionar-cliente') {
      el.addEventListener('click', function () {
        abrirModalGestionarCliente(el.dataset.id);
      });
    } else if (accion === 'volver-consultas') {
      el.addEventListener('click', function () {
        state.consultaCliente = null;
        state.sesionesCliente = [];
        render();
      });
    } else if (accion === 'consulta-rango') {
      el.addEventListener('click', async function () {
        state.consultaRango = el.dataset.rango;
        if (state.consultaRango === 'personalizada') render();
        else await cargarSesionesCliente();
      });
    } else if (accion === 'consulta-buscar-personalizada') {
      el.addEventListener('click', async function () {
        state.consultaDesde = document.getElementById('consulta-desde').value;
        state.consultaHasta = document.getElementById('consulta-hasta').value;
        await cargarSesionesCliente();
      });
    } else if (accion === 'abrir-nueva-clase') {
      el.addEventListener('click', function () {
        abrirModalNuevaClase(el.dataset.centro);
      });
    } else if (accion === 'baja-clase') {
      el.addEventListener('click', async function () {
        try {
          await apiPost('bajaClase', { id: el.dataset.id });
          mostrarToast('Clase desactivada');
          await cargarClases();
          render();
        } catch (err) {
          mostrarToast('Error: ' + err.message);
        }
      });
    } else if (accion === 'reactivar-clase') {
      el.addEventListener('click', async function () {
        try {
          await apiPost('reactivarClase', { id: el.dataset.id });
          mostrarToast('Clase reactivada');
          await cargarClases();
          render();
        } catch (err) {
          mostrarToast('Error: ' + err.message);
        }
      });
    } else if (accion === 'cambiar-tarifa') {
      el.addEventListener('change', async function () {
        try {
          await apiPost('setServicio', {
            centro: el.dataset.centro, clasesSemana: Number(el.dataset.clases), importe: parseFloat(el.value) || 0
          });
          mostrarToast('Tarifa actualizada');
          await cargarServicios();
        } catch (err) {
          mostrarToast('Error: ' + err.message);
        }
      });
    }
  });
}

async function actualizarPago(idCliente, centro, cambios) {
  const pago = state.pagos.find(function (p) { return String(p.ID_Cliente) === String(idCliente) && p.Centro === centro; });
  if (!pago) return;
  Object.assign(pago, cambios);
  try {
    await apiPost('setPago', {
      mes: state.mes,
      idCliente: idCliente,
      centro: centro,
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

// --- Modal: nueva clase en el catálogo de un centro (módulo Configuración) ---

function abrirModalNuevaClase(centro) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Nueva clase en ' + centro + '</h2>' +
      '<div class="field"><label>Día</label>' +
        '<select id="nc-dia">' +
          ORDEN_DIAS.map(function (d) { return '<option value="' + d + '">' + d + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="field"><label>Hora (ej. 18:00)</label><input type="text" id="nc-hora"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-nc">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-nc-btn">Crear</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-nc').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-nc-btn').addEventListener('click', async function () {
    const dia = document.getElementById('nc-dia').value;
    const hora = document.getElementById('nc-hora').value.trim();
    if (!hora) {
      mostrarToast('Escribe la hora');
      return;
    }
    try {
      await apiPost('addClase', { centro: centro, dia: dia, hora: hora });
      mostrarToast('Clase creada');
      overlay.remove();
      await cargarClases();
      render();
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: alta de inscripción (elige cliente existente o crea uno nuevo) ---

const OPCION_CLIENTE_NUEVO = '__nuevo__';

// HTML del selector de clase (Día+Hora) de un centro, a partir del catálogo
// definido en Configuración — o un aviso si todavía no hay ninguna creada.
function opcionesHorarioHtml(centro, idSelect) {
  const horarios = horariosDeCentro(centro);
  if (horarios.length === 0) {
    return '<p class="alumno-meta">No hay clases definidas en ' + centro + ' todavía. Créalas primero en Configuración.</p>';
  }
  return '<select id="' + idSelect + '">' +
    horarios.map(function (h) {
      const valor = h.dia + '|' + h.hora;
      return '<option value="' + valor + '">' + h.dia + ' ' + h.hora + '</option>';
    }).join('') +
    '</select>';
}

function abrirModalAlta(centroFijo) {
  const clientesOrdenados = state.clientes.slice().sort(function (a, b) { return a.Nombre.localeCompare(b.Nombre); });
  const opcionesCliente = clientesOrdenados.map(function (c) {
    return '<option value="' + c.ID + '">' + c.Nombre + (c.Referencia ? ' (' + c.Referencia + ')' : '') + '</option>';
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Nueva alta</h2>' +
      '<div class="field"><label>Cliente</label>' +
        '<select id="alta-cliente">' +
          '<option value="' + OPCION_CLIENTE_NUEVO + '">+ Cliente nuevo…</option>' +
          opcionesCliente +
        '</select>' +
      '</div>' +
      '<div id="alta-cliente-nuevo-campos" hidden>' +
        '<div class="field"><label>Nombre completo</label><input type="text" id="alta-nombre"></div>' +
        '<div class="field"><label>Referencia (opcional)</label><input type="text" id="alta-referencia" placeholder="ej. SV L 17:30"></div>' +
        '<div class="field"><label>Teléfono</label><input type="text" id="alta-telefono"></div>' +
      '</div>' +
      '<div class="field"><label>Centro</label><input type="text" id="alta-centro" value="' + centroFijo + '" readonly></div>' +
      '<div class="field"><label>Clase</label>' + opcionesHorarioHtml(centroFijo, 'alta-horario') + '</div>' +
      '<p class="alumno-meta">El importe se calcula solo según la tarifa de suscripción (cuántas clases/semana tenga en este centro).</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-alta">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-alta-btn">Guardar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  const selectCliente = document.getElementById('alta-cliente');
  const camposNuevo = document.getElementById('alta-cliente-nuevo-campos');
  function actualizarVisibilidadNuevo() {
    camposNuevo.hidden = selectCliente.value !== OPCION_CLIENTE_NUEVO;
  }
  actualizarVisibilidadNuevo();
  selectCliente.addEventListener('change', actualizarVisibilidadNuevo);

  document.getElementById('cancelar-alta').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-alta-btn').addEventListener('click', async function () {
    const centro = document.getElementById('alta-centro').value.trim();
    const selectHorario = document.getElementById('alta-horario');
    if (!selectHorario) {
      mostrarToast('Define antes una clase en Configuración');
      return;
    }
    const partesHorario = selectHorario.value.split('|');
    const dia = partesHorario[0];
    const hora = partesHorario[1];
    try {
      let idCliente = selectCliente.value;
      if (idCliente === OPCION_CLIENTE_NUEVO) {
        const nombre = document.getElementById('alta-nombre').value.trim();
        const referencia = document.getElementById('alta-referencia').value.trim();
        const telefono = document.getElementById('alta-telefono').value.trim();
        if (!nombre) {
          mostrarToast('Escribe el nombre del cliente nuevo');
          return;
        }
        if (!avisoTelefonoDuplicado(telefono)) return;
        const nuevoCliente = await apiPost('addCliente', { nombre: nombre, referencia: referencia, telefono: telefono });
        idCliente = nuevoCliente.ID;
      }
      await apiPost('addInscripcion', {
        idCliente: idCliente, centro: centro, dia: dia, hora: hora, fechaAlta: hoyISO()
      });
      mostrarToast('Alumno/a dado de alta');
      overlay.remove();
      await Promise.all([cargarAlumnos(), cargarClientes()]);
      await cargarPagosMes();
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: nuevo cliente (desde el módulo Clientes) ---

function abrirModalNuevoCliente() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Nuevo cliente</h2>' +
      '<div class="field"><label>Nombre completo</label><input type="text" id="cli-nombre"></div>' +
      '<div class="field"><label>Referencia (opcional)</label><input type="text" id="cli-referencia" placeholder="ej. SV L 17:30"></div>' +
      '<div class="field"><label>Teléfono</label><input type="text" id="cli-telefono"></div>' +
      '<div class="field"><label>Notas</label><input type="text" id="cli-notas"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-cliente">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-cliente-btn">Guardar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-cliente').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-cliente-btn').addEventListener('click', async function () {
    const nombre = document.getElementById('cli-nombre').value.trim();
    const referencia = document.getElementById('cli-referencia').value.trim();
    const telefono = document.getElementById('cli-telefono').value.trim();
    const notas = document.getElementById('cli-notas').value.trim();
    if (!nombre) {
      mostrarToast('Escribe al menos el nombre');
      return;
    }
    if (!avisoTelefonoDuplicado(telefono)) return;
    try {
      await apiPost('addCliente', { nombre: nombre, referencia: referencia, telefono: telefono, notas: notas });
      mostrarToast('Cliente creado');
      overlay.remove();
      await cargarClientes();
      render();
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: editar cliente existente ---

function abrirModalEditarCliente(id) {
  const cliente = state.clientes.find(function (c) { return String(c.ID) === String(id); });
  if (!cliente) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Editar cliente</h2>' +
      '<div class="field"><label>Nombre completo</label><input type="text" id="cli-nombre" value="' + (cliente.Nombre || '') + '"></div>' +
      '<div class="field"><label>Referencia</label><input type="text" id="cli-referencia" value="' + (cliente.Referencia || '') + '" placeholder="ej. SV L 17:30"></div>' +
      '<div class="field"><label>Teléfono</label><input type="text" id="cli-telefono" value="' + (cliente.Telefono || '') + '"></div>' +
      '<div class="field"><label>Notas</label><input type="text" id="cli-notas" value="' + (cliente.Notas || '') + '"></div>' +
      '<p class="alumno-meta">Si cambias el nombre, las inscripciones ya creadas no se actualizan solas (Cobros/Asistencia seguirán mostrando el nombre con el que se dieron de alta).</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-cliente">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-cliente-btn">Guardar cambios</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-cliente').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-cliente-btn').addEventListener('click', async function () {
    const nombre = document.getElementById('cli-nombre').value.trim();
    const referencia = document.getElementById('cli-referencia').value.trim();
    const telefono = document.getElementById('cli-telefono').value.trim();
    const notas = document.getElementById('cli-notas').value.trim();
    if (!nombre) {
      mostrarToast('Escribe al menos el nombre');
      return;
    }
    try {
      await apiPost('actualizarCliente', { id: id, nombre: nombre, referencia: referencia, telefono: telefono, notas: notas });
      mostrarToast('Cliente actualizado');
      overlay.remove();
      await cargarClientes();
      render();
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: gestionar cliente (baja por grupo + tarifa especial por centro) ---

function abrirModalGestionarCliente(idCliente) {
  const cliente = state.clientes.find(function (c) { return String(c.ID) === String(idCliente); });
  if (!cliente) return;
  const inscripciones = inscripcionesDeCliente(idCliente);

  const porCentro = {};
  inscripciones.forEach(function (i) {
    if (!porCentro[i.Centro]) porCentro[i.Centro] = [];
    porCentro[i.Centro].push(i);
  });

  const sinClases = Object.keys(porCentro).length === 0;
  const contenidoCentros = sinClases
    ? '<p class="empty-state">Todavía no tiene ninguna clase asociada.</p>' +
      (cliente.Estado === 'baja'
        ? '<button class="btn btn-primary btn-block" id="reactivar-cliente-btn">Reactivar cliente</button>'
        : '<button class="btn btn-danger btn-block" id="baja-cliente-btn">Dar de baja a este cliente</button>')
    : Object.keys(porCentro).sort().map(function (centro) {
        const grupo = porCentro[centro];
        const activasCentro = grupo.filter(function (i) { return i.Estado === 'activo'; });
        const especial = grupo.some(function (i) { return esVerdadero(i.TarifaEspecial); });
        return '' +
          '<div class="section-title">' + centro + '</div>' +
          '<label class="alumno-meta" style="display:flex;align-items:center;gap:6px;">' +
            '<input type="checkbox" data-especial-centro="' + centro + '" ' + (especial ? 'checked' : '') + '> Tarifa especial en este centro' +
          '</label>' +
          (activasCentro.length === 0
            ? '<p class="empty-state">Sin grupos activos en este centro.</p>'
            : activasCentro.map(function (i) {
                return '' +
                  '<div class="card alumno-card pendiente">' +
                    '<div class="alumno-top"><span class="alumno-nombre">' + i.Dia + ' ' + i.Hora + '</span></div>' +
                    '<button class="btn btn-danger btn-block" data-baja-insc="' + i.ID + '">Dar de baja este grupo</button>' +
                  '</div>';
              }).join(''));
      }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Gestionar a ' + cliente.Nombre + '</h2>' +
      contenidoCentros +
      '<button class="btn btn-secondary btn-block" id="abrir-anadir-clase-btn">+ Añadir clase</button>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cerrar-gestionar-cliente">Cerrar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cerrar-gestionar-cliente').addEventListener('click', function () { overlay.remove(); });

  document.getElementById('abrir-anadir-clase-btn').addEventListener('click', function () {
    overlay.remove();
    abrirModalAnadirClase(idCliente);
  });

  const btnBajaCliente = document.getElementById('baja-cliente-btn');
  if (btnBajaCliente) {
    btnBajaCliente.addEventListener('click', async function () {
      try {
        await apiPost('bajaCliente', { id: idCliente });
        mostrarToast('Cliente dado de baja');
        overlay.remove();
        await cargarClientes();
        render();
      } catch (err) {
        mostrarToast('Error: ' + err.message);
      }
    });
  }

  const btnReactivarCliente = document.getElementById('reactivar-cliente-btn');
  if (btnReactivarCliente) {
    btnReactivarCliente.addEventListener('click', async function () {
      try {
        await apiPost('reactivarCliente', { id: idCliente });
        mostrarToast('Cliente reactivado');
        overlay.remove();
        await cargarClientes();
        render();
      } catch (err) {
        mostrarToast('Error: ' + err.message);
      }
    });
  }

  overlay.querySelectorAll('[data-baja-insc]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await apiPost('bajaInscripcion', { id: btn.dataset.bajaInsc, fechaBaja: hoyISO() });
        mostrarToast('Dado de baja');
        overlay.remove();
        await cargarAlumnos();
        if (state.modulo === 'cobros') await cargarPagosMes();
        else render();
      } catch (err) {
        mostrarToast('Error: ' + err.message);
      }
    });
  });

  overlay.querySelectorAll('[data-especial-centro]').forEach(function (chk) {
    chk.addEventListener('change', async function () {
      try {
        await apiPost('setTarifaEspecial', { idCliente: idCliente, centro: chk.dataset.especialCentro, especial: chk.checked });
        mostrarToast('Actualizado');
        await cargarAlumnos();
      } catch (err) {
        mostrarToast('Error: ' + err.message);
        chk.checked = !chk.checked;
      }
    });
  });
}

// --- Modal: añadir clase a un cliente ya existente, desde su ficha ---

function abrirModalAnadirClase(idCliente) {
  const cliente = state.clientes.find(function (c) { return String(c.ID) === String(idCliente); });
  if (!cliente) return;

  const centroInicial = CENTROS[0];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Añadir clase a ' + cliente.Nombre + '</h2>' +
      '<div class="field"><label>Centro</label>' +
        '<select id="clase-centro">' +
          CENTROS.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="field" id="clase-horario-campo">' + opcionesHorarioHtml(centroInicial, 'clase-horario') + '</div>' +
      '<p class="alumno-meta">El importe se calcula solo según cuántas clases/semana tenga en ese centro.</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-clase">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-clase-btn">Guardar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('clase-centro').addEventListener('change', function (e) {
    document.getElementById('clase-horario-campo').innerHTML = opcionesHorarioHtml(e.target.value, 'clase-horario');
  });

  document.getElementById('cancelar-clase').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-clase-btn').addEventListener('click', async function () {
    const centro = document.getElementById('clase-centro').value;
    const selectHorario = document.getElementById('clase-horario');
    if (!selectHorario) {
      mostrarToast('Define antes una clase en Configuración');
      return;
    }
    const partesHorario = selectHorario.value.split('|');
    const dia = partesHorario[0];
    const hora = partesHorario[1];
    try {
      await apiPost('addInscripcion', { idCliente: idCliente, centro: centro, dia: dia, hora: hora, fechaAlta: hoyISO() });
      mostrarToast('Clase añadida');
      overlay.remove();
      await Promise.all([cargarAlumnos(), cargarClientes()]);
      if (state.modulo === 'cobros' && state.screen === 'pagos') await cargarPagosMes();
      else render();
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

// --- Modal: añadir recuperación / suelta / prueba ---

// Clientes con alguna inscripción activa en un centro (para elegir a quién
// se le computa una recuperación, venga de la clase que venga en ese centro).
function clientesDeCentro(centro) {
  return state.clientes
    .filter(function (c) {
      return inscripcionesDeCliente(c.ID).some(function (i) { return i.Centro === centro && i.Estado === 'activo'; });
    })
    .sort(function (a, b) { return a.Nombre.localeCompare(b.Nombre); });
}

function abrirModalAsistente() {
  const clientesCentro = clientesDeCentro(state.centro);
  const opcionesCliente = clientesCentro.map(function (c) {
    return '<option value="' + c.ID + '">' + c.Nombre + (c.Referencia ? ' (' + c.Referencia + ')' : '') + '</option>';
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Añadir a esta sesión</h2>' +
      '<div class="field"><label>Tipo</label>' +
        '<select id="asis-tipo">' +
          '<option value="recuperacion">Recuperación</option>' +
          '<option value="suelta">Clase suelta</option>' +
          '<option value="prueba">Clase de prueba</option>' +
        '</select>' +
      '</div>' +
      '<div class="field" id="asis-campo-cliente">' +
        '<label>Cliente</label>' +
        '<select id="asis-cliente">' + opcionesCliente + '</select>' +
        (clientesCentro.length === 0 ? '<p class="alumno-meta">No hay clientes activos en este centro todavía.</p>' : '') +
      '</div>' +
      '<div class="field" id="asis-campo-nombre" hidden>' +
        '<label>Nombre</label><input type="text" id="asis-nombre">' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-asis">Cancelar</button>' +
        '<button class="btn btn-primary" id="confirmar-asis-btn">Añadir</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  const selectTipo = document.getElementById('asis-tipo');
  const campoCliente = document.getElementById('asis-campo-cliente');
  const campoNombre = document.getElementById('asis-campo-nombre');
  function actualizarVisibilidadTipo() {
    const esRecuperacion = selectTipo.value === 'recuperacion';
    campoCliente.hidden = !esRecuperacion;
    campoNombre.hidden = esRecuperacion;
  }
  actualizarVisibilidadTipo();
  selectTipo.addEventListener('change', actualizarVisibilidadTipo);

  document.getElementById('cancelar-asis').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-asis-btn').addEventListener('click', async function () {
    const tipo = selectTipo.value;
    const payload = {
      fecha: state.sesionFecha, centro: state.centro, dia: state.horario.dia, hora: state.horario.hora, tipo: tipo
    };
    if (tipo === 'recuperacion') {
      const idCliente = document.getElementById('asis-cliente').value;
      if (!idCliente) {
        mostrarToast('Elige un cliente');
        return;
      }
      payload.idCliente = idCliente;
    } else {
      const nombre = document.getElementById('asis-nombre').value.trim();
      if (!nombre) {
        mostrarToast('Escribe un nombre');
        return;
      }
      payload.nombre = nombre;
    }
    try {
      await apiPost('addAsistente', payload);
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

// --- Modal: eliminar un registro de asistencia ---

function abrirModalEliminarAsistencia(id, nombre) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '' +
    '<div class="modal-sheet">' +
      '<h2>Eliminar registro</h2>' +
      '<p>Se borrará por completo el registro de asistencia de "' + nombre + '" en esta sesión. No se puede deshacer.</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="cancelar-eliminar-asis">Cancelar</button>' +
        '<button class="btn btn-danger" id="confirmar-eliminar-asis-btn">Eliminar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  document.getElementById('cancelar-eliminar-asis').addEventListener('click', function () { overlay.remove(); });
  document.getElementById('confirmar-eliminar-asis-btn').addEventListener('click', async function () {
    try {
      await apiPost('eliminarAsistencia', { id: id });
      mostrarToast('Registro eliminado');
      overlay.remove();
      await cargarAsistenciaFecha(state.sesionFecha);
    } catch (err) {
      mostrarToast('Error: ' + err.message);
    }
  });
}

init();
