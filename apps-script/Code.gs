/**
 * API de la app de Cobros, Asistencia y Clientes — Google Apps Script
 *
 * Antes de desplegar:
 * 1. Sustituye SS_ID por el ID de tu Google Sheet (está en la URL de la hoja).
 * 2. La hoja debe tener estas pestañas con estas cabeceras exactas en la fila 1:
 *
 *    "Clientes":      ID | Nombre | Apellidos | Telefono | Notas
 *    "Inscripciones": ID | ID_Cliente | Nombre | Centro | Dia | Hora | PrecioDefecto | Estado | FechaAlta | FechaBaja
 *    "Pagos":         Mes | ID_Alumno | Nombre | Centro | Dia | Hora | Importe | Pagado | FechaPago | Notas
 *    "Asistencia":    ID | Fecha | ID_Alumno | Nombre | Centro | Dia | Hora | Tipo | Estado | Notas
 *
 *    (Pagos y Asistencia siguen usando "ID_Alumno" como nombre de columna,
 *    pero apunta al ID de la INSCRIPCIÓN — no hace falta migrar esas dos
 *    pestañas, solo lo que antes era "Alumnos".)
 *
 * 3. Implementar > Nueva implementación > Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier usuario
 *
 * Migración desde la versión anterior (una sola vez): si tu Sheet todavía
 * tiene una pestaña "Alumnos" en vez de "Clientes"+"Inscripciones", llama a
 * TU_URL/exec con POST {"action":"migrarAClientes"} una vez desplegado este
 * código. Crea "Clientes" a partir de los nombres únicos de "Alumnos" y
 * renombra "Alumnos" a "Inscripciones" añadiendo la columna ID_Cliente. Es
 * segura de repetir: si no encuentra la hoja "Alumnos" no hace nada.
 */

const SS_ID = '1BAXS6x2qk6GPI5-kmN3LPqtdPntm2g0ex8qQt0IALeY';
const SHEET_CLIENTES = 'Clientes';
const SHEET_INSCRIPCIONES = 'Inscripciones';
const SHEET_PAGOS = 'Pagos';
const SHEET_ASISTENCIA = 'Asistencia';

function getSS_() {
  return SpreadsheetApp.openById(SS_ID);
}

function getSheet_(name) {
  const sheet = getSS_().getSheetByName(name);
  if (!sheet) throw new Error('No existe la hoja "' + name + '"');
  return sheet;
}

// Google Sheets guarda "horas" y "fechas" como objetos Date internos aunque
// se vean como texto. Los normalizamos aquí para no devolver ISO-UTC crudo.
// OJO: "instanceof Date" no es fiable con valores de celda en Apps Script
// (pueden venir de un "realm" distinto); se usa Object.prototype.toString.
function esFecha_(value) {
  return !!value && Object.prototype.toString.call(value) === '[object Date]';
}

function formatearValor_(header, value) {
  if (!esFecha_(value)) return value;
  const tz = Session.getScriptTimeZone();
  if (header === 'Hora') return Utilities.formatDate(value, tz, 'HH:mm');
  if (header === 'Mes') return Utilities.formatDate(value, tz, 'yyyy-MM');
  return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
}

function sheetToObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = formatearValor_(h, row[i]); });
    return obj;
  });
}

function appendRow_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;
    switch (action) {
      case 'ping':
        result = { version: 'v6-editar-cliente', ahora: new Date().toISOString() };
        break;
      case 'getClientes':
        result = getClientes();
        break;
      case 'getInscripciones':
        result = getInscripciones();
        break;
      case 'getPagosMes':
        result = getPagosMes(e.parameter.mes);
        break;
      case 'getAsistencia':
        result = getAsistenciaFecha(e.parameter.fecha, e.parameter.centro, e.parameter.dia, e.parameter.hora);
        break;
      case 'getFechasSesion':
        result = getFechasSesionesGuardadas(e.parameter.centro, e.parameter.dia, e.parameter.hora, e.parameter.mes);
        break;
      default:
        throw new Error('Acción GET no reconocida: ' + action);
    }
    return jsonResponse_({ ok: true, data: result });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    let result;
    switch (body.action) {
      case 'addCliente':
        result = addCliente(body);
        break;
      case 'actualizarCliente':
        result = actualizarCliente(body);
        break;
      case 'addInscripcion':
        result = addInscripcion(body);
        break;
      case 'bajaInscripcion':
        result = bajaInscripcion(body.id, body.fechaBaja);
        break;
      case 'reactivarInscripcion':
        result = reactivarInscripcion(body.id);
        break;
      case 'setPago':
        result = setPago(body);
        break;
      case 'setAsistencia':
        result = setAsistencia(body);
        break;
      case 'addAsistente':
        result = addAsistente(body);
        break;
      case 'cancelarSesion':
        result = cancelarSesion(body);
        break;
      case 'migrarAClientes':
        result = migrarAClientes();
        break;
      default:
        throw new Error('Acción POST no reconocida: ' + body.action);
    }
    return jsonResponse_({ ok: true, data: result });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function getClientes() {
  return sheetToObjects_(getSheet_(SHEET_CLIENTES));
}

