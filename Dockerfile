# -------------------------
# Backend
# -------------------------

FROM node:22-alpine AS backend

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY src ./src

EXPOSE 4000

CMD ["npm", "run", "api"]


# -------------------------
# Frontend build
# -------------------------

FROM node:22-alpine AS frontend-build

WORKDIR /app

COPY client/package*.json ./

RUN npm ci

COPY client/ .

RUN npm run build


# -------------------------
# NGINX
# -------------------------

FROM nginx:alpine AS frontend

COPY --from=frontend-build /app/dist /usr/share/nginx/html

COPY nginx/nginx.conf /etc/nginx/nginx.conf
