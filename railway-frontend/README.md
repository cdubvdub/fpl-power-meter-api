# FPL Power Meter Status Frontend

React frontend for the FPL Power Meter Status application.

## Features

- Single address lookup
- Batch CSV processing
- Modern, responsive UI
- Light/dark mode support
- Mobile-friendly design

## Environment Variables

- `VITE_API_URL` - Backend API URL (optional, defaults to localhost:8080)

## Deployment

This frontend is configured for Railway deployment and will automatically:
1. Install dependencies
2. Build the React app
3. Serve static files with Express

## API Integration

The frontend connects to the backend API at the following endpoints:
- `POST /api/lookup` - Single address lookup
- `POST /api/batch` - Batch CSV processing
- `GET /api/jobs` - List jobs
- `GET /api/jobs/:jobId/results` - Get job results