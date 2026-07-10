# Define Node.js version as a build argument
ARG NODE_VERSION=26.5.0

# Build stage - includes dev dependencies for OpenAPI generation
FROM node:${NODE_VERSION}-trixie-slim AS builder

# Enable corepack so the pnpm version pinned in package.json#packageManager is used
RUN npm install -g corepack && corepack enable

WORKDIR /app

# Copy package files and install ALL dependencies (including dev)
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate OpenAPI documentation for production
RUN NODE_ENV=production pnpm run swagger

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

ARG PROTOCOL=https
ENV PROTOCOL=$PROTOCOL

ARG WEBSITE=https://app.destiny-ghost.com
ENV WEBSITE=$WEBSITE

EXPOSE $PORT

# Enable corepack as root before switching to the unprivileged user
RUN npm install -g corepack && corepack enable

# Create application directory and set permissions
RUN mkdir /destiny-ghost-api && chown -R node:node /destiny-ghost-api

WORKDIR /destiny-ghost-api

USER node

# Copy package files and install ONLY production dependencies
COPY --chown=node:node package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# Copy generated OpenAPI file from build stage
COPY --from=builder --chown=node:node /app/openapi.json ./

# Copy application files
COPY --chown=node:node . .

# Create writable databases directories
RUN mkdir -p "$DESTINY_DATABASE_DIR" "$DESTINY2_DATABASE_DIR"

CMD ["pnpm", "run", "start:production"]
