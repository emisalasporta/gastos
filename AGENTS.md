# Gastos — anotador de Emiliano

App mínima para que Emiliano cargue gastos e ingresos desde el celular en tres toques.
Los datos los lee Alex desde la conversación, sin que Emiliano tenga que copiar nada.

> Nota: `CLAUDE.md` es un symlink a este archivo. Editá `AGENTS.md`.

## Para qué existe

Emiliano ya tuvo un sistema de finanzas completo (`D:\personal\finanzas\finanzas.html`, 136
autotests, 11 secciones) y **nunca lo usó**. No falló el código: fallaba que lo convertía en el
operador de su propio sistema contable. Esta app hace **una sola cosa**: anotar.

**REGLA QUE NO SE NEGOCIA: acá no se agregan features.** Ni dashboards, ni gráficos, ni
presupuestos, ni proyecciones, ni categorías automáticas. Todo el análisis lo hace Alex desde la
conversación leyendo `/api/export`. Cada cosa que se sume acá es una razón más para no abrirla.

La app tiene tres pantallas y no debería tener una cuarta: **Cargar** (anotar), **Hoy** (revisar y
corregir lo del día) e **Historial** (ver lo anotado antes, agrupado por día). Historial no es
análisis: es poder confiar en que lo que anotaste está. Sin eso Emiliano no sabía si la app
guardaba, que es peor que no tenerla.

## Stack

- **Node 22 + Express**, sin build, sin framework de frontend.
- **Los datos son un JSON** en `DATA_DIR/movimientos.json`, con escritura atómica (temporal +
  rename). No hay base de datos: son unos pocos miles de registros por año, y un JSON se lee, se
  respalda y se arregla a mano.
- Frontend: un `public/index.html` con todo adentro. PWA instalable.
- Estética heredada de la web personal: fondo `#0a0b10`, acento neón `#2fb8ff`, gasto en magenta
  `#ff2e9a`, ingreso en verde `#28d17c`. Fuentes del sistema (nada se pide por red).

## Variables de entorno

| Variable | Para qué | Default |
|---|---|---|
| `PIN` | Los 4 dígitos para entrar | `1234` — **cambiar sí o sí** |
| `READ_TOKEN` | Token de `/api/export`, el que usa Alex | `cambiame` — **cambiar sí o sí** |
| `DATA_DIR` | Dónde vive el JSON | `./data` (en Docker: `/app/data`) |
| `PORT` | Puerto | `3000` |

## Deploy en Dokploy

1. Repo nuevo en GitHub (`emisalasporta/gastos`).
2. En Dokploy: nueva Application → ese repo → build por **Dockerfile**.
3. Dominio: `gastos.emilianosalasporta.cloud`, puerto **3000**, HTTPS con Let's Encrypt.
4. **Volumen obligatorio:** montar uno en `/app/data`. Sin eso, cada deploy borra los datos.
5. Environment: `PIN` y `READ_TOKEN`.
6. Autodeploy desde `main`, igual que la web.

## API

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| GET | `/api/catalogos` | — | Categorías y medios de pago |
| POST | `/api/login` | PIN | Valida el PIN |
| POST | `/api/mov` | PIN | Carga un movimiento |
| GET | `/api/mov/hoy` | PIN | Lo cargado hoy, con totales |
| GET | `/api/mov/historial?dias=90` | PIN | Todo, agrupado por día, del más nuevo al más viejo |
| PATCH | `/api/mov/:id?token=…` | token | Reclasificar (`categoriaAlex`). Lo usa Alex |
| DELETE | `/api/mov/:id` | PIN | Borra uno |
| GET | `/api/export?token=…` | token | **Todo el historial en JSON — esto lee Alex** |
| GET | `/api/salud` | — | Chequeo |

El PIN va en el header `x-pin`. `/api/export` acepta `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`.

## Tres cosas que no se pueden romper

**1. La fecha es la de Argentina, nunca la de UTC.** El contenedor corre en UTC.
`new Date().toISOString()` después de las 21:00 hora argentina ya devuelve el día siguiente:
con eso, todo lo cargado de noche quedaba fuera de la pestaña "Hoy". El servidor usa `hoyLocal()`
(zona `America/Argentina/Buenos_Aires`, configurable con `ZONA_HORARIA`) y el frontend arma la
fecha con `getFullYear/getMonth/getDate`. **Nunca usar `toISOString()` para una fecha.**

**2. Sin señal no se pierde nada.** El celular escribe el movimiento en una cola de
`localStorage` *antes* de intentar mandarlo, y lo reintenta al volver la conexión, al abrir la app
y a mano. Cada movimiento lleva un `clientId`: si el envío llegó pero la respuesta se perdió, el
servidor devuelve el que ya tiene en vez de duplicarlo. El service worker (`public/sw.js`) existe
para que la app abra sin conexión; sin él, la cola no serviría de nada.

**3. El monto se teclea en pesos enteros.** Para $16.000 se teclea `16000`. Antes los dos últimos
dígitos eran centavos y había que poner dos ceros de más en cada gasto: eso es fricción pura.

## Datos

`DATA_DIR/movimientos.json`, escritura atómica. Antes de la primera escritura de cada día se copia
el archivo a `DATA_DIR/backups/movimientos-YYYY-MM-DD.json` y se guardan los últimos 30 días.

## Tests

```
npm test
```

23 pruebas de punta a punta contra el servidor real, con un directorio de datos temporal
(`test/api.test.js`). No tocan nunca los datos de verdad. **Corrimos esto antes de cada deploy.**

## Catálogos

Están en `server.js`, en la constante `CATALOGOS`. Para agregar una categoría se toca solo ahí:
el frontend las dibuja solo. Los medios tienen `tipo: billetera | tarjeta` — **esa distinción
importa**: un gasto con tarjeta genera deuda, uno con billetera descuenta saldo.

## Probar local

```
npm install
PIN=1234 READ_TOKEN=tok DATA_DIR=./data node server.js
# http://localhost:3000
```

## Datos verificados al 04/09/2026 (contexto, no tocar desde acá)

Los medios de pago son los reales de Emiliano: caja de ahorro BNA, Naranja X (billetera),
Mercado Pago, efectivo, dólares, y sus cuatro tarjetas (Visa Nativa, Master Nativa, Centro Card,
Naranja X). El detalle de su situación vive en `D:\personal\finanzas\datos\`.
