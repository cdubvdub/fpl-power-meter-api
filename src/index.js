import express from "express";
import cors from "cors";
import multer from "multer";
import { parseCsvStream } from "./utils/csv.js";
import { ensureDatabase } from "./config/database.js";
import { runSingleLookup, runBatchLookup } from "./services/batch.js";

const app = express();

// Store active connections for real-time updates
const activeConnections = new Map();

// Function to send real-time updates to frontend
function sendProgressUpdate(jobId, data) {
  const connection = activeConnections.get(jobId);
  if (connection) {
    try {
      connection.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.log('Error sending progress update:', error.message);
      activeConnections.delete(jobId);
    }
  }
}
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Server-Sent Events endpoint for real-time progress updates
app.get("/api/jobs/:jobId/progress", (req, res) => {
  const { jobId } = req.params;
  
  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Store the connection
  activeConnections.set(jobId, res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`);

  // Clean up on disconnect
  req.on('close', () => {
    activeConnections.delete(jobId);
  });
});

// Test endpoint to check database persistence
app.get("/api/test-db", (_req, res) => {
  const db = ensureDatabase();
  const testKey = `test-${Date.now()}`;
  
  // Add a test entry
  db.prepare("INSERT INTO jobs(job_id, created_at, status, total, processed) VALUES (?, ?, ?, ?, ?)")
    .run(testKey, new Date().toISOString(), 'test', 1, 1);
  
  // Get all jobs
  const jobs = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
  
  res.json({ 
    message: 'Database test',
    testKey,
    totalJobs: jobs.length,
    jobs: jobs.map(j => ({ jobId: j.jobId, createdAt: j.createdAt, status: j.status }))
  });
});

// Simple root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'FPL Power Meter Status API', 
    status: 'running',
    endpoints: ['/api/lookup', '/api/batch', '/api/jobs', '/health']
  });
});

// Single address lookup
app.post("/api/lookup", async (req, res) => {
  try {
    const { username, password, tin, address, unit } = req.body || {};
    if (!username || !password || !tin || !address) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const result = await runSingleLookup({ username, password, tin, address, unit });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error?.message || "Lookup failed" });
  }
});

// CSV batch lookup
app.post("/api/batch", upload.single("file"), async (req, res) => {
  try {
    const { username, password, tin } = req.body || {};
    if (!username || !password || !tin || !req.file) {
      return res.status(400).json({ error: "Missing required fields or file" });
    }
    const rows = await parseCsvStream(req.file.buffer);
    
    // Create progress callback that sends real-time updates
    const progressCallback = (jobId, data) => {
      sendProgressUpdate(jobId, data);
    };
    
    const result = await runBatchLookup({ username, password, tin, rows, progressCallback });
    console.log('runBatchLookup returned:', result);
    const jobId = typeof result === 'string' ? result : result.jobId;
    console.log('Extracted jobId:', jobId);
    console.log('JobId type:', typeof jobId);
    console.log('Deployment timestamp:', new Date().toISOString());
    console.log('Force restart timestamp:', new Date().toISOString()); // Force restart
    res.json({ jobId, message: "Batch processing started" });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Batch processing failed" });
  }
});

// Get job status
app.get("/api/jobs", (_req, res) => {
  try {
    const db = ensureDatabase();
    const jobs = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 10").all();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error?.message || "Failed to fetch jobs" });
  }
});

// Get job results
app.get("/api/jobs/:jobId/results", (req, res) => {
  try {
    const { jobId } = req.params;
    console.log(`Fetching results for job: ${jobId}`);
    const db = ensureDatabase();
    const results = db.prepare("SELECT * FROM results WHERE job_id = ? ORDER BY row_index").all(jobId);
    console.log(`Found ${results.length} results for job ${jobId}:`, results);
    console.log(`Result job IDs:`, results.map(r => r.jobId || r.job_id));
    console.log(`Looking for job ID:`, jobId);
    res.json(results);
  } catch (error) {
    console.error(`Error fetching results for job ${req.params.jobId}:`, error);
    res.status(500).json({ error: error?.message || "Failed to fetch results" });
  }
});

// Search jobs by date range
app.get("/api/jobs/search", (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log(`Searching jobs from ${startDate} to ${endDate}`);
    const db = ensureDatabase();
    
    // First, let's see what jobs exist
    const allJobs = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
    console.log(`All jobs in database:`, allJobs);
    console.log(`Database instance info:`, db);
    
    // Also check what results exist
    const allResults = db.prepare("SELECT * FROM results ORDER BY status_captured_at DESC").all();
    console.log(`All results in database:`, allResults);
    
    let jobs;
    if (startDate && endDate) {
      // Filter by status captured date range - get unique jobs from results table
      const jobIds = db.prepare(`
        SELECT DISTINCT job_id 
        FROM results 
        WHERE status_captured_at >= ? AND status_captured_at <= ? 
        ORDER BY status_captured_at DESC
      `).all(startDate, endDate);
      
      console.log(`Found ${jobIds.length} job IDs in date range:`, jobIds);
      
      // Get the full job details for these job IDs
      jobs = jobIds.map(j => jobs.get(j.job_id)).filter(j => j);
    } else {
      // Return all jobs
      jobs = allJobs;
    }
    
    console.log(`Found ${jobs.length} jobs in search:`, jobs);
    res.json(jobs);
  } catch (error) {
    console.error('Error searching jobs:', error);
    res.status(500).json({ error: error?.message || "Failed to search jobs" });
  }
});

const PORT = process.env.PORT || 8080;

ensureDatabase();

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
});