function addCliente(body) {
  const sheet = getSheet_(SHEET_CLIENTES);
  const nuevo = {
    ID: Utilities.getUuid(),
    Nombre: body.nombre,
    Apellidos: body.apellidos || '',
    Telefono: body.telefono || '',
    Notas: body.notas || ''
  };
  appendRow_(sheet, nuevo);
  return nuevo;
}

function actualizarCliente(body) {
  const sheet = getSheet_(SHEET_CLIENTES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxNombre = headers.indexOf('Nombre');
  const idxApellidos = headers.indexOf('Apellidos');
  const idxTelefono = headers.indexOf('Telefono');
  const idxNotas = headers.indexOf('Notas');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(body.id)) {
      if (body.nombre !== undefined) sheet.getRange(i + 1, idxNombre + 1).setValue(body.nombre);
      if (body.apellidos !== undefined) sheet.getRange(i + 1, idxApellidos + 1).setValue(body.apellidos);
      if (body.telefono !== undefined) sheet.getRange(i + 1, idxTelefono + 1).setValue(body.telefono);
      if (body.notas !== undefined) sheet.getRange(i + 1, idxNotas + 1).setValue(body.notas);
      return { updated: true };
    }
  }
  throw new Error('Cliente no encontrado');
}

function getInscripciones() {
  return sheetToObjects_(getSheet_(SHEET_INSCRIPCIONES));
}

function nombreCompletoCliente_(cliente) {
  return cliente.Apellidos ? cliente.Nombre + ' ' + cliente.Apellidos : cliente.Nombre;
}

function addInscripcion(body) {
  const clientes = getClientes();
  const cliente = clientes.find(function (c) { return String(c.ID) === String(body.idCliente); });
  if (!cliente) throw new Error('Cliente no encontrado');

  const sheet = getSheet_(SHEET_INSCRIPCIONES);
  const nueva = {
    ID: Utilities.getUuid(),
    ID_Cliente: cliente.ID,
    Nombre: nombreCompletoCliente_(cliente),
    Centro: body.centro,
    Dia: body.dia,
    Hora: body.hora,
    PrecioDefecto: body.precioDefecto,
    Estado: 'activo',
    FechaAlta: body.fechaAlta || new Date(),
    FechaBaja: ''
  };
  appendRow_(sheet, nueva);
  return nueva;
}

function bajaInscripcion(id, fechaBaja) {
  const sheet = getSheet_(SHEET_INSCRIPCIONES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxEstado = headers.indexOf('Estado');
  const idxBaja = headers.indexOf('FechaBaja');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(id)) {
      sheet.getRange(i + 1, idxEstado + 1).setValue('baja');
      sheet.getRange(i + 1, idxBaja + 1).setValue(fechaBaja || new Date());
      return { updated: true };
    }
  }
  throw new Error('Inscripción no encontrada');
}

function reactivarInscripcion(id) {
  const sheet = getSheet_(SHEET_INSCRIPCIONES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxEstado = headers.indexOf('Estado');
  const idxBaja = headers.indexOf('FechaBaja');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(id)) {
      sheet.getRange(i + 1, idxEstado + 1).setValue('activo');
      sheet.getRange(i + 1, idxBaja + 1).setValue('');
      return { updated: true };
    }
  }
  throw new Error('Inscripción no encontrada');
}

/**
 * Devuelve los pagos de un mes (YYYY-MM). Si una inscripción activa en ese
 * mes todavía no tiene fila de pago, la crea automáticamente con su precio
 * por defecto y Pagado=false.
 */
