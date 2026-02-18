FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx tsc

# MCP servers run via stdio, so we just need to start the node process
# Easypanel will handle the container lifecycle
CMD ["node", "dist/index.js"]
