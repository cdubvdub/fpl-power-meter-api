# FPL Power Meter Status API

A Node.js API that uses Playwright to automate FPL website interactions and check power meter status for addresses.

## Features

- Single address lookup
- Batch CSV processing
- SQLite database for job tracking
- Playwright automation for FPL website

## API Endpoints

- `GET /` - API status
- `GET /health` - Health check
- `POST /api/lookup` - Single address lookup
- `POST /api/batch` - Batch CSV processing
- `GET /api/jobs` - List jobs
- `GET /api/jobs/:jobId/results` - Get job results

## Environment Variables

- `PORT` - Server port (default: 8080)
- `HEADLESS` - Playwright headless mode (default: true)




