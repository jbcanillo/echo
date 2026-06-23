# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# Add a simple nginx configuration to serve the PWA correctly
# We'll copy a custom nginx.conf if needed, but the default should work for SPA if we set the root to /usr/share/nginx/html and try_files
# However, for client-side routing, we need to redirect all routes to index.html
# We'll create a simple nginx.conf with API proxy
RUN echo 'server {\\n    listen 80;\\n    server_name localhost;\\n    root /usr/share/nginx/html;\\n    index index.html;\\n    location / {\\n        try_files $uri $uri/ /index.html;\\n    }\\n    location /api {\\n        proxy_pass http://backend:8000;\\n        proxy_set_header Host $host;\\n        proxy_set_header X-Real-IP $remote_addr;\\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\\n        proxy_set_header X-Forwarded-Proto $scheme;\\n    }\\n}' > /etc/nginx/conf.d/default.conf