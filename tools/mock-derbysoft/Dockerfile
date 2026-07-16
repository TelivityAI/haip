FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production || true
COPY server.mjs ./
EXPOSE 4002
CMD ["node", "server.mjs"]