function getPagosMes(mes) {
  const sheetPagos = getSheet_(SHEET_PAGOS);
  const pagos = sheetToObjects_(sheetPagos).filter(function (p) { return p.Mes === mes; });

  const inscripciones = getInscripciones();
  const partes = mes.split('-').map(Number);
  const primerDiaMes = new Date(partes[0], partes[1] - 1, 1);
  const ultimoDiaMes = new Date(partes[0], partes[1], 0);

  const activasEnMes = inscripciones.filter(function (a) {
    const alta = a.FechaAlta ? new Date(a.FechaAlta) : null;
    const baja = a.FechaBaja ? new Date(a.FechaBaja) : null;
    if (alta && alta > ultimoDiaMes) return false;
    if (baja && baja < primerDiaMes) return false;
    return true;
  });

  const idsConPago = {};
  pagos.forEach(function (p) { idsConPago[p.ID_Alumno] = true; });

  const nuevas = activasEnMes.filter(function (a) { return !idsConPago[a.ID]; });
  nuevas.forEach(function (a) {
    const nuevoPago = {
      Mes: mes,
      ID_Alumno: a.ID,
      Nombre: a.Nombre,
      Centro: a.Centro,
      Dia: a.Dia,
      Hora: a.Hora,
      Importe: a.PrecioDefecto,
      Pagado: false,
      FechaPago: '',
      Notas: ''
    };
    appendRow_(sheetPagos, nuevoPago);
    pagos.push(nuevoPago);
  });

  return pagos;
}

function setPago(body) {
  const sheet = getSheet_(SHEET_PAGOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxMes = headers.indexOf('Mes');
  const idxId = headers.indexOf('ID_Alumno');
  const idxImporte = headers.indexOf('Importe');
  const idxPagado = headers.indexOf('Pagado');
  const idxFecha = headers.indexOf('FechaPago');
  const idxNotas = headers.indexOf('Notas');

  for (let i = 1; i < data.length; i++) {
    if (formatearValor_('Mes', data[i][idxMes]) === body.mes && String(data[i][idxId]) === String(body.idAlumno)) {
      sheet.getRange(i + 1, idxImporte + 1).setValue(body.importe);
      sheet.getRange(i + 1, idxPagado + 1).setValue(body.pagado);
      sheet.getRange(i + 1, idxFecha + 1).setValue(body.fechaPago || '');
      sheet.getRange(i + 1, idxNotas + 1).setValue(body.notas || '');
      return { updated: true };
    }
  }
  throw new Error('No se encontró el pago de esa inscripción para ese mes');
}

/**
 * Devuelve la asistencia de una sesión concreta (Fecha+Centro+Dia+Hora).
 * Genera automáticamente las filas "regular" que falten, comprobando la
 * fecha de alta/baja de cada inscripción contra la fecha exacta de la
 * sesión (no el mes completo, a diferencia de Pagos). Esto es lo que hace
 * que una baja en Cobros se refleje sola en cualquier sesión futura: si ya
 * existía una fila "regular" pendiente para alguien que después causó
 * baja, se descarta aquí en vez de mostrarla.
 */
function getAsistenciaFecha(fecha, centro, dia, hora) {
  const sheet = getSheet_(SHEET_ASISTENCIA);
  let filas = sheetToObjects_(sheet).filter(function (f) {
    return f.Fecha === fecha && f.Centro === centro && f.Dia === dia && f.Hora === hora;
  });

  const fechaSesion = new Date(fecha);
  const activas = getInscripciones().filter(function (a) {
    if (a.Centro !== centro || a.Dia !== dia || a.Hora !== hora) return false;
    const alta = a.FechaAlta ? new Date(a.FechaAlta) : null;
    const baja = a.FechaBaja ? new Date(a.FechaBaja) : null;
    if (alta && alta > fechaSesion) return false;
    if (baja && baja <= fechaSesion) return false;
    return true;
  });

  const idsActivas = {};
  activas.forEach(function (a) { idsActivas[a.ID] = true; });
  // Descarta filas "regular" de inscripciones que ya no estén activas en esta
  // fecha (por ejemplo, una baja registrada después de haber abierto la sesión).
  filas = filas.filter(function (f) { return f.Tipo !== 'regular' || idsActivas[String(f.ID_Alumno)]; });

  const idsConFila = {};
  filas.forEach(function (f) { if (f.Tipo === 'regular') idsConFila[String(f.ID_Alumno)] = true; });

  const nuevas = activas.filter(function (a) { return !idsConFila[String(a.ID)]; });
  nuevas.forEach(function (a) {
    const nueva = {
      ID: Utilities.getUuid(),
      Fecha: fecha,
      ID_Alumno: a.ID,
      Nombre: a.Nombre,
      Centro: centro,
      Dia: dia,
      Hora: hora,
      Tipo: 'regular',
      Estado: 'pendiente',
      Notas: ''
    };
    appendRow_(sheet, nueva);
    filas.push(nueva);
  });

  return filas;
}

/**
 * Fechas (YYYY-MM-DD) de un mes en las que ya existe algún registro de
 * asistencia para ese centro/horario — incluye tanto sesiones regulares ya
 * abiertas como sesiones extra (clases movidas) añadidas a mano.
 */
function getFechasSesionesGuardadas(centro, dia, hora, mes) {
  const filas = sheetToObjects_(getSheet_(SHEET_ASISTENCIA)).filter(function (f) {
    return f.Centro === centro && f.Dia === dia && f.Hora === hora && String(f.Fecha).indexOf(mes) === 0;
  });
  const fechas = {};
  filas.forEach(function (f) { fechas[f.Fecha] = true; });
  return Object.keys(fechas).sort();
}

function setAsistencia(body) {
  const sheet = getSheet_(SHEET_ASISTENCIA);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxEstado = headers.indexOf('Estado');
  const idxNotas = headers.indexOf('Notas');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(body.id)) {
      if (body.estado !== undefined) sheet.getRange(i + 1, idxEstado + 1).setValue(body.estado);
      if (body.notas !== undefined) sheet.getRange(i + 1, idxNotas + 1).setValue(body.notas);
      return { updated: true };
    }
  }
  throw new Error('No se encontró ese registro de asistencia');
}

