FROM node:12.16.1-slim

EXPOSE 1100

ARG DESTINY_DATABASE_DIR=./databases/destiny
ENV DESTINY_DATABASE_DIR=$DESTINY_DATABASE_DIR

ARG DESTINY2_DATABASE_DIR=./databases/destiny2
ENV DESTINY2_DATABASE_DIR=$DESTINY2_DATABASE_DIR

ARG DOMAIN=https://api2.destiny-ghost.com
ENV DOMAIN=$DOMAIN

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

RUN mkdir /destiny-ghost-api && chown -R node:node /destiny-ghost-api

WORKDIR /destiny-ghost-api

USER node

COPY --chown=node:node package.json package-lock.json ./

RUN npm ci

COPY --chown=node:node . /destiny-ghost-api/

CMD [ "node", "server" ]
