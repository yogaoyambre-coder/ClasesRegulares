/**
 * API de la app de Cobros — Google Apps Script
 *
 * Antes de desplegar:
 * 1. Sustituye SS_ID por el ID de tu Google Sheet (está en la URL de la hoja).
 * 2. La hoja debe tener dos pestañas con estas cabeceras exactas en la fila 1:
 *
 *    "Alumnos": ID | Nombre | Centro | Dia | Hora | PrecioDefecto | Estado | FechaAlta | FechaBaja
 *    "Pagos":   Mes | ID_Alumno | Nombre | Centro | Dia | Hora | Importe | Pagado | FechaPago | Notas
 *
 * 3. Implementar > Nueva implementación > Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier usuario
 */

const SS_ID = 'PON_AQUI_EL_ID_DE_TU_GOOGLE_SHEET';
const SHEET_ALUMNOS = 'Alumnos';
const SHEET_PAGOS = 'Pagos';

function getSS_() {
  return SpreadsheetApp.openById(SS_ID);
}

function getSheet_(name) {
  const sheet = getSS_().getSheetByName(name);
  if (!sheet) throw new Error('No existe la hoja "' + name + '"');
  return sheet;
}

function sheetToObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
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
      case 'getAlumnos':
        result = getAlumnos();
        break;
      case 'getPagosMes':
        result = getPagosMes(e.parameter.mes);
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
      case 'addAlumno':
        result = addAlumno(body);
        break;
      case 'bajaAlumno':
        result = bajaAlumno(body.id, body.fechaBaja);
        break;
      case 'setPago':
        result = setPago(body);
        break;
      default:
        throw new Error('Acción POST no reconocida: ' + body.action);
    }
    return jsonResponse_({ ok: true, data: result });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function getAlumnos() {
  return sheetToObjects_(getSheet_(SHEET_ALUMNOS));
}

/**
 * Devuelve los pagos de un mes (YYYY-MM). Si un alumno activo en ese mes
 * todavía no tiene fila de pago, la crea automáticamente con su precio
 * por defecto y Pagado=false.
 */
function getPagosMes(mes) {
  const sheetPagos = getSheet_(SHEET_PAGOS);
  const pagos = sheetToObjects_(sheetPagos).filter(function (p) { return p.Mes === mes; });

  const alumnos = getAlumnos();
  const partes = mes.split('-').map(Number);
  const primerDiaMes = new Date(partes[0], partes[1] - 1, 1);
  const ultimoDiaMes = new Date(partes[0], partes[1], 0);

  const activosEnMes = alumnos.filter(function (a) {
    const alta = a.FechaAlta ? new Date(a.FechaAlta) : null;
    const baja = a.FechaBaja ? new Date(a.FechaBaja) : null;
    if (alta && alta > ultimoDiaMes) return false;
    if (baja && baja < primerDiaMes) return false;
    return true;
  });

  const idsConPago = {};
  pagos.forEach(function (p) { idsConPago[p.ID_Alumno] = true; });

  const nuevos = activosEnMes.filter(function (a) { return !idsConPago[a.ID]; });
  nuevos.forEach(function (a) {
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
    if (data[i][idxMes] === body.mes && data[i][idxId] === body.idAlumno) {
      sheet.getRange(i + 1, idxImporte + 1).setValue(body.importe);
      sheet.getRange(i + 1, idxPagado + 1).setValue(body.pagado);
      sheet.getRange(i + 1, idxFecha + 1).setValue(body.fechaPago || '');
      sheet.getRange(i + 1, idxNotas + 1).setValue(body.notas || '');
      return { updated: true };
    }
  }
  throw new Error('No se encontró el pago de ese alumno para ese mes');
}

function addAlumno(body) {
  const sheet = getSheet_(SHEET_ALUMNOS);
  const nuevo = {
    ID: Utilities.getUuid(),
    Nombre: body.nombre,
    Centro: body.centro,
    Dia: body.dia,
    Hora: body.hora,
    PrecioDefecto: body.precioDefecto,
    Estado: 'activo',
    FechaAlta: body.fechaAlta || new Date(),
    FechaBaja: ''
  };
  appendRow_(sheet, nuevo);
  return nuevo;
}

function bajaAlumno(id, fechaBaja) {
  const sheet = getSheet_(SHEET_ALUMNOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxId = headers.indexOf('ID');
  const idxEstado = headers.indexOf('Estado');
  const idxBaja = headers.indexOf('FechaBaja');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idxId] === id) {
      sheet.getRange(i + 1, idxEstado + 1).setValue('baja');
      sheet.getRange(i + 1, idxBaja + 1).setValue(fechaBaja || new Date());
      return { updated: true };
    }
  }
  throw new Error('Alumno no encontrado');
}
