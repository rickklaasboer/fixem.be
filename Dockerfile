FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# tsconfig.json carries the `@/*` -> `./src/*` path mapping that Bun resolves at
# RUNTIME; without it in the image, `bun src/index.ts` can't resolve `@/…` imports.
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
EXPOSE 3000
USER bun
CMD ["bun", "src/index.ts"]
