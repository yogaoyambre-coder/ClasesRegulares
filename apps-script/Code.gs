/**
 * API de la app de Cobros, Asistencia y Clientes — Google Apps Script
 *
 * Antes de desplegar:
 * 1. Sustituye SS_ID por el ID de tu Google Sheet (está en la URL de la hoja).
 * 2. La hoja debe tener estas pestañas con estas cabeceras exactas en la fila 1:
 *
 *    "Clientes":      ID | Nombre | Referencia | Telefono | Notas | Estado
 *    "Inscripciones": ID | ID_Cliente | Nombre | Centro | Dia | Hora | Estado | FechaAlta | FechaBaja | TarifaEspecial
 *    "Pagos":         ID | Mes | ID_Cliente | Nombre | Centro | ClasesSemana | Importe | Pagado | FechaPago | Notas
 *    "Asistencia":    ID | Fecha | ID_Alumno | Nombre | Centro | Dia | Hora | Tipo | Estado | Notas
 *
 *    (Asistencia sigue usando "ID_Alumno" como nombre de columna, pero
 *    apunta al ID de la INSCRIPCIÓN.)
 *
 * 3. Implementar > Nueva implementación > Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier usuario
 *
 * Migraciones (una sola vez cada una, seguras de repetir):
 * - migrarAClientes: del modelo antiguo (una sola pestaña "Alumnos") a
 *   Clientes + Inscripciones.
 * - migrarASuscripciones: renombra Apellidos->Referencia en Clientes, añade
 *   TarifaEspecial a Inscripciones (quita PrecioDefecto si existía), y
 *   reestructura Pagos de "una fila por clase" a "una fila por cliente y
 *   centro" según la tarifa de suscripción.
 * - migrarEstadoClientes: añade la columna "Estado" a Clientes (activo por
 *   defecto) para poder dar de baja a un cliente sin ninguna clase asociada.
 */

const SS_ID = '1BAXS6x2qk6GPI5-kmN3LPqtdPntm2g0ex8qQt0IALeY';
const SHEET_CLIENTES = 'Clientes';
const SHEET_INSCRIPCIONES = 'Inscripciones';
const SHEET_PAGOS = 'Pagos';
const SHEET_ASISTENCIA = 'Asistencia';

// Tarifa de suscripción: cuota mensual según centro y clases/semana. No hay
// precio por clase suelta — es un abono, no una suma de clases.
const TARIFAS = {
  'Soma': { 1: 35, 2: 60 },
  'Gema Lanza': { 1: 35, 2: 55 }
};

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

function esVerdadero_(v) {
  return v === true || v === 'true' || v === 'TRUE';
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

// Columnas que deben guardarse siempre como texto plano. Un valor que empieza
// por "+" (típico de un teléfono internacional) Google Sheets lo interpreta
// como el inicio de una fórmula si se escribe con setValue/appendRow tal cual
// — con espacios dentro, la "fórmula" ni siquiera es válida y da #ERROR!,
// perdiendo el dato. Forzar el formato de celda a texto ("@") antes de
// escribir evita el problema.
const COLUMNAS_TEXTO_FORZADO = ['Telefono'];

function appendRow_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
  const fila = sheet.getLastRow();
  headers.forEach(function (h, i) {
    if (COLUMNAS_TEXTO_FORZADO.indexOf(h) !== -1 && obj[h]) {
      sheet.getRange(fila, i + 1).setNumberFormat('@').setValue(String(obj[h]));
    }
  });
}

