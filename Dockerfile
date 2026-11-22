# --- build the frontend ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build && npm prune --omit=dev

# --- runtime image (the same image runs on every server) ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/server.ts ./
COPY --from=build /app/server ./server
COPY --from=build /app/src/types ./src/types
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/ready || exit 1
CMD ["node_modules/.bin/tsx", "server.ts"]
