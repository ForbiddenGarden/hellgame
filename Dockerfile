FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 STATE_FILE=/data/state.json
EXPOSE 8080
CMD ["node", "local-server.js"]
