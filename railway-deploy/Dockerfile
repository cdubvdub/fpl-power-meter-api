# Use Playwright's official image which already has all dependencies
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies needed for build)
# Use npm install to allow proper dependency resolution with overrides
RUN rm -rf node_modules package-lock.json && npm install
# Ensure Playwright browsers are installed correctly
# The Docker image has browsers, but we need to ensure they match the npm-installed Playwright version
# Don't clear browsers - let Playwright install the version it needs
# Install the specific browser version that Playwright 1.55.0 expects
RUN npx playwright install chromium || true
# Verify what browser version Playwright expects and ensure it exists
RUN node -e "const { chromium } = require('playwright'); const expectedPath = chromium.executablePath(); console.log('Playwright expects browser at:', expectedPath); const fs = require('fs'); if (fs.existsSync(expectedPath)) { console.log('✓ Browser found at expected path'); } else { console.log('✗ Browser NOT found at expected path, listing /ms-playwright:'); try { const dirs = fs.readdirSync('/ms-playwright'); console.log('Available browsers:', dirs); } catch(e) { console.log('Error reading /ms-playwright:', e.message); } }"
# Verify Chromium is accessible and check the executable path
RUN node -e "const { chromium } = require('playwright'); (async () => { try { const browserType = chromium; const executablePath = browserType.executablePath(); console.log('Chromium executable path:', executablePath); console.log('Checking if executable exists...'); const fs = require('fs'); if (fs.existsSync(executablePath)) { console.log('Executable exists at:', executablePath); } else { console.error('Executable NOT found at:', executablePath); process.exit(1); } const browser = await browserType.launch({ headless: true }); await browser.close(); console.log('Chromium browser verified successfully'); } catch(e) { console.error('Chromium verification failed:', e.message); process.exit(1); } })();"
# Verify Express 4.21.2 is actually installed (not 5.x)
RUN npm list express && node -e "const express = require('express'); const pkgPath = require.resolve('express/package.json'); const pkg = require(pkgPath); const version = pkg.version; console.log('Express installed version:', version); if (version && version.startsWith('5.')) { console.error('ERROR: Wrong Express version installed! Expected 4.x, got', version); process.exit(1); } if (!version || !version.startsWith('4.')) { console.error('ERROR: Unexpected Express version:', version); process.exit(1); } console.log('Express version check passed:', version);"
# Debug: Check what Express version was installed and if router exists
RUN echo "=== Checking Express installation ===" && npm list express || true
RUN echo "=== Checking for router package ===" && (ls -la node_modules/ | grep -i router || echo "No router package found") || true
# Remove any router package that might have been installed (Express 4.x doesn't need it)
# But if it exists (from a dependency), we'll fix it instead of removing it
RUN if [ -d "node_modules/router" ]; then \
    echo "Router package found, will fix it later"; \
    else \
    echo "No router package found (good)"; \
    fi
# Verify Express 4.x is installed correctly
RUN node -e "const express = require('express'); console.log('Express version:', express.version || 'unknown');"
# Verify path-to-regexp is accessible
RUN node -e "try { const p = require('path-to-regexp'); console.log('path-to-regexp version:', p.version || 'loaded'); } catch(e) { console.log('path-to-regexp error:', e.message); }"
# Check if router package exists at runtime
RUN node -e "try { require('router'); console.log('WARNING: router package found!'); } catch(e) { console.log('router package not found (good)'); }"

# Copy source code
COPY . .
# Check what's installing router package
RUN echo "=== Checking what installed router ===" && npm list router 2>&1 | head -20 || true
# Express 4.x requires 'router' but has it built-in at express/lib/router
# Remove any external router package and create a shim that re-exports Express's built-in router
RUN if [ -d "node_modules/router" ]; then \
    echo "Router package found, removing it and creating shim..." && \
    rm -rf node_modules/router && \
    mkdir -p node_modules/router && \
    echo "module.exports = require('express/lib/router');" > node_modules/router/index.js && \
    echo '{"name":"router","version":"1.0.0","main":"index.js"}' > node_modules/router/package.json && \
    echo "Created router shim that re-exports Express's built-in router"; \
    else \
    echo "No router package found, creating shim..." && \
    mkdir -p node_modules/router && \
    echo "module.exports = require('express/lib/router');" > node_modules/router/index.js && \
    echo '{"name":"router","version":"1.0.0","main":"index.js"}' > node_modules/router/package.json && \
    echo "Created router shim that re-exports Express's built-in router"; \
    fi

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
