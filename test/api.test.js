// Pruebas de punta a punta contra el servidor real, con un directorio de datos
// temporal. No tocan nunca los datos de verdad.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gastos-test-'));
process.env.DATA_DIR = DIR;
process.env.PIN = '2509';
process.env.READ_TOKEN = 'tok-de-prueba';

const { app, hoyLocal, fechaValida } = await import('../server.js');

let base, server;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

const conPin = (pin = '2509') => ({ 'content-type': 'application/json', 'x-pin': pin });
const post = (cuerpo, pin) => fetch(base + '/api/mov',
  { method: 'POST', headers: conPin(pin), body: JSON.stringify(cuerpo) });
const get = (ruta, pin) => fetch(base + ruta, { headers: conPin(pin) });

// ============ Zona horaria: el bug que dejaba la pestaña "Hoy" vacía ============

test('hoyLocal devuelve YYYY-MM-DD', () => {
  assert.match(hoyLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test('hoyLocal usa la hora de Argentina, no UTC', () => {
  // Cómo se veía el bug: el 04/09/2026 a las 22:49 hora argentina, en UTC ya
  // era el 05. El servidor buscaba los gastos del 05 y no encontraba nada.
  const enArgentina = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date('2026-09-05T01:49:26.654Z'));
  assert.equal(enArgentina, '2026-09-04');
  // Y hoyLocal tiene que coincidir con el día argentino, no con el UTC.
  const argHoy = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  assert.equal(hoyLocal(), argHoy);
});

test('un gasto cargado ahora aparece en /api/mov/hoy', async () => {
  const r = await post({ tipo: 'gasto', monto: 1234.56, detalle: 'prueba de hoy' });
  assert.equal(r.status, 200);
  const { mov } = await r.json();
  assert.equal(mov.fecha, hoyLocal());

  const hoy = await (await get('/api/mov/hoy')).json();
  assert.equal(hoy.fecha, hoyLocal());
  assert.ok(hoy.movimientos.some(m => m.id === mov.id), 'el gasto recién cargado tiene que estar en Hoy');
  assert.equal(hoy.totalGastos, 1234.56);
});

test('fechaValida rechaza fechas que no existen', () => {
  assert.ok(fechaValida('2026-09-04'));
  assert.ok(!fechaValida('2026-02-31'));
  assert.ok(!fechaValida('04/09/2026'));
  assert.ok(!fechaValida(''));
  assert.ok(!fechaValida(null));
});

// ============ Validación ============

test('sin PIN no se puede cargar nada', async () => {
  const r = await fetch(base + '/api/mov', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'gasto', monto: 100 })
  });
  assert.equal(r.status, 401);
});

test('rechaza monto y tipo inválidos', async () => {
  assert.equal((await post({ tipo: 'gasto', monto: 0 })).status, 400);
  assert.equal((await post({ tipo: 'gasto', monto: -5 })).status, 400);
  assert.equal((await post({ tipo: 'gasto', monto: 'diez' })).status, 400);
  assert.equal((await post({ tipo: 'regalo', monto: 100 })).status, 400);
});

test('rechaza una fecha inventada', async () => {
  assert.equal((await post({ tipo: 'gasto', monto: 100, fecha: '2026-02-31' })).status, 400);
  assert.equal((await post({ tipo: 'gasto', monto: 100, fecha: 'ayer' })).status, 400);
});

test('una categoría o un medio que no existen entran como vacíos', async () => {
  const { mov } = await (await post({
    tipo: 'gasto', monto: 500, categoria: '<script>', medio: 'banco-trucho'
  })).json();
  assert.equal(mov.categoria, null);
  assert.equal(mov.medio, null);
});

test('una categoría de ingreso no vale para un gasto', async () => {
  const { mov } = await (await post({ tipo: 'gasto', monto: 500, categoria: 'sueldo' })).json();
  assert.equal(mov.categoria, null);
});

// ============ Cola sin señal: no duplicar ============

test('el mismo clientId dos veces guarda un solo movimiento', async () => {
  const cuerpo = { tipo: 'gasto', monto: 999, detalle: 'reintento', clientId: 'abc-123' };
  const uno = await (await post(cuerpo)).json();
  const dos = await (await post(cuerpo)).json();
  assert.equal(dos.duplicado, true);
  assert.equal(uno.mov.id, dos.mov.id);

  const todos = await (await fetch(base + '/api/export?token=tok-de-prueba')).json();
  assert.equal(todos.movimientos.filter(m => m.clientId === 'abc-123').length, 1);
});

// ============ Historial ============

