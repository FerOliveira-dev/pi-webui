# ── Build stage ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN npm run build

# ── Production stage ────────────────────────────────────────
FROM node:20-alpine AS production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

RUN apk add --no-cache wget git openssh-client

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY public/ ./public/

RUN npm ci --omit=dev

# Install pi.dev CLI (needed for pi install commands)
RUN npm install -g @earendil-works/pi-coding-agent

# Install Pi packages (included in image)
RUN npm install -g pi-web-access
RUN npm install -g pi-llama-cpp

EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4096/ > /dev/null 2>&1 || exit 1

ENTRYPOINT ["node", "dist/server/index.js"]
CMD ["--listen", "0.0.0.0:4096"]