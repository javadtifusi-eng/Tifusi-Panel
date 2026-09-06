FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-ssl.conf /etc/nginx/nginx-ssl.conf.available
COPY docker-entrypoint-tls.sh /docker-entrypoint.d/40-tifusi-tls.sh
RUN chmod +x /docker-entrypoint.d/40-tifusi-tls.sh
EXPOSE 80 443