function setValueTexto_(sheet, fila, columna, valor) {
  sheet.getRange(fila, columna).setNumberFormat('@').setValue(valor);
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
        result = { version: 'v11-baja-cliente-anadir-clase', ahora: new Date().toISOString() };
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
      case 'bajaCliente':
        result = bajaCliente(body.id);
        break;
      case 'reactivarCliente':
        result = reactivarCliente(body.id);
        break;
      case 'addInscripcion':
        result = addInscripcion(body);
        break;
      case 'actualizarInscripcion':
        result = actualizarInscripcion(body);
        break;
      case 'bajaInscripcion':
        result = bajaInscripcion(body.id, body.fechaBaja);
        break;
      case 'reactivarInscripcion':
        result = reactivarInscripcion(body.id);
        break;
      case 'setTarifaEspecial':
        result = setTarifaEspecial(body);
        break;
      case 'setPago':
        result = setPago(body);
        break;
      case 'eliminarPago':
        result = eliminarPago(body.id);
        break;
      case 'setAsistencia':
        result = setAsistencia(body);
        break;
      case 'addAsistente':
        result = addAsistente(body);
        break;
      case 'eliminarAsistencia':
        result = eliminarAsistencia(body.id);
        break;
      case 'cancelarSesion':
        result = cancelarSesion(body);
        break;
      case 'migrarAClientes':
        result = migrarAClientes();
        break;
      case 'migrarASuscripciones':
        result = migrarASuscripciones();
        break;
      case 'migrarEstadoClientes':
        result = migrarEstadoClientes();
        break;
      case 'repararFormatoPagos':
        result = repararFormatoPagos();
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
    Referencia: body.referencia || '',
    Telefono: body.telefono || '',
    Notas: body.notas || '',
    Estado: 'activo'
  };
  appendRow_(sheet, nuevo);
  return nuevo;
}

// Baja/reactivación a nivel de cliente — solo tiene sentido usarla cuando el
// cliente no tiene ninguna inscripción (si tiene, se da de baja cada clase
// por separado con bajaInscripcion). Sirve para poder ocultarlo de la lista
// por defecto y conservar su ficha por si vuelve.
function bajaCliente(id) {
  const sheet = getSheet_(SHEET_CLIENTES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxEstado = headers.indexOf('Estado');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(id)) {
      sheet.getRange(i + 1, idxEstado + 1).setValue('baja');
      return { updated: true };
    }
  }
  throw new Error('Cliente no encontrado');
}

function reactivarCliente(id) {
  const sheet = getSheet_(SHEET_CLIENTES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxEstado = headers.indexOf('Estado');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(id)) {
      sheet.getRange(i + 1, idxEstado + 1).setValue('activo');
      return { updated: true };
    }
  }
  throw new Error('Cliente no encontrado');
}

function actualizarCliente(body) {
  const sheet = getSheet_(SHEET_CLIENTES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxNombre = headers.indexOf('Nombre');
  const idxReferencia = headers.indexOf('Referencia');
  const idxTelefono = headers.indexOf('Telefono');
  const idxNotas = headers.indexOf('Notas');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(body.id)) {
      if (body.nombre !== undefined) sheet.getRange(i + 1, idxNombre + 1).setValue(body.nombre);
      if (body.referencia !== undefined) sheet.getRange(i + 1, idxReferencia + 1).setValue(body.referencia);
      if (body.telefono !== undefined) setValueTexto_(sheet, i + 1, idxTelefono + 1, body.telefono);
      if (body.notas !== undefined) sheet.getRange(i + 1, idxNotas + 1).setValue(body.notas);
      return { updated: true };
    }
  }
  throw new Error('Cliente no encontrado');
}

function getInscripciones() {
  return sheetToObjects_(getSheet_(SHEET_INSCRIPCIONES));
}

function addInscripcion(body) {
  const clientes = getClientes();
  const cliente = clientes.find(function (c) { return String(c.ID) === String(body.idCliente); });
  if (!cliente) throw new Error('Cliente no encontrado');
  // Si el cliente estaba de baja a nivel de ficha (sin ninguna clase) y ahora
  // se le añade una, reactivarlo: no tendría sentido seguir marcado de baja.
  if (cliente.Estado === 'baja') reactivarCliente(cliente.ID);

  const sheet = getSheet_(SHEET_INSCRIPCIONES);
  const nueva = {
    ID: Utilities.getUuid(),
    ID_Cliente: cliente.ID,
    Nombre: cliente.Nombre,
    Centro: body.centro,
    Dia: body.dia,
    Hora: body.hora,
    Estado: 'activo',
    FechaAlta: body.fechaAlta || new Date(),
    FechaBaja: '',
    TarifaEspecial: !!body.tarifaEspecial
  };
  appendRow_(sheet, nueva);
  return nueva;
}

