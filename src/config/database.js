// File-based database for Railway deployment
// This persists data across service restarts
import fs from 'fs';
import path from 'path';

const DATA_FILE = '/tmp/fpl_database.json';

// Use a singleton pattern to ensure data persists across requests
let databaseInstance = null;

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log(`Loaded data from file: ${data.jobs?.length || 0} jobs, ${data.results?.length || 0} results`);
      return data;
    }
  } catch (error) {
    console.log('Error loading data file:', error.message);
  }
  return { jobs: {}, results: {}, nextResultId: 1 };
}

function saveData(data) {
  try {
    const dataToSave = {
      jobs: Object.fromEntries(data.jobs),
      results: Object.fromEntries(data.results),
      nextResultId: data.getNextResultId()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    console.log(`Saved data to file: ${data.jobs.size} jobs, ${data.results.size} results`);
  } catch (error) {
    console.log('Error saving data file:', error.message);
  }
}

function createDatabase() {
  const fileData = loadData();
  const jobs = new Map(Object.entries(fileData.jobs || {}));
  const results = new Map(Object.entries(fileData.results || {}));
  let nextResultId = fileData.nextResultId || 1;

  const db = {
    jobs,
    results,
    nextResultId: () => nextResultId++,
    getNextResultId: () => nextResultId,
    createdAt: new Date().toISOString(),
    save: () => saveData(db)
  };

  // Auto-save every 30 seconds
  setInterval(() => {
    saveData(db);
  }, 30000);

  return db;
}

export function ensureDatabase() {
  if (!databaseInstance) {
    databaseInstance = createDatabase();
    console.log('Created new database instance at:', new Date().toISOString());
  }
  
  const { jobs, results, nextResultId } = databaseInstance;
  console.log(`Database instance: ${jobs.size} jobs, ${results.size} results`);
  console.log('Database instance created at:', databaseInstance.createdAt || 'unknown');
  return {
    prepare: (sql) => {
      return {
        run: (...params) => {
          if (sql.includes('INSERT INTO jobs')) {
            const [jobId, createdAt, status, total, processed] = params;
            jobs.set(jobId, { jobId, createdAt, status, total, processed: processed || 0 });
            databaseInstance.save();
            return { changes: 1, lastInsertRowid: 1 };
          } else if (sql.includes('INSERT OR REPLACE INTO results')) {
            const [jobId, rowIndex, address, unit, meterStatus, propertyStatus, error, createdAt, statusCapturedAt] = params;
            const id = nextResultId();
            const resultData = { 
              id, jobId, rowIndex, address, unit, meterStatus, propertyStatus, error, createdAt, statusCapturedAt 
            };
            results.set(id, resultData);
            console.log(`Database mock: stored result ${id} for job ${jobId}:`, resultData);
            databaseInstance.save();
            return { changes: 1, lastInsertRowid: id };
          } else if (sql.includes('UPDATE jobs SET processed')) {
            const [processed, jobId] = params;
            const job = jobs.get(jobId);
            if (job) {
              job.processed = processed;
              jobs.set(jobId, job);
              databaseInstance.save();
            }
            return { changes: 1 };
          } else if (sql.includes('UPDATE jobs SET status')) {
            const [status, jobId] = params;
            const job = jobs.get(jobId);
            if (job) {
              job.status = status;
              jobs.set(jobId, job);
              databaseInstance.save();
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
            if (params.length > 0) {
              // Filter by jobId
              const jobId = params[0];
              console.log(`Database mock: filtering results for jobId: ${jobId}`);
              const filteredResults = Array.from(results.values())
                .filter(r => r.jobId === jobId)
                .sort((a, b) => a.rowIndex - b.rowIndex);
              console.log(`Database mock: found ${filteredResults.length} results:`, filteredResults);
              return filteredResults;
            } else {
              // Return all results
              const allResults = Array.from(results.values())
                .sort((a, b) => new Date(b.statusCapturedAt) - new Date(a.statusCapturedAt));
              console.log(`Database mock: returning all ${allResults.length} results:`, allResults);
              return allResults;
            }
          }
          return [];
        }
      };
    }
  };
}