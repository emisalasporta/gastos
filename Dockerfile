# ============================================================
#  Anotador de gastos. Dokploy lee este archivo y lo publica.
#  Sin build: es Node sirviendo una pantalla y guardando un JSON.
# ============================================================
FROM node:22-bookworm-slim

WORKDIR /app

# Primero los manifiestos: si no cambian, Docker reusa la capa de dependencias
# y el deploy tarda segundos en vez de minutos.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Los datos viven acá. En Dokploy hay que montar un volumen en /app/data,
# si no se pierden en cada deploy.
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
