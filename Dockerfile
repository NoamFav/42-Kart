FROM node:26-slim AS base
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
EXPOSE 8080
CMD ["node", "server/index.ts"]
