# Za postavljanje na server:  docker build -t zlatna-kuna .
# docker run -d -p 3000:3000 -v zk-data:/app/data --env-file .env -e HOST=0.0.0.0 zlatna-kuna
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_FILE=/app/data/zlatna-kuna.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.js ./
COPY src ./src
COPY public ./public
VOLUME /app/data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
