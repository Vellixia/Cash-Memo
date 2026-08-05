FROM node:24.14.0-alpine AS builder
ARG CASHMEMO_API_ORIGIN=http://backend:3001
ENV CASHMEMO_API_ORIGIN=${CASHMEMO_API_ORIGIN}
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts
COPY apps/web apps/web
RUN npm run build --workspace @cashmemo/web

FROM node:24.14.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /src/apps/web/.next/standalone ./
COPY --from=builder /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /src/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
