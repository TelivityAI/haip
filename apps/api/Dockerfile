FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/booking/package.json ./apps/booking/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json* ./packages/shared/

RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/dashboard/ ./apps/dashboard/
COPY apps/booking/ ./apps/booking/

# Build workspace packages
RUN pnpm --filter @telivityhaip/shared run build
RUN pnpm --filter @telivityhaip/database run build

# Build dashboard (Vite static output)
RUN pnpm --filter dashboard run build

# Build booking engine SPA
RUN pnpm --filter @telivityhaip/booking run build

# Build API (NestJS)
RUN pnpm --filter @telivityhaip/api run build

# Production stage
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/apps/api/package.json ./apps/api/
COPY --from=base /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=base /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=base /app/apps/booking/dist ./apps/booking/dist
COPY --from=base /app/packages/database/dist ./packages/database/dist
COPY --from=base /app/packages/database/package.json ./packages/database/
# database's own node_modules (postgres, drizzle-orm) — needed so the
# init container can run the compiled migrate/seed scripts standalone.
COPY --from=base /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
