import express from "express";
import cors from "cors";
import multer from "multer";
import { parseCsvStream } from "./utils/csv.js";
import { ensureDatabase } from "../src/persistence/db.js";
import { runSingleLookup, runBatchLookup } from "./services/batch.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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
    const jobId = await runBatchLookup({ username, password, tin, rows });
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
    const db = ensureDatabase();
    const results = db.prepare("SELECT * FROM results WHERE job_id = ? ORDER BY row_index").all(jobId);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error?.message || "Failed to fetch results" });
  }
});

const PORT = process.env.PORT || 8080;

ensureDatabase();

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
});