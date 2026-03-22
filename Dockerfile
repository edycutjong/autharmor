FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY tsconfig.json ./
COPY src/ ./src/
COPY data/ ./data/
EXPOSE 5000
CMD ["npx", "tsx", "src/index.ts"]
