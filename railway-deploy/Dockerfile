# Use Playwright's official image which already has all dependencies
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies needed for build)
# Use npm install to allow proper dependency resolution with overrides
RUN rm -rf node_modules package-lock.json && npm install && rm -rf node_modules/router || true

# Copy source code
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
