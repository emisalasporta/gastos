// ============================================================
//  Anotador de gastos e ingresos de Emiliano.
//  Guarda todo en un archivo JSON. Sin base de datos, sin build.
//  Por que JSON y no SQLite: son unos pocos miles de registros por anio.
//  Un JSON se lee, se respalda y se arregla a mano si hace falta.
// ============================================================
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'movimientos.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PORT = process.env.PORT || 3000;
const PIN = process.env.PIN || '1234';
const READ_TOKEN = process.env.READ_TOKEN || 'cambiame';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');

// --- Zona horaria ------------------------------------------------------
// El contenedor corre en UTC; Emiliano vive en Argentina (UTC-3). Si el "hoy"
// del servidor se calcula en UTC, todo lo que se carga despues de las 21:00
// hora argentina cae en el dia siguiente y la pestaña "Hoy" aparece vacia.
// Paso de verdad: los gastos del 04/09/2026 cargados 22:49 y 22:50 no se veian.
const ZONA = process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires';
// Se arma la fecha pieza por pieza en vez de pedir un formato con nombre. Asi el
// resultado es siempre YYYY-MM-DD, no importa que idiomas traiga el contenedor.
const FMT_FECHA = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
});
function hoyLocal() {
  const p = {};
  for (const parte of FMT_FECHA.formatToParts(new Date())) p[parte.type] = parte.value;
  return `${p.year}-${p.month}-${p.day}`;
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Una fecha valida es la que el calendario reconoce: descarta 2026-02-31.
function fechaValida(f) {
  if (typeof f !== 'string' || !ES_FECHA.test(f)) return false;
  const d = new Date(f + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// --- Persistencia ------------------------------------------------------
// Escritura atomica: se escribe a un temporal y se renombra. Si se corta la luz
// en el medio, el archivo bueno queda intacto en vez de quedar a la mitad.
function leer() {
  try {
    const datos = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Array.isArray(datos) ? datos : [];
  } catch { return []; }
}

// Copia de seguridad: una por dia, antes de la primera escritura del dia.
// Si algun dia el archivo se rompe o se borra algo por error, el dia anterior
// entero sigue estando. Se guardan 30 dias y se tiran las mas viejas.
const RETENER_BACKUPS = 30;
function respaldarUnaVezPorDia() {
  try {
    const destino = path.join(BACKUP_DIR, `movimientos-${hoyLocal()}.json`);
    if (fs.existsSync(destino)) return;
    if (!fs.existsSync(DB_FILE)) return;
    fs.copyFileSync(DB_FILE, destino);
    const viejos = fs.readdirSync(BACKUP_DIR)
      .filter(n => n.startsWith('movimientos-') && n.endsWith('.json'))
      .sort();
    for (const n of viejos.slice(0, Math.max(0, viejos.length - RETENER_BACKUPS))) {
      fs.unlinkSync(path.join(BACKUP_DIR, n));
    }
  } catch (e) {
    // Un backup que falla no puede impedir que Emiliano cargue un gasto.
    console.error('No se pudo respaldar:', e.message);
  }
}

function guardar(movs) {
  respaldarUnaVezPorDia();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(movs, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

// --- Catalogos ---------------------------------------------------------
// Estas son SUGERENCIAS, no una lista cerrada. Emiliano puede guardar sin elegir
// ninguna, o escribir la suya. La clasificacion final la hace Alex al analizar.
const CATALOGOS = {
  categoriasGasto: [
    { id: 'comida',     nombre: 'Comida',      emoji: '🍽️' },
    { id: 'super',      nombre: 'Súper',       emoji: '🛒' },
    { id: 'nafta',      nombre: 'Nafta',       emoji: '⛽' },
    { id: 'auto',       nombre: 'Auto',        emoji: '🚗' },
    { id: 'hijo',       nombre: 'Hijo',        emoji: '🎒' },
    { id: 'casa',       nombre: 'Casa/Serv.',  emoji: '🏠' },
    { id: 'salud',      nombre: 'Salud',       emoji: '💊' },
    { id: 'apps',       nombre: 'Apps/Susc.',  emoji: '📱' },
    { id: 'salidas',    nombre: 'Salidas',     emoji: '🍺' },
    { id: 'deporte',    nombre: 'Deporte',     emoji: '👟' },
    { id: 'deuda',      nombre: 'Pago deuda',  emoji: '🏦' },
    { id: 'otros',      nombre: 'Otros',       emoji: '📦' }
  ],
  categoriasIngreso: [
    { id: 'sueldo',       nombre: 'Sueldo',       emoji: '💼' },
    { id: 'entrenamiento',nombre: 'Entrenam.',   emoji: '🏃' },
    { id: 'consultoria',  nombre: 'Consultoría',  emoji: '📊' },
    { id: 'venta',        nombre: 'Venta',        emoji: '🏷️' },
    { id: 'otros',        nombre: 'Otros',        emoji: '📦' }
  ],
  medios: [
    { id: 'efectivo',   nombre: 'Efectivo',   tipo: 'billetera' },
    { id: 'bna',        nombre: 'BNA',        tipo: 'billetera' },
    { id: 'naranjax',   nombre: 'Naranja X',  tipo: 'billetera' },
    { id: 'mercadopago',nombre: 'Mercado Pago', tipo: 'billetera' },
    { id: 'dolares',    nombre: 'Dólares',    tipo: 'billetera' },
    { id: 'visa',       nombre: 'Visa Nativa',tipo: 'tarjeta' },
    { id: 'master',     nombre: 'Master Nativa', tipo: 'tarjeta' },
    { id: 'centrocard', nombre: 'Centro Card',tipo: 'tarjeta' },
    { id: 'tnaranja',   nombre: 'T. Naranja X', tipo: 'tarjeta' },
    { id: 'otro',       nombre: 'Otro',       tipo: 'billetera' }
  ]
};

// Solo se aceptan ids que existan en el catalogo. Lo que no esta, entra como
// null: es preferible un gasto sin categoria a uno con una etiqueta inventada.
const IDS_GASTO   = new Set(CATALOGOS.categoriasGasto.map(c => c.id));
const IDS_INGRESO = new Set(CATALOGOS.categoriasIngreso.map(c => c.id));
const IDS_MEDIO   = new Set(CATALOGOS.medios.map(m => m.id));

// --- App ---------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // corre detras de Traefik
app.use(express.json({ limit: '256kb' }));

// El HTML y el service worker NO se cachean: si se cachean, despues de una
// actualizacion el celular sigue abriendo la version vieja durante una hora.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, ruta) {
    const nombre = path.basename(ruta);
    if (nombre === 'index.html' || nombre === 'sw.js' || nombre === 'manifest.json') {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// --- Freno de fuerza bruta ---------------------------------------------
// Un PIN de 4 digitos son 10.000 combinaciones: sin freno, un script las
// prueba todas en minutos. Cinco intentos fallidos y esa IP queda afuera
// 15 minutos. Un acierto limpia el contador.
const intentos = new Map();
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

function ipDe(req) {
  return (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip || 'desconocida';
}
function bloqueado(ip) {
  const r = intentos.get(ip);
  if (!r) return false;
  if (Date.now() - r.desde > BLOQUEO_MS) { intentos.delete(ip); return false; }
  return r.fallos >= MAX_INTENTOS;
}
function anotarFallo(ip) {
  const r = intentos.get(ip);
  if (!r || Date.now() - r.desde > BLOQUEO_MS) intentos.set(ip, { fallos: 1, desde: Date.now() });
  else r.fallos++;
}

function pinOk(req) {
  const p = req.get('x-pin') || req.body?.pin || req.query?.pin;
  return typeof p === 'string' && p.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(p.padEnd(32).slice(0,32)), Buffer.from(PIN.padEnd(32).slice(0,32)));
}
function exigirPin(req, res, next) {
  const ip = ipDe(req);
  if (bloqueado(ip)) return res.status(429).json({ error: 'Demasiados intentos. Probá en 15 minutos.' });
  if (!pinOk(req)) { anotarFallo(ip); return res.status(401).json({ error: 'PIN incorrecto' }); }
  intentos.delete(ip);
  next();
}

app.get('/api/catalogos', (req, res) => res.json(CATALOGOS));

app.post('/api/login', (req, res) => {
  const ip = ipDe(req);
  if (bloqueado(ip)) return res.status(429).json({ ok: false, error: 'Demasiados intentos. Probá en 15 minutos.' });
  if (!pinOk(req)) { anotarFallo(ip); return res.status(401).json({ ok: false, error: 'PIN incorrecto' }); }
  intentos.delete(ip);
  res.json({ ok: true, hoy: hoyLocal() });
});

// Cargar un movimiento
// La categoria NO es obligatoria. Lo unico que se le exige a Emiliano es el monto.
// Si no sabe donde poner un gasto, lo describe y listo: despues Alex lo clasifica
// con PATCH /api/mov/:id (campo categoriaAlex). Obligarlo a elegir en el momento
// es exactamente la friccion que hizo que nunca usara el sistema anterior.
app.post('/api/mov', exigirPin, (req, res) => {
  const { tipo, monto, categoria, categoriaLibre, medio, detalle, fecha, obs, clientId } = req.body || {};
  const m = Number(monto);
  if (!['gasto', 'ingreso'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
  if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ error: 'monto inválido' });
  if (fecha !== undefined && fecha !== null && fecha !== '' && !fechaValida(fecha)) {
    return res.status(400).json({ error: 'fecha inválida' });
  }

  const movs = leer();

  // Sin señal el celular guarda el gasto y lo reintenta despues. Si el primer
  // envio si llego pero la respuesta se perdio, el reintento traeria el mismo
  // clientId: se devuelve el que ya existe en vez de duplicar el gasto.
  const idCliente = typeof clientId === 'string' ? clientId.slice(0, 64) : '';
  if (idCliente) {
    const yaEsta = movs.find(x => x.clientId === idCliente);
    if (yaEsta) return res.json({ ok: true, mov: yaEsta, duplicado: true });
  }

  const idsValidos = tipo === 'gasto' ? IDS_GASTO : IDS_INGRESO;
  const mov = {
    id: crypto.randomUUID(),
    clientId: idCliente || null,
    tipo,
    monto: Math.round(m * 100) / 100,
    categoria: idsValidos.has(categoria) ? categoria : null,        // la que toco, si toco alguna
    categoriaLibre: (categoriaLibre || '').toString().trim().slice(0, 60), // la que escribio a mano
    categoriaAlex: null,                                            // la que pone Alex al analizar
    medio: IDS_MEDIO.has(medio) ? medio : null,
    detalle: (detalle || '').toString().trim().slice(0, 200),
    obs: (obs || '').toString().trim().slice(0, 500),
    // fecha del hecho (la que elige Emiliano) y sello de cuando se cargo
    fecha: fecha || hoyLocal(),
    creado: new Date().toISOString()
  };
  movs.push(mov);
  guardar(movs);
  res.json({ ok: true, mov });
});

// Reclasificar. Lo usa Alex desde la conversacion, con el token de lectura.
// Nunca toca el monto ni la fecha: solo pone etiquetas.
app.patch('/api/mov/:id', (req, res) => {
  if (req.query.token !== READ_TOKEN) return res.status(401).json({ error: 'token inválido' });
  const movs = leer();
  const mov = movs.find(m => m.id === req.params.id);
  if (!mov) return res.status(404).json({ error: 'no existe' });
  const { categoriaAlex, obs, medio } = req.body || {};
  if (categoriaAlex !== undefined) mov.categoriaAlex = categoriaAlex;
  if (obs !== undefined) mov.obs = String(obs).slice(0, 500);
  if (medio !== undefined) mov.medio = IDS_MEDIO.has(medio) ? medio : null;
  mov.revisado = new Date().toISOString();
  guardar(movs);
  res.json({ ok: true, mov });
});

// Ordena del mas reciente al mas viejo: primero por fecha del hecho, y dentro
// del mismo dia por el momento en que se cargo.
function masRecientePrimero(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
  return (a.creado || '') < (b.creado || '') ? 1 : -1;
}
const sumar = (movs, t) =>
  Math.round(movs.filter(m => m.tipo === t).reduce((a, m) => a + m.monto, 0) * 100) / 100;

// Lo cargado hoy, para revisar y borrar si se metio la pata.
// "Hoy" es hoy en Argentina, no en UTC.
app.get('/api/mov/hoy', exigirPin, (req, res) => {
  const hoy = hoyLocal();
  const movs = leer().filter(m => m.fecha === hoy).sort(masRecientePrimero);
  res.json({ fecha: hoy, movimientos: movs, totalGastos: sumar(movs, 'gasto'), totalIngresos: sumar(movs, 'ingreso') });
});

// Historial completo, agrupado por dia, del mas reciente al mas viejo.
// Se agrupa aca y no en el celular: menos trabajo para el telefono.
app.get('/api/mov/historial', exigirPin, (req, res) => {
  const limiteDias = Math.min(Math.max(parseInt(req.query.dias, 10) || 90, 1), 3650);
  const todos = leer().sort(masRecientePrimero);
  const porDia = new Map();
  for (const m of todos) {
    if (!porDia.has(m.fecha)) porDia.set(m.fecha, []);
    porDia.get(m.fecha).push(m);
  }
  const dias = [...porDia.entries()].slice(0, limiteDias).map(([fecha, movimientos]) => ({
    fecha,
    movimientos,
    totalGastos: sumar(movimientos, 'gasto'),
    totalIngresos: sumar(movimientos, 'ingreso')
  }));
  res.json({
    hoy: hoyLocal(),
    cantidad: todos.length,
    diasMostrados: dias.length,
    totalGastos: sumar(todos, 'gasto'),
    totalIngresos: sumar(todos, 'ingreso'),
    dias
  });
});

app.delete('/api/mov/:id', exigirPin, (req, res) => {
  const movs = leer();
  const i = movs.findIndex(m => m.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'no existe' });
  movs.splice(i, 1);
  guardar(movs);
  res.json({ ok: true });
});

// Export para Alex: todo el historial en JSON, con token.
// Se usa desde la conversacion, sin que Emiliano tenga que copiar nada.
app.get('/api/export', (req, res) => {
  const ip = ipDe(req);
  if (bloqueado(ip)) return res.status(429).json({ error: 'Demasiados intentos.' });
  if (req.query.token !== READ_TOKEN) { anotarFallo(ip); return res.status(401).json({ error: 'token inválido' }); }
  intentos.delete(ip);
  const movs = leer();
  const desde = req.query.desde, hasta = req.query.hasta;
  const filtrados = movs.filter(m =>
    (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta)).sort(masRecientePrimero);
  // "sinClasificar" es la bandeja de entrada de Alex: lo que Emiliano anoto
  // sin decidir categoria, o categorizo a mano con una etiqueta nueva.
  const sinClasificar = filtrados.filter(m =>
    !m.categoriaAlex && (!m.categoria || m.categoriaLibre));
  res.json({
    generado: new Date().toISOString(),
    hoy: hoyLocal(),
    cantidad: filtrados.length,
    totalGastos: sumar(filtrados, 'gasto'),
    totalIngresos: sumar(filtrados, 'ingreso'),
    sinClasificar: sinClasificar.length,
    movimientos: filtrados
  });
});

app.get('/api/salud', (req, res) =>
  res.json({ ok: true, movimientos: leer().length, hoy: hoyLocal(), zona: ZONA }));

// Solo se levanta el servidor si este archivo se ejecuta directo. Asi los tests
// pueden importar la app y probarla sin ocupar el puerto.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  app.listen(PORT, () => console.log(`Gastos escuchando en :${PORT} · zona ${ZONA}`));
}

export { app, hoyLocal, fechaValida, CATALOGOS, DB_FILE };
