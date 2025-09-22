// Simple in-memory database for Railway deployment
// This avoids the better-sqlite3 native compilation issues

let jobs = new Map();
let results = new Map();
let nextResultId = 1;

export function ensureDatabase() {
  return {
    prepare: (sql) => {
      return {
        run: (...params) => {
          if (sql.includes('INSERT INTO jobs')) {
            const [jobId, createdAt, status, total, processed] = params;
            jobs.set(jobId, { jobId, createdAt, status, total, processed: processed || 0 });
            return { changes: 1, lastInsertRowid: 1 };
          } else if (sql.includes('INSERT OR REPLACE INTO results')) {
            const [jobId, rowIndex, address, unit, meterStatus, propertyStatus, error, createdAt, statusCapturedAt] = params;
            const id = nextResultId++;
            results.set(id, { 
              id, jobId, rowIndex, address, unit, meterStatus, propertyStatus, error, createdAt, statusCapturedAt 
            });
            return { changes: 1, lastInsertRowid: id };
          } else if (sql.includes('UPDATE jobs SET processed')) {
            const [processed, jobId] = params;
            const job = jobs.get(jobId);
            if (job) {
              job.processed = processed;
              jobs.set(jobId, job);
            }
            return { changes: 1 };
          } else if (sql.includes('UPDATE jobs SET status')) {
            const [status, jobId] = params;
            const job = jobs.get(jobId);
            if (job) {
              job.status = status;
              jobs.set(jobId, job);
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        all: (jobId) => {
          if (sql.includes('SELECT job_id, created_at, status, total, processed FROM jobs')) {
            return Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          } else if (sql.includes('SELECT row_index, address, unit, meter_status, property_status, status_captured_at, error FROM results')) {
            return Array.from(results.values())
              .filter(r => r.jobId === jobId)
              .sort((a, b) => a.rowIndex - b.rowIndex);
          }
          return [];
        }
      };
    }
  };
}