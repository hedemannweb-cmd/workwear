# syntax=docker/dockerfile:1
# Mehrstufiges Image: Abhängigkeiten → Build → schlanke Laufzeit (Next.js standalone, ohne Root).

FROM node:24-alpine AS deps
WORKDIR /app
# Prisma-Config liest DATABASE_URL; für Build-Schritte genügt ein Platzhalter (keine Verbindung).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build
# Dieses Stage dient zugleich als Image für Migrationen/Seed (enthält Prisma CLI und tsx).

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