// Persona puntual (recuperación / clase suelta / prueba) añadida a una sesión.
function addAsistente(body) {
  const sheet = getSheet_(SHEET_ASISTENCIA);
  const nueva = {
    ID: Utilities.getUuid(),
    Fecha: body.fecha,
    ID_Alumno: '',
    Nombre: body.nombre,
    Centro: body.centro,
    Dia: body.dia,
    Hora: body.hora,
    Tipo: body.tipo,
    Estado: 'pendiente',
    Notas: ''
  };
  appendRow_(sheet, nueva);
  return nueva;
}

// Marca toda una sesión (todos sus asistentes) como cancelada de golpe (festivos, etc.).
function cancelarSesion(body) {
  const filas = getAsistenciaFecha(body.fecha, body.centro, body.dia, body.hora);
  const sheet = getSheet_(SHEET_ASISTENCIA);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxEstado = headers.indexOf('Estado');

  const idsSesion = {};
  filas.forEach(function (f) { idsSesion[String(f.ID)] = true; });

  for (let i = 1; i < data.length; i++) {
    if (idsSesion[String(data[i][idxId])]) {
      sheet.getRange(i + 1, idxEstado + 1).setValue('cancelada');
    }
  }
  return { canceladas: filas.length };
}

/**
 * Migración única desde el modelo antiguo (una sola pestaña "Alumnos") al
 * nuevo modelo Clientes + Inscripciones. Idempotente: si no existe una hoja
 * "Alumnos" no hace nada (ya migrado, o instalación nueva).
 */
function migrarAClientes() {
  const ss = getSS_();
  const hojaAlumnos = ss.getSheetByName('Alumnos');
  if (!hojaAlumnos) {
    return { migrado: false, motivo: 'No existe una hoja "Alumnos" que migrar' };
  }

  let hojaClientes = ss.getSheetByName(SHEET_CLIENTES);
  if (!hojaClientes) {
    hojaClientes = ss.insertSheet(SHEET_CLIENTES);
    hojaClientes.appendRow(['ID', 'Nombre', 'Apellidos', 'Telefono', 'Notas']);
  }

  const filasAlumnos = sheetToObjects_(hojaAlumnos);
  const idClientePorNombre = {};
  const filasInscripciones = [];

  filasAlumnos.forEach(function (a) {
    let idCliente = idClientePorNombre[a.Nombre];
    if (!idCliente) {
      idCliente = Utilities.getUuid();
      idClientePorNombre[a.Nombre] = idCliente;
      hojaClientes.appendRow([idCliente, a.Nombre, '', '', '']);
    }
    filasInscripciones.push([a.ID, idCliente, a.Nombre, a.Centro, a.Dia, a.Hora, a.PrecioDefecto, a.Estado, a.FechaAlta, a.FechaBaja]);
  });

  hojaAlumnos.clearContents();
  hojaAlumnos.appendRow(['ID', 'ID_Cliente', 'Nombre', 'Centro', 'Dia', 'Hora', 'PrecioDefecto', 'Estado', 'FechaAlta', 'FechaBaja']);
  filasInscripciones.forEach(function (fila) { hojaAlumnos.appendRow(fila); });
  hojaAlumnos.setName(SHEET_INSCRIPCIONES);

  return {
    migrado: true,
    clientesCreados: Object.keys(idClientePorNombre).length,
    inscripcionesMigradas: filasInscripciones.length
  };
}
