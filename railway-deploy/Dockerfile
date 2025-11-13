# Use Playwright's official image which already has all dependencies
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies needed for build)
# Use npm install to allow proper dependency resolution with overrides
RUN rm -rf node_modules package-lock.json && npm install
# Debug: Check what Express version was installed and if router exists
RUN echo "=== Checking Express installation ===" && npm list express || true
RUN echo "=== Checking for router package ===" && (ls -la node_modules/ | grep -i router || echo "No router package found") || true
# Remove any router package that might have been installed (Express 4.x doesn't need it)
RUN rm -rf node_modules/router 2>/dev/null || true
# Verify Express 4.x is installed correctly
RUN node -e "const express = require('express'); console.log('Express version:', express.version || 'unknown');"

# Copy source code
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
