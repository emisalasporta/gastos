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
| GET | `/api/mov/hoy` | PIN | Lo cargado hoy |
| GET | `/api/mov/ultimos` | PIN | Últimos 30 |
| DELETE | `/api/mov/:id` | PIN | Borra uno |
| GET | `/api/export?token=…` | token | **Todo el historial en JSON — esto lee Alex** |
| GET | `/api/salud` | — | Chequeo |

El PIN va en el header `x-pin`. `/api/export` acepta `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`.

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
