#Node based Destiny Ghost API container
FROM node:latest
MAINTAINER destiny.ghost@apricothill.com
COPY . /src
WORKDIR /src
RUN npm install
EXPOSE 1100
ENTRYPOINT npm start
