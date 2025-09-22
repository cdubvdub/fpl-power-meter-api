import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { parseCsvStream } from "./utils/csv.js";
import { ensureDatabase } from "../src/persistence/db.js";
import { runSingleLookup, runBatchLookup } from "./services/batch.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Serve static files from React build
app.use(express.static(path.join(process.cwd(), 'web', 'dist')));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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
    if (!username || !password || !tin) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required" });
    }

    const rows = await parseCsvStream(req.file.buffer);
    const job = await runBatchLookup({ username, password, tin, rows });
    res.json({ jobId: job.jobId, total: job.total });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Batch start failed" });
  }
});

// Retrieve batch results
app.get("/api/batch/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const db = ensureDatabase();
    const job = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const results = db.prepare("SELECT * FROM results WHERE job_id = ? ORDER BY row_index").all(jobId);
    res.json({ job, results });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Could not fetch results" });
  }
});

const PORT = process.env.PORT || 8080;

// Catch-all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'web', 'dist', 'index.html'));
});

ensureDatabase();

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
});


