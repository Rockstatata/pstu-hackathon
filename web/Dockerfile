# Development image. The compose `web` profile mounts ./web over /app, so this
# only needs the toolchain and a warm node_modules layer.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
