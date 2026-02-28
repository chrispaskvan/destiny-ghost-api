# Define Node.js version as a build argument
ARG NODE_VERSION=24.14.0

# Build stage - includes dev dependencies for OpenAPI generation
FROM node:${NODE_VERSION}-trixie-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install --no-install-recommends -y \
      gcc \
      g++ \
      libc6-dev \
      make \
      python3 \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Copy package files and install ALL dependencies (including dev)
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source code
COPY . .

# Generate OpenAPI documentation for production
RUN NODE_ENV=production npm run swagger

# Production stage - lean runtime image
FROM node:${NODE_VERSION}-trixie-slim AS production

# Set production environment
ENV NODE_ENV=production

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
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci --omit=dev

# Copy generated OpenAPI file from build stage
COPY --from=builder --chown=node:node /app/openapi.json ./

# Copy application files
COPY --chown=node:node . .

# Create writable databases directories
RUN mkdir -p "$DESTINY_DATABASE_DIR" "$DESTINY2_DATABASE_DIR"

CMD ["npm", "run", "start:production"]