// Corrección puntual de una inscripción ya creada (nombre, horario...).
function actualizarInscripcion(body) {
  const sheet = getSheet_(SHEET_INSCRIPCIONES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const campos = ['Nombre', 'Centro', 'Dia', 'Hora'];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(body.id)) {
      campos.forEach(function (campo) {
        const clave = campo.charAt(0).toLowerCase() + campo.slice(1);
        if (body[clave] !== undefined) {
          sheet.getRange(i + 1, headers.indexOf(campo) + 1).setValue(body[clave]);
        }
      });
      return { updated: true };
    }
  }
  throw new Error('Inscripción no encontrada');
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

// Marca (o desmarca) tarifa especial para TODAS las inscripciones de un
// cliente en un centro concreto — la tarifa especial es por cliente+centro,
// no por inscripción individual.
function setTarifaEspecial(body) {
  const sheet = getSheet_(SHEET_INSCRIPCIONES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxCliente = headers.indexOf('ID_Cliente');
  const idxCentro = headers.indexOf('Centro');
  const idxEspecial = headers.indexOf('TarifaEspecial');
  let actualizadas = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxCliente]) === String(body.idCliente) && data[i][idxCentro] === body.centro) {
      sheet.getRange(i + 1, idxEspecial + 1).setValue(!!body.especial);
      actualizadas++;
    }
  }
  return { actualizadas: actualizadas };
}

/**
 * Devuelve los pagos de un mes (YYYY-MM). Una fila = un cliente + un centro
 * (no una clase suelta): es una cuota de suscripción. Si un cliente activo
 * ese mes en un centro todavía no tiene fila de pago, se crea con el
 * importe de tarifa según cuántas inscripciones activas tiene en ese centro
 * (1 o 2 clases/semana) — o vacío si tiene marcada tarifa especial.
 */
function getPagosMes(mes) {
  const sheetPagos = getSheet_(SHEET_PAGOS);
  const pagos = sheetToObjects_(sheetPagos).filter(function (p) { return p.Mes === mes; });

  const inscripciones = getInscripciones();
  const clientes = getClientes();
  const clientePorId = {};
  clientes.forEach(function (c) { clientePorId[c.ID] = c; });

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

  const grupos = {}; // key = idCliente|centro
  activasEnMes.forEach(function (a) {
    const key = a.ID_Cliente + '|' + a.Centro;
    if (!grupos[key]) grupos[key] = { idCliente: a.ID_Cliente, centro: a.Centro, clases: 0, especial: false };
    grupos[key].clases++;
    if (esVerdadero_(a.TarifaEspecial)) grupos[key].especial = true;
  });

  const idsConPago = {};
  pagos.forEach(function (p) { idsConPago[p.ID_Cliente + '|' + p.Centro] = true; });

  Object.keys(grupos).forEach(function (key) {
    if (idsConPago[key]) return;
    const g = grupos[key];
    const cliente = clientePorId[g.idCliente];
    const tarifaCentro = TARIFAS[g.centro] || {};
    const importe = g.especial ? '' : (tarifaCentro[g.clases] !== undefined ? tarifaCentro[g.clases] : '');
    const nuevoPago = {
      ID: Utilities.getUuid(),
      Mes: mes,
      ID_Cliente: g.idCliente,
      Nombre: cliente ? cliente.Nombre : '',
      Centro: g.centro,
      ClasesSemana: g.clases,
      Importe: importe,
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
  const idxCliente = headers.indexOf('ID_Cliente');
  const idxCentro = headers.indexOf('Centro');
  const idxImporte = headers.indexOf('Importe');
  const idxPagado = headers.indexOf('Pagado');
  const idxFecha = headers.indexOf('FechaPago');
  const idxNotas = headers.indexOf('Notas');

  for (let i = 1; i < data.length; i++) {
    if (formatearValor_('Mes', data[i][idxMes]) === body.mes &&
        String(data[i][idxCliente]) === String(body.idCliente) &&
        data[i][idxCentro] === body.centro) {
      sheet.getRange(i + 1, idxImporte + 1).setValue(body.importe);
      sheet.getRange(i + 1, idxPagado + 1).setValue(body.pagado);
      sheet.getRange(i + 1, idxFecha + 1).setValue(body.fechaPago || '');
      sheet.getRange(i + 1, idxNotas + 1).setValue(body.notas || '');
      return { updated: true };
    }
  }
  throw new Error('No se encontró el pago de ese cliente/centro para ese mes');
}

function eliminarPago(id) {
  const sheet = getSheet_(SHEET_PAGOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { deleted: true };
    }
  }
  throw new Error('No se encontró ese pago');
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

// Borra por completo un registro de asistencia (para quitar pruebas o
// duplicados; a diferencia de cambiar el Estado, esto no deja rastro).
function eliminarAsistencia(id) {
  const sheet = getSheet_(SHEET_ASISTENCIA);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { deleted: true };
    }
  }
  throw new Error('No se encontró ese registro de asistencia');
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
 * modelo Clientes + Inscripciones. Idempotente: si no existe una hoja
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
    hojaClientes.appendRow(['ID', 'Nombre', 'Referencia', 'Telefono', 'Notas']);
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
    filasInscripciones.push([a.ID, idCliente, a.Nombre, a.Centro, a.Dia, a.Hora, a.Estado, a.FechaAlta, a.FechaBaja, false]);
  });

  // clear() (no solo clearContents()) para no arrastrar formato de celda
  // heredado de una columna antigua en la misma posición (p.ej. una columna
  // de fecha/hora previa haría que un número se lea luego como fecha).
  hojaAlumnos.clear();
  hojaAlumnos.appendRow(['ID', 'ID_Cliente', 'Nombre', 'Centro', 'Dia', 'Hora', 'Estado', 'FechaAlta', 'FechaBaja', 'TarifaEspecial']);
  filasInscripciones.forEach(function (fila) { hojaAlumnos.appendRow(fila); });
  hojaAlumnos.setName(SHEET_INSCRIPCIONES);

  return {
    migrado: true,
    clientesCreados: Object.keys(idClientePorNombre).length,
    inscripcionesMigradas: filasInscripciones.length
  };
}

