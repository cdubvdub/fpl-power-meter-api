# Use Playwright's official image which already has all dependencies
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies needed for build)
# Use npm install to allow proper dependency resolution with overrides
RUN rm -rf node_modules package-lock.json && npm install
# Remove any router package that might have been installed (Express 4.x doesn't need it)
RUN rm -rf node_modules/router 2>/dev/null || true
RUN ls -la node_modules/ | grep -i router || echo "No router package found (good)"

# Copy source code
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