test('el historial agrupa por día, del más nuevo al más viejo', async () => {
  await post({ tipo: 'gasto',   monto: 100, fecha: '2026-08-01', detalle: 'viejo' });
  await post({ tipo: 'gasto',   monto: 200, fecha: '2026-08-03', detalle: 'medio' });
  await post({ tipo: 'ingreso', monto: 700, fecha: '2026-08-03', detalle: 'cobro' });

  const h = await (await get('/api/mov/historial')).json();
  const agosto = h.dias.filter(d => d.fecha.startsWith('2026-08'));
  assert.deepEqual(agosto.map(d => d.fecha), ['2026-08-03', '2026-08-01']);

  const tres = agosto[0];
  assert.equal(tres.totalGastos, 200);
  assert.equal(tres.totalIngresos, 700);
  assert.equal(tres.movimientos.length, 2);

  // Los días tienen que venir ordenados de más nuevo a más viejo.
  const fechas = h.dias.map(d => d.fecha);
  assert.deepEqual(fechas, [...fechas].sort().reverse());
  assert.equal(h.hoy, hoyLocal());
});

test('/api/mov/hoy no trae los días anteriores', async () => {
  const hoy = await (await get('/api/mov/hoy')).json();
  assert.ok(hoy.movimientos.every(m => m.fecha === hoyLocal()));
  assert.ok(!hoy.movimientos.some(m => m.detalle === 'viejo'));
});

test('el historial respeta el límite de días', async () => {
  const h = await (await get('/api/mov/historial?dias=1')).json();
  assert.equal(h.dias.length, 1);
  assert.equal(h.dias[0].fecha, hoyLocal());
});

// ============ Borrar y reclasificar ============

test('se puede borrar un movimiento', async () => {
  const { mov } = await (await post({ tipo: 'gasto', monto: 42, detalle: 'a borrar' })).json();
  const r = await fetch(base + '/api/mov/' + mov.id, { method: 'DELETE', headers: conPin() });
  assert.equal(r.status, 200);
  const hoy = await (await get('/api/mov/hoy')).json();
  assert.ok(!hoy.movimientos.some(m => m.id === mov.id));
  // borrar algo que ya no está avisa, no rompe
  assert.equal((await fetch(base + '/api/mov/' + mov.id, { method: 'DELETE', headers: conPin() })).status, 404);
});

test('Alex puede reclasificar con el token', async () => {
  const { mov } = await (await post({ tipo: 'gasto', monto: 77, detalle: 'sin clasificar' })).json();
  const r = await fetch(`${base}/api/mov/${mov.id}?token=tok-de-prueba`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ categoriaAlex: 'comida' })
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mov.categoriaAlex, 'comida');

  const malo = await fetch(`${base}/api/mov/${mov.id}?token=falso`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(malo.status, 401);
});

// ============ Export ============

test('el export trae todo y suma bien', async () => {
  const r = await fetch(base + '/api/export?token=tok-de-prueba');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.cantidad > 0);
  const sumaGastos = d.movimientos.filter(m => m.tipo === 'gasto')
    .reduce((a, m) => a + m.monto, 0);
  assert.equal(d.totalGastos, Math.round(sumaGastos * 100) / 100);
  assert.equal(d.hoy, hoyLocal());
});

test('el export filtra por rango de fechas', async () => {
  const d = await (await fetch(base + '/api/export?token=tok-de-prueba&desde=2026-08-01&hasta=2026-08-03')).json();
  assert.ok(d.movimientos.length >= 3);
  assert.ok(d.movimientos.every(m => m.fecha >= '2026-08-01' && m.fecha <= '2026-08-03'));
});

test('el export sin token no devuelve nada', async () => {
  assert.equal((await fetch(base + '/api/export')).status, 401);
});

// ============ Respaldo y salud ============

test('se guarda una copia de seguridad del día', () => {
  const copias = fs.readdirSync(path.join(DIR, 'backups'));
  assert.ok(copias.some(n => n === `movimientos-${hoyLocal()}.json`),
    'tiene que existir el respaldo del día: ' + copias.join(', '));
});

test('/api/salud responde con la cuenta y la zona', async () => {
  const d = await (await fetch(base + '/api/salud')).json();
  assert.equal(d.ok, true);
  assert.ok(d.movimientos > 0);
  assert.equal(d.zona, 'America/Argentina/Buenos_Aires');
});

test('el HTML y el service worker no se cachean', async () => {
  const html = await fetch(base + '/index.html');
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('cache-control'), 'no-cache');
  const sw = await fetch(base + '/sw.js');
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
});

test('el login devuelve la fecha de hoy en Argentina', async () => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: conPin(), body: '{}' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).hoy, hoyLocal());
});

// ============ Freno de fuerza bruta (va último: bloquea la IP 15 minutos) ============

test('cinco PIN equivocados bloquean la IP', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: conPin('0000'), body: '{}' });
    assert.equal(r.status, 401);
  }
  const bloqueado = await fetch(base + '/api/login', { method: 'POST', headers: conPin('0000'), body: '{}' });
  assert.equal(bloqueado.status, 429);
  // Y con el PIN bueno también, mientras dure el bloqueo.
  const conBueno = await fetch(base + '/api/login', { method: 'POST', headers: conPin(), body: '{}' });
  assert.equal(conBueno.status, 429);
});
