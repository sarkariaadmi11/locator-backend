# --- deps: install once, reused by build and runtime layers ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: compile TypeScript + generate the Prisma client ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# --- runtime: production-only dependencies + compiled output ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

# Non-root user (node:22-alpine already ships a `node` user/group)
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Migrations are deliberately NOT run from this image's CMD — `prisma migrate deploy` should run
# once per release (a CI/CD release step, `npm run prisma:migrate`), not once per container
# start, so scaling to multiple replicas never races two containers migrating simultaneously.
CMD ["node", "dist/server.js"]