/**
 * Migración única al modelo de suscripciones:
 * 1. Clientes: renombra la cabecera "Apellidos" a "Referencia" (mismo dato).
 * 2. Inscripciones: añade "TarifaEspecial" (false por defecto) y quita
 *    "PrecioDefecto" si existía (ya no se usa: la tarifa depende de cuántas
 *    inscripciones activas tiene un cliente en un centro, no de un precio
 *    guardado por clase).
 * 3. Pagos: pasa de "una fila por clase" a "una fila por cliente+centro",
 *    con el importe recalculado según la tarifa de suscripción. Agrupa las
 *    filas viejas de un mismo mes/cliente/centro; "pagado" queda en true si
 *    alguna de las filas agrupadas ya estaba marcada como pagada.
 * Cada paso comprueba si ya se aplicó (por la presencia de las columnas
 * nuevas) para poder ejecutarla más de una vez sin duplicar nada.
 */
function migrarASuscripciones() {
  const resultado = { clientesRenombrado: false, inscripcionesActualizadas: false, pagosMigrados: 0 };

  const hojaClientes = getSheet_(SHEET_CLIENTES);
  const headersClientes = hojaClientes.getRange(1, 1, 1, hojaClientes.getLastColumn()).getValues()[0];
  const idxApellidos = headersClientes.indexOf('Apellidos');
  if (idxApellidos !== -1) {
    hojaClientes.getRange(1, idxApellidos + 1).setValue('Referencia');
    resultado.clientesRenombrado = true;
  }

  const hojaInsc = getSheet_(SHEET_INSCRIPCIONES);
  const headersInscViejos = hojaInsc.getRange(1, 1, 1, hojaInsc.getLastColumn()).getValues()[0];
  if (headersInscViejos.indexOf('TarifaEspecial') === -1) {
    const filasInsc = sheetToObjects_(hojaInsc);
    hojaInsc.clear();
    hojaInsc.appendRow(['ID', 'ID_Cliente', 'Nombre', 'Centro', 'Dia', 'Hora', 'Estado', 'FechaAlta', 'FechaBaja', 'TarifaEspecial']);
    filasInsc.forEach(function (a) {
      hojaInsc.appendRow([a.ID, a.ID_Cliente, a.Nombre, a.Centro, a.Dia, a.Hora, a.Estado, a.FechaAlta, a.FechaBaja, false]);
    });
    resultado.inscripcionesActualizadas = true;
  }

  const hojaPagos = getSheet_(SHEET_PAGOS);
  const headersPagosViejos = hojaPagos.getRange(1, 1, 1, hojaPagos.getLastColumn()).getValues()[0];
  if (headersPagosViejos.indexOf('ID_Cliente') === -1) {
    const filasPagosViejas = sheetToObjects_(hojaPagos);
    const inscripcionesActuales = getInscripciones();
    const inscPorId = {};
    inscripcionesActuales.forEach(function (i) { inscPorId[i.ID] = i; });
    const clientes = getClientes();
    const clientePorId = {};
    clientes.forEach(function (c) { clientePorId[c.ID] = c; });

    const grupos = {}; // key = Mes|IDCliente|Centro
    filasPagosViejas.forEach(function (p) {
      const insc = inscPorId[p.ID_Alumno];
      const idCliente = insc ? insc.ID_Cliente : null;
      if (!idCliente) return; // fila huérfana (inscripción ya no existe), se descarta
      const key = p.Mes + '|' + idCliente + '|' + p.Centro;
      if (!grupos[key]) {
        grupos[key] = { mes: p.Mes, idCliente: idCliente, centro: p.Centro, clases: 0, pagado: false, fechaPago: '', notas: [] };
      }
      grupos[key].clases++;
      if (esVerdadero_(p.Pagado)) {
        grupos[key].pagado = true;
        if (p.FechaPago) grupos[key].fechaPago = p.FechaPago;
      }
      if (p.Notas) grupos[key].notas.push(p.Notas);
    });

    hojaPagos.clear();
    hojaPagos.appendRow(['ID', 'Mes', 'ID_Cliente', 'Nombre', 'Centro', 'ClasesSemana', 'Importe', 'Pagado', 'FechaPago', 'Notas']);
    Object.keys(grupos).forEach(function (key) {
      const g = grupos[key];
      const cliente = clientePorId[g.idCliente];
      const tarifaCentro = TARIFAS[g.centro] || {};
      const importe = tarifaCentro[g.clases] !== undefined ? tarifaCentro[g.clases] : '';
      hojaPagos.appendRow([
        Utilities.getUuid(), g.mes, g.idCliente, cliente ? cliente.Nombre : '', g.centro,
        g.clases, importe, g.pagado, g.fechaPago, g.notas.join(' / ')
      ]);
      resultado.pagosMigrados++;
    });

    // Fuerza formato numérico simple: la columna "ClasesSemana" ocupaba antes
    // la posición de "Hora" y puede arrastrar formato de hora/fecha, lo que
    // hace que un simple 1 o 2 se lea después como una fecha (1900-01-0X).
    const filas = hojaPagos.getLastRow() - 1;
    if (filas > 0) {
      hojaPagos.getRange(2, hojaPagos.getRange(1, 1, 1, hojaPagos.getLastColumn()).getValues()[0].indexOf('ClasesSemana') + 1, filas, 1).setNumberFormat('0');
    }
  }

  return resultado;
}

