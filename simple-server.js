// Simple server for Railway deployment
import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    ok: true, 
    platform: "Railway (Demo Mode)",
    message: "FPL Power Meter Status API is running!"
  });
});

// Mock single lookup
app.post("/api/lookup", (req, res) => {
  const { username, password, tin, address, unit } = req.body || {};
  
  if (!username || !password || !tin || !address) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  // Return mock response
  res.json({
    meterStatus: "Mock: Connected",
    propertyStatus: "Mock: Occupied",
    address: address,
    unit: unit || null,
    timestamp: new Date().toISOString(),
    note: "This is a mock response for Railway demo"
  });
});

// Mock batch lookup
app.post("/api/batch", (req, res) => {
  const { username, password, tin } = req.body || {};
  
  if (!username || !password || !tin) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: "CSV file is required" });
  }
  
  // Return mock job
  const jobId = `mock-job-${Date.now()}`;
  res.json({ 
    jobId: jobId, 
    total: 1,
    message: "Mock batch processing started"
  });
});

// Mock batch results
app.get("/api/batch/:jobId", (req, res) => {
  const { jobId } = req.params;
  
  res.json({
    job: {
      job_id: jobId,
      status: "completed",
      total: 1,
      processed: 1
    },
    results: [{
      address: "Mock Address",
      unit: null,
      meter_status: "Mock: Connected",
      property_status: "Mock: Occupied",
      error: null,
      status_captured_at: new Date().toISOString()
    }]
  });
});

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "FPL Power Meter Status API",
    endpoints: [
      "GET /health - Health check",
      "POST /api/lookup - Single address lookup",
      "POST /api/batch - Batch CSV processing",
      "GET /api/batch/:jobId - Get batch results"
    ],
    note: "This is a simplified demo version"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
