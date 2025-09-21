# FPL Power Meter Status Checker

A web application that automates checking power and meter status for addresses using Playwright to interact with the FPL website.

## Features

- **Single Address Lookup**: Check power status for individual addresses
- **Batch CSV Processing**: Upload CSV files to check multiple addresses
- **Unit/Apartment Support**: Handle addresses with unit numbers
- **Session Management**: Efficient batch processing with maintained login sessions
- **Results Export**: Download results as CSV with timestamps
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Autocomplete**: Browser integration for saved credentials

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Automation**: Playwright
- **Database**: SQLite (local) / PostgreSQL (production)
- **Styling**: Modern CSS with dark/light mode support

## Local Development

1. **Install Dependencies**:
   ```bash
   npm run install:all
   ```

2. **Install Playwright Browsers**:
   ```bash
   cd server
   npx playwright install
   ```

3. **Start Development Servers**:
   ```bash
   npm run dev
   ```

4. **Access the Application**:
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8080

## Environment Variables

Create a `.env` file in the server directory:

```env
HEADLESS=true
PORT=8080
```

## Deployment

### Option 1: Vercel (Recommended)

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Deploy to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Vercel will automatically detect the configuration

### Option 2: Railway

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Deploy**:
   ```bash
   railway login
   railway init
   railway up
   ```

### Option 3: Render

1. **Create render.yaml**:
   ```yaml
   services:
     - type: web
       name: fpl-backend
       env: node
       buildCommand: cd server && npm install
       startCommand: cd server && npm start
     - type: web
       name: fpl-frontend
       env: static
       buildCommand: cd web && npm install && npm run build
       staticPublishPath: web/dist
   ```

2. **Deploy via Render Dashboard**

## Production Considerations

- **Database**: Migrate from SQLite to PostgreSQL for production
- **Environment**: Set `HEADLESS=true` for serverless environments
- **Scaling**: Consider using a queue system for large batch jobs
- **Security**: Add rate limiting and input validation
- **Monitoring**: Add logging and error tracking

## Usage

1. **Enter Credentials**: Username, password, and TIN
2. **Single Lookup**: Enter address and optional unit number
3. **Batch Processing**: Upload CSV with columns: ADDRESS_LI, CITY, STATE, ZIP
4. **View Results**: Check status in the table or download CSV

## CSV Format

For batch processing, your CSV should have these columns:
- `ADDRESS_LI`: Street address
- `CITY`: City name
- `STATE`: State abbreviation
- `ZIP`: ZIP code

## License

MIT License - see LICENSE file for details