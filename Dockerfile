# Build stage - includes dev dependencies for OpenAPI generation
FROM node:24.6.0-bookworm-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install --no-install-recommends -y \
      gcc \
      g++ \
      libc6-dev \
      make \
      python3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* /var/tmp/*

WORKDIR /app

# Copy package files and install ALL dependencies (including dev)
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Generate OpenAPI documentation for production
RUN NODE_ENV=production npm run swagger

# Production stage - lean runtime image
FROM node:24.6.0-bookworm-slim AS production

# Labels
LABEL org.opencontainers.image.source=https://github.com/chrispaskvan/destiny-ghost-api \
      org.opencontainers.image.licenses=MIT

# Arguments with default values and expected environment variables
ARG DESTINY_DATABASE_DIR=./databases/destiny
ENV DESTINY_DATABASE_DIR=$DESTINY_DATABASE_DIR

ARG DESTINY2_DATABASE_DIR=./databases/destiny2
ENV DESTINY2_DATABASE_DIR=$DESTINY2_DATABASE_DIR

ARG DOMAIN=api.destiny-ghost.com
ENV DOMAIN=$DOMAIN

ARG PORT=1100
ENV PORT=$PORT

EXPOSE $PORT

# Create application directory and set permissions
RUN mkdir /destiny-ghost-api && chown -R node:node /destiny-ghost-api

WORKDIR /destiny-ghost-api

USER node

# Copy package files and install ONLY production dependencies
COPY --chown=node:node package.json package-lock.json* ./
RUN npm config list && npm ci --omit=dev && npm cache clean --force

# Copy generated OpenAPI file from build stage
COPY --from=builder --chown=node:node /app/openapi.json ./

# Copy application files
COPY --chown=node:node . .

# Set production environment
ENV NODE_ENV=production

CMD ["npm", "run", "start:production"]
