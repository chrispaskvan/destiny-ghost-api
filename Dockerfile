FROM node:12.4.0

RUN mkdir -p /usr/src/destiny-ghost-api
WORKDIR /usr/src/destiny-ghost-api

COPY package.json /usr/src/destiny-ghost-api/

RUN npm install

COPY . /usr/src/destiny-ghost-api

EXPOSE 1100

ARG DATABASE=./databases/
ENV DATABASE=$DATABASE

ARG DOMAIN=http://api.destiny-ghost.com:1100
ENV DOMAIN=$DOMAIN

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

CMD [ "npm", "start" ]
