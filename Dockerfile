FROM node:16.11.1-buster-slim

# labels
LABEL org.opencontainers.image.created=$CREATED_DATE
LABEL org.opencontainers.image.source=https://github.com/chrispaskvan/destiny-ghost-api
LABEL org.opencontainers.image.licenses=MIT
LABEL com.destiny-ghost.nodeversion=$NODE_VERSION

# Install python 3
RUN apt-get update && \
    apt-get install -y make && \
    apt-get install -y build-essential && \
    apt-get install -y python3

# arguments with default values and expected environment variables
ARG DESTINY_DATABASE_DIR=./databases/destiny
ENV DESTINY_DATABASE_DIR=$DESTINY_DATABASE_DIR

ARG DESTINY2_DATABASE_DIR=./databases/destiny2
ENV DESTINY2_DATABASE_DIR=$DESTINY2_DATABASE_DIR

ARG DOMAIN=https://api.destiny-ghost.com
ENV DOMAIN=$DOMAIN

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

ARG NODE_OPTIONS="--max-old-space-size=8192 --unhandled-rejections=strict"
ENV NODE_OPTIONS=$NODE_OPTIONS

ARG PORT=1100
ENV PORT=$PORT

EXPOSE $PORT

RUN mkdir /destiny-ghost-api && chown -R node:node /destiny-ghost-api

WORKDIR /destiny-ghost-api

USER node

COPY --chown=node:node package.json package-lock.json* ./

RUN npm config list && npm ci && npm cache clean --force

COPY --chown=node:node . /destiny-ghost-api/

CMD ["sh", "-c", "node  ${NODE_OPTIONS} server.js"]
