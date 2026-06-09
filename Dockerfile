FROM node:22-alpine AS builder

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src/

# Generate Prisma client and compile TypeScript
RUN npm run build

# ---
FROM node:22-alpine AS production

# Install OpenSSL for Prisma and curl for healthchecks
RUN apk add --no-cache openssl curl

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
COPY prisma ./prisma/
# dotenv is imported at runtime by server.ts but listed under devDependencies locally
RUN npm ci --omit=dev && npm install dotenv --no-save

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Create a non-root user
RUN addgroup -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose the API port
EXPOSE 5001

# Start the server (with prisma migrations if needed)
CMD ["npm", "run", "start"]