/**
 * Añade la columna "Estado" a Clientes (activo por defecto) si todavía no
 * existe. Necesaria para poder dar de baja a un cliente que no tiene ninguna
 * inscripción asociada (con inscripciones, la baja ya se gestiona por
 * clase con bajaInscripcion).
 */
function migrarEstadoClientes() {
  const sheet = getSheet_(SHEET_CLIENTES);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('Estado') !== -1) {
    return { migrado: false, motivo: 'Ya existe la columna "Estado"' };
  }
  const columna = headers.length + 1;
  sheet.getRange(1, columna).setValue('Estado');
  const filas = sheet.getLastRow() - 1;
  if (filas > 0) {
    const valores = [];
    for (let i = 0; i < filas; i++) valores.push(['activo']);
    sheet.getRange(2, columna, filas, 1).setValues(valores);
  }
  return { migrado: true, filas: filas };
}

// Reparación puntual de formato si "migrarASuscripciones" ya se ejecutó
// antes de este arreglo y dejó "ClasesSemana" con formato de fecha/hora.
function repararFormatoPagos() {
  const sheet = getSheet_(SHEET_PAGOS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idxClases = headers.indexOf('ClasesSemana');
  const filas = sheet.getLastRow() - 1;
  if (filas > 0 && idxClases !== -1) {
    sheet.getRange(2, idxClases + 1, filas, 1).setNumberFormat('0');
  }
  return { reparado: true, filas: filas };
}
