FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

# Cache bust — increment this number to force full rebuild
ARG CACHEBUST=2
COPY . .

EXPOSE 7860

CMD ["node", "server.js"]