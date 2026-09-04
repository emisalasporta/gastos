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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'movimientos.json');
const PORT = process.env.PORT || 3000;
const PIN = process.env.PIN || '1234';
const READ_TOKEN = process.env.READ_TOKEN || 'cambiame';

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');

// --- Persistencia ------------------------------------------------------
// Escritura atomica: se escribe a un temporal y se renombra. Si se corta la luz
// en el medio, el archivo bueno queda intacto en vez de quedar a la mitad.
function leer() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
}
function guardar(movs) {
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

// --- App ---------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function pinOk(req) {
  const p = req.get('x-pin') || req.body?.pin || req.query?.pin;
  return typeof p === 'string' && p.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(p.padEnd(32).slice(0,32)), Buffer.from(PIN.padEnd(32).slice(0,32)));
}
function exigirPin(req, res, next) {
  if (!pinOk(req)) return res.status(401).json({ error: 'PIN incorrecto' });
  next();
}

app.get('/api/catalogos', (req, res) => res.json(CATALOGOS));

app.post('/api/login', (req, res) => {
  if (!pinOk(req)) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});

// Cargar un movimiento
// La categoria NO es obligatoria. Lo unico que se le exige a Emiliano es el monto.
// Si no sabe donde poner un gasto, lo describe y listo: despues Alex lo clasifica
// con PATCH /api/mov/:id (campo categoriaAlex). Obligarlo a elegir en el momento
// es exactamente la friccion que hizo que nunca usara el sistema anterior.
app.post('/api/mov', exigirPin, (req, res) => {
  const { tipo, monto, categoria, categoriaLibre, medio, detalle, fecha, obs } = req.body || {};
  const m = Number(monto);
  if (!['gasto', 'ingreso'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
  if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ error: 'monto inválido' });

  const movs = leer();
  const mov = {
    id: crypto.randomUUID(),
    tipo,
    monto: Math.round(m * 100) / 100,
    categoria: categoria || null,                                   // la que toco, si toco alguna
    categoriaLibre: (categoriaLibre || '').toString().slice(0, 60), // la que escribio a mano
    categoriaAlex: null,                                            // la que pone Alex al analizar
    medio: medio || null,
    detalle: (detalle || '').toString().slice(0, 200),
    obs: (obs || '').toString().slice(0, 500),
    // fecha del hecho (la que elige Emiliano) y sello de cuando se cargo
    fecha: fecha || new Date().toISOString().slice(0, 10),
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
  if (medio !== undefined) mov.medio = medio;
  mov.revisado = new Date().toISOString();
  guardar(movs);
  res.json({ ok: true, mov });
});

// Lo cargado hoy, para revisar y borrar si se metio la pata
app.get('/api/mov/hoy', exigirPin, (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  res.json(leer().filter(m => m.fecha === hoy).reverse());
});

app.get('/api/mov/ultimos', exigirPin, (req, res) => {
  res.json(leer().slice(-30).reverse());
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
  if (req.query.token !== READ_TOKEN) return res.status(401).json({ error: 'token inválido' });
  const movs = leer();
  const desde = req.query.desde, hasta = req.query.hasta;
  const filtrados = movs.filter(m =>
    (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta));
  const total = t => filtrados.filter(m => m.tipo === t)
    .reduce((a, m) => a + m.monto, 0);
  // "sinClasificar" es la bandeja de entrada de Alex: lo que Emiliano anoto
  // sin decidir categoria, o categorizo a mano con una etiqueta nueva.
  const sinClasificar = filtrados.filter(m =>
    !m.categoriaAlex && (!m.categoria || m.categoriaLibre));
  res.json({
    generado: new Date().toISOString(),
    cantidad: filtrados.length,
    totalGastos: Math.round(total('gasto') * 100) / 100,
    totalIngresos: Math.round(total('ingreso') * 100) / 100,
    sinClasificar: sinClasificar.length,
    movimientos: filtrados
  });
});

app.get('/api/salud', (req, res) => res.json({ ok: true, movimientos: leer().length }));

app.listen(PORT, () => console.log(`Gastos escuchando en :${PORT}`));
