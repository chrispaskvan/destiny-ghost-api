FROM node:carbon

RUN mkdir -p /usr/src/destiny-ghost-api
WORKDIR /usr/src/destiny-ghost-api

COPY package.json /usr/src/destiny-ghost-api/

RUN npm install

COPY . /usr/src/destiny-ghost-api

EXPOSE 1100

ARG DATABASE=./databases/
ENV DATABASE=$DATABASE

ARG DOMAIN=https://a4600e13.ngrok.io
ENV DOMAIN=$DOMAIN

ARG NODE_ENV=development
ENV NODE_ENV=$NODE_ENV

CMD [ "npm", "start" ]
