// Simple in-memory database for Railway deployment
// This avoids the better-sqlite3 native compilation issues

// Use a singleton pattern to ensure data persists across requests
let databaseInstance = null;

function createDatabase() {
  const jobs = new Map();
  const results = new Map();
  let nextResultId = 1;

  return {
    jobs,
    results,
    nextResultId: () => nextResultId++,
    getNextResultId: () => nextResultId
  };
}

export function ensureDatabase() {
  if (!databaseInstance) {
    databaseInstance = createDatabase();
    console.log('Created new database instance');
  }
  
  const { jobs, results, nextResultId } = databaseInstance;
  console.log(`Database instance: ${jobs.size} jobs, ${results.size} results`);
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
            const id = nextResultId();
            const resultData = { 
              id, jobId, rowIndex, address, unit, meterStatus, propertyStatus, error, createdAt, statusCapturedAt 
            };
            results.set(id, resultData);
            console.log(`Database mock: stored result ${id} for job ${jobId}:`, resultData);
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
        all: (...params) => {
          if (sql.includes('SELECT * FROM jobs') || sql.includes('SELECT job_id, created_at, status, total, processed FROM jobs')) {
            let jobList = Array.from(jobs.values());
            console.log(`Database mock: Found ${jobList.length} jobs in database`);
            console.log(`Database mock: Jobs:`, jobList);
            
            // Handle date range filtering
            if (sql.includes('WHERE created_at >= ? AND created_at <= ?')) {
              const [startDate, endDate] = params;
              console.log(`Database mock: Filtering by date range ${startDate} to ${endDate}`);
              jobList = jobList.filter(job => {
                const jobDate = new Date(job.createdAt);
                return jobDate >= new Date(startDate) && jobDate <= new Date(endDate);
              });
              console.log(`Database mock: After filtering: ${jobList.length} jobs`);
            }
            
            const sortedJobs = jobList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            console.log(`Database mock: Returning ${sortedJobs.length} sorted jobs`);
            return sortedJobs;
          } else if (sql.includes('SELECT DISTINCT job_id FROM results')) {
            // Handle the new query for searching by status captured date
            const [startDate, endDate] = params;
            console.log(`Database mock: Searching results by status captured date ${startDate} to ${endDate}`);
            
            const filteredResults = Array.from(results.values()).filter(result => {
              if (!result.statusCapturedAt) return false;
              const capturedDate = new Date(result.statusCapturedAt);
              return capturedDate >= new Date(startDate) && capturedDate <= new Date(endDate);
            });
            
            // Get unique job IDs
            const uniqueJobIds = [...new Set(filteredResults.map(r => r.jobId))];
            console.log(`Database mock: Found ${uniqueJobIds.length} unique job IDs:`, uniqueJobIds);
            
            return uniqueJobIds.map(jobId => ({ job_id: jobId }));
          } else if (sql.includes('SELECT * FROM results') || sql.includes('SELECT row_index, address, unit, meter_status, property_status, status_captured_at, error FROM results')) {
            const jobId = params[0]; // First parameter is the jobId
            console.log(`Database mock: filtering results for jobId: ${jobId}`);
            const filteredResults = Array.from(results.values())
              .filter(r => r.jobId === jobId)
              .sort((a, b) => a.rowIndex - b.rowIndex);
            console.log(`Database mock: found ${filteredResults.length} results:`, filteredResults);
            return filteredResults;
          }
          return [];
        }
      };
    }
  };
}