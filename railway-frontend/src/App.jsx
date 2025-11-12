import { useMemo, useState, useEffect } from 'react'
import './App.css'

function App() {
  const [form, setForm] = useState({ username: '', password: '', tin: '', address: '', unit: '' })
  const [busy, setBusy] = useState(false)
  const [singleResult, setSingleResult] = useState(null)

  const [file, setFile] = useState(null)
  const [jobId, setJobId] = useState('')
  const [batchResults, setBatchResults] = useState([])
  const [error, setError] = useState(null)
  
  // Search functionality
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchForm, setSearchForm] = useState({ startDate: '', endDate: '' })
  const [downloadingJobId, setDownloadingJobId] = useState(null)
  const [downloadingBatch, setDownloadingBatch] = useState(false)
  const [sseConnection, setSseConnection] = useState(null)
  const [progressMessage, setProgressMessage] = useState('')

  // Safe setter for batch results to prevent objects from being set
  const setBatchResultsSafe = (newResults) => {
    console.log('Setting batch results:', newResults)
    console.log('Type of newResults:', typeof newResults)
    console.log('Is array:', Array.isArray(newResults))
    console.log('Length:', newResults?.length)
    if (Array.isArray(newResults)) {
      console.log('Setting batch results array with', newResults.length, 'items')
      setBatchResults(newResults)
    } else {
      console.error('Attempted to set non-array batch results:', newResults)
      setBatchResults([])
    }
  }

  // Safe setter for jobId to prevent objects from being set
  const setJobIdSafe = (newJobId) => {
    console.log('Setting jobId:', newJobId)
    if (typeof newJobId === 'string' || typeof newJobId === 'number') {
      setJobId(String(newJobId))
    } else {
      console.error('Attempted to set non-string jobId:', newJobId)
      setJobId('')
    }
  }

  // Clear any errors when starting new operations
  const clearError = () => setError(null)

  // Load saved credentials on component mount
  useEffect(() => {
    const savedUsername = localStorage.getItem('fpl_username')
    const savedTin = localStorage.getItem('fpl_tin')
    if (savedUsername || savedTin) {
      setForm(prev => ({
        ...prev,
        username: savedUsername || '',
        tin: savedTin || ''
      }))
    }
  }, [])

  // Cleanup SSE connection on component unmount
  useEffect(() => {
    return () => {
      if (sseConnection) {
        console.log('Cleaning up SSE connection on unmount')
        sseConnection.close()
      }
    }
  }, [sseConnection])

  // Save credentials to localStorage
  const saveCredentials = (username, tin) => {
    if (username) localStorage.setItem('fpl_username', username)
    if (tin) localStorage.setItem('fpl_tin', tin)
  }

  // Clear saved credentials
  const clearCredentials = () => {
    localStorage.removeItem('fpl_username')
    localStorage.removeItem('fpl_tin')
    setForm(prev => ({
      ...prev,
      username: '',
      tin: ''
    }))
  }

  const canSubmitSingle = useMemo(() => form.username && form.password && form.tin && form.address, [form])
  const canSubmitBatch = useMemo(() => form.username && form.password && form.tin && file, [form, file])

  async function submitSingle(e) {
    e.preventDefault()
    setBusy(true)
    setSingleResult(null)
    try {
      // Save credentials for future use
      saveCredentials(form.username, form.tin)
      
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          tin: form.tin,
          address: form.address,
          unit: form.unit || undefined,
        }),
      })
      const data = await res.json()
      setSingleResult(data)
    } catch (err) {
      setSingleResult({ error: err?.message || 'Request failed' })
    } finally {
      setBusy(false)
    }
  }

  async function submitBatch(e) {
    console.log('submitBatch called')
    e.preventDefault()
    
    try {
      console.log('Setting busy state')
      setBusy(true)
      setBatchResultsSafe([])
      setJobIdSafe('')
      
      console.log('Form data:', { username: form.username, tin: form.tin, file: file?.name })
      
      // Save credentials for future use
      console.log('Saving credentials')
      saveCredentials(form.username, form.tin)
      
      console.log('Creating FormData')
      const fd = new FormData()
      fd.append('username', form.username)
      fd.append('password', form.password)
      fd.append('tin', form.tin)
      fd.append('file', file)
      
      console.log('Making API request to:', `${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/batch`)
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/batch`, { method: 'POST', body: fd })
      
      console.log('Response status:', res.status)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      
      console.log('Parsing response JSON')
      const data = await res.json()
      console.log('Batch response:', data) // Debug log
      
      // Handle both direct jobId string and job object responses
      let jobIdToUse = null
      if (typeof data === 'string') {
        jobIdToUse = data
      } else if (data && typeof data === 'object' && data.jobId) {
        // Check if jobId is a string or nested object
        if (typeof data.jobId === 'string') {
          jobIdToUse = data.jobId
        } else if (typeof data.jobId === 'object' && data.jobId.jobId) {
          jobIdToUse = data.jobId.jobId
        }
      } else if (data && typeof data === 'object' && data.job_id) {
        jobIdToUse = data.job_id
      }
      
                      if (jobIdToUse) {
                        console.log('Job ID received:', jobIdToUse)
                        setJobIdSafe(jobIdToUse)
                        // Connect to Server-Sent Events for real-time updates
                        console.log('Starting SSE connection')
                        connectToProgressUpdates(jobIdToUse)
                      } else {
                        console.error('No jobId found in response:', data)
                        setError(`No jobId found in response: ${JSON.stringify(data)}`)
                        setBusy(false)
                      }
    } catch (err) {
      console.error('Batch submission error:', err)
      setError(`Batch submission failed: ${err.message}`)
      setBusy(false)
    }
  }

  // Server-Sent Events connection for real-time updates
  function connectToProgressUpdates(jobId) {
    console.log('Connecting to Server-Sent Events for job:', jobId)
    
    // Close any existing connection
    if (sseConnection) {
      sseConnection.close()
    }
    
    const eventSource = new EventSource(`${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/jobs/${jobId}/progress`)
    setSseConnection(eventSource)
    
    eventSource.onopen = () => {
      console.log('SSE connection opened for job:', jobId)
    }
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('Received SSE update:', data)
        
        switch (data.type) {
          case 'connected':
            console.log('Connected to progress updates for job:', data.jobId)
            break
            
          case 'job_started':
            console.log('Job started:', data.message)
            setProgressMessage(data.message)
            break
            
          case 'address_completed':
            console.log('Address completed:', data.message)
            setProgressMessage(data.message)
            // Refresh results to show the new completed address
            refreshResults(jobId)
            break
            
          case 'address_failed':
          case 'address_error':
            console.log('Address failed/error:', data.message)
            setProgressMessage(data.message)
            // Refresh results to show the failed address
            refreshResults(jobId)
            break
            
          case 'chunk_started':
          case 'batch_started':
            console.log('Chunk/Batch started:', data.message)
            setProgressMessage(data.message)
            break
            
          case 'batch_completed':
            console.log('Batch completed:', data.message)
            setProgressMessage(data.message)
            // Refresh results to show the completed batch
            refreshResults(jobId)
            break
            
          case 'batch_failed':
            console.log('Batch failed:', data.message)
            setProgressMessage(data.message)
            break
            
          case 'queue_started':
            console.log('Queue started:', data.message)
            setProgressMessage(data.message)
            break
            
          case 'queue_completed':
            console.log('Queue completed:', data.message)
            setProgressMessage(data.message)
            // Final refresh and stop busy state
            refreshResults(jobId)
            setBusy(false)
            eventSource.close()
            setSseConnection(null)
            break
            
          case 'job_completed':
            console.log('Job completed:', data.message)
            setProgressMessage(data.message)
            // Final refresh and stop busy state
            refreshResults(jobId)
            setBusy(false)
            eventSource.close()
            setSseConnection(null)
            break
            
          case 'job_failed':
            console.log('Job failed:', data.message)
            setProgressMessage(data.message)
            setError(`Batch processing failed: ${data.error}`)
            setBusy(false)
            eventSource.close()
            setSseConnection(null)
            break
            
          default:
            console.log('Unknown SSE message type:', data.type)
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error)
      }
    }
    
    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error)
      // Fallback to polling if SSE fails
      console.log('Falling back to polling...')
      eventSource.close()
      setSseConnection(null)
      pollResults(jobId)
    }
    
    // Store the event source for cleanup
    return eventSource
  }
  
  // Refresh results from the database
  async function refreshResults(jobId) {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/jobs/${jobId}/results`)
      if (res.ok) {
        const data = await res.json()
        console.log('Refreshed results:', data)
        console.log('Number of results received:', data.length)
        console.log('First 5 results:', data.slice(0, 5))
        console.log('Last 5 results:', data.slice(-5))
        setBatchResultsSafe(data)
      }
    } catch (error) {
      console.error('Error refreshing results:', error)
    }
  }
  
  // Fallback polling function (kept as backup)
  async function pollResults(job) {
    let done = false
    let pollCount = 0
    const maxPolls = 50 // Stop after 16+ minutes (50 * 20s) for long lists
    
    console.log('Starting fallback polling for job:', job)
    
    while (!done && pollCount < maxPolls) {
      await new Promise(r => setTimeout(r, 20000)) // Changed to 20 seconds
      pollCount++
      
      try {
        console.log(`Polling attempt ${pollCount}/${maxPolls} for job:`, job)
        
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/jobs/${job}/results`)
        if (!res.ok) {
          console.error('Failed to fetch results:', res.status, res.statusText)
          break
        }
        
        const data = await res.json()
        console.log('Polling results:', data) // Debug log
        setBatchResultsSafe(data)
        
        // Check if job is complete by looking at job status
        try {
          const jobRes = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/jobs`)
          if (jobRes.ok) {
            const jobs = await jobRes.json()
            const currentJob = jobs.find(j => j.jobId === job)
            if (currentJob) {
              done = currentJob.status !== 'running'
            }
          }
        } catch (jobError) {
          console.warn('Failed to check job status:', jobError)
        }
        
      } catch (error) {
        console.error('Polling error:', error)
      }
    }
    
    console.log('Fallback polling completed for job:', job)
    setBusy(false)
  }

  function downloadCsv() {
    setDownloadingBatch(true)
    try {
      const header = 'address,unit,meter_status,property_status,status_captured_at,error\n'
      const rows = (batchResults || []).map(r => [
        r.address || '', 
        r.unit || '', 
        r.meterStatus || '', 
        r.propertyStatus || '', 
        r.statusCapturedAt ? new Date(r.statusCapturedAt).toLocaleString() : '',
        r.error || ''
      ].map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')
      const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `results-${jobId || 'batch'}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingBatch(false)
    }
  }

  async function searchJobs(e) {
    e.preventDefault()
    setSearchLoading(true)
    setSearchResults([])
    
    try {
      const params = new URLSearchParams()
      if (searchForm.startDate) params.append('startDate', searchForm.startDate)
      if (searchForm.endDate) params.append('endDate', searchForm.endDate)
      
      const url = `${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/jobs/search?${params.toString()}`
      console.log('Searching jobs:', url)
      
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      
      const jobs = await res.json()
      console.log('Search results:', jobs)
      setSearchResults(jobs)
    } catch (err) {
      console.error('Search error:', err)
      setError(`Search failed: ${err.message}`)
    } finally {
      setSearchLoading(false)
    }
  }

  async function loadJobResults(jobId) {
    setDownloadingJobId(jobId)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8080'}/api/jobs/${jobId}/results`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      
      const results = await res.json()
      console.log('Job results:', results)
      
      // Create CSV content
      const header = 'address,unit,meter_status,property_status,status_captured_at,error\n'
      const rows = results.map(r => [
        r.address || '', 
        r.unit || '', 
        r.meterStatus || '', 
        r.propertyStatus || '', 
        r.statusCapturedAt ? new Date(r.statusCapturedAt).toLocaleString() : '',
        r.error || ''
      ].map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')
      
      const csvContent = header + rows
      
      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `job-${jobId}-results.csv`
      a.click()
      URL.revokeObjectURL(url)
      
      // Also copy to clipboard
      await navigator.clipboard.writeText(csvContent)
      alert('Results copied to clipboard and downloaded!')
    } catch (err) {
      console.error('Error loading job results:', err)
      setError(`Failed to load job results: ${err.message}`)
    } finally {
      setDownloadingJobId(null)
    }
  }

  // Error boundary for rendering
  if (error) {
    return (
      <div className="container">
        <h1>FPL Power/Meter Status</h1>
        <div style={{ background: '#f8d7da', color: '#721c24', padding: '20px', borderRadius: '4px', margin: '20px 0' }}>
          <h3>Application Error</h3>
          <p>{error}</p>
          <button onClick={() => { setError(null); window.location.reload(); }} style={{ marginTop: '10px', padding: '8px 16px' }}>
            Reload Page
          </button>
        </div>
      </div>
    )
  }

  try {
  return (
    <div className="container">
      <h1>FPL Power/Meter Status</h1>

      <section>
        <h2>Credentials</h2>
        <div className="grid">
          <input 
            placeholder="Username" 
            value={form.username} 
            onChange={(e)=>setForm({...form, username:e.target.value})}
            autoComplete="username"
            name="username"
          />
          <input 
            placeholder="Password" 
            type="password" 
            value={form.password} 
            onChange={(e)=>setForm({...form, password:e.target.value})}
            autoComplete="current-password"
            name="password"
          />
          <input 
            placeholder="TIN" 
            value={form.tin} 
            onChange={(e)=>setForm({...form, tin:e.target.value})}
            autoComplete="off"
            name="tin"
          />
        </div>
        <div style={{ marginTop: '10px' }}>
          <button 
            type="button" 
            onClick={clearCredentials}
            style={{ 
              background: '#dc3545', 
              color: 'white', 
              border: 'none', 
              padding: '8px 16px', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Clear Saved Credentials
          </button>
        </div>
      </section>

      <section>
        <h2>Single Address Lookup</h2>
        <form onSubmit={submitSingle}>
          <div className="grid">
            <input placeholder="Address" value={form.address} onChange={(e)=>setForm({...form, address:e.target.value})} />
            <input placeholder="Apt/Unit # (optional)" value={form.unit} onChange={(e)=>setForm({...form, unit:e.target.value})} />
          </div>
                          <button type="submit" disabled={!canSubmitSingle || busy}>
                            {busy && !jobId ? (
                              <>
                                <span style={{ 
                                  display: 'inline-block', 
                                  width: '16px', 
                                  height: '16px', 
                                  border: '2px solid #ffffff', 
                                  borderTop: '2px solid transparent', 
                                  borderRadius: '50%', 
                                  animation: 'spin 1s linear infinite',
                                  marginRight: '8px'
                                }}></span>
                                Checking Status...
                              </>
                            ) : (
                              'Check Status'
                            )}
                          </button>
        </form>
        {singleResult && (
          <div className="result">
            {singleResult.error ? (
              <div className="error">{singleResult.error}</div>
            ) : (
              <ul>
                <li><strong>Address:</strong> {singleResult.address} {singleResult.unit ? `#${singleResult.unit}` : ''}</li>
                <li><strong>Meter Status:</strong> {singleResult.meterStatus}</li>
                <li><strong>Property Status:</strong> {singleResult.propertyStatus}</li>
              </ul>
            )}
          </div>
        )}
      </section>

      <section>
        <h2>Batch (CSV Upload)</h2>
        <form onSubmit={submitBatch}>
          <input type="file" accept=".csv" onChange={(e)=>setFile(e.target.files?.[0] || null)} />
                          <button type="submit" disabled={!canSubmitBatch || busy}>
                            {busy && jobId ? (
                              <>
                                <span style={{ 
                                  display: 'inline-block', 
                                  width: '16px', 
                                  height: '16px', 
                                  border: '2px solid #ffffff', 
                                  borderTop: '2px solid transparent', 
                                  borderRadius: '50%', 
                                  animation: 'spin 1s linear infinite',
                                  marginRight: '8px'
                                }}></span>
                                Processing Batch...
                              </>
                            ) : (
                              'Start Batch'
                            )}
                          </button>
        </form>

        {jobId && (
          <div className="table-wrapper">
            <div className="toolbar">
              <span>Job: {String(jobId)}</span>
              <button 
                onClick={downloadCsv}
                disabled={downloadingBatch}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: downloadingBatch ? 0.7 : 1,
                  cursor: downloadingBatch ? 'not-allowed' : 'pointer'
                }}
              >
                {downloadingBatch ? (
                  <>
                    <span style={{ 
                      display: 'inline-block', 
                      width: '16px', 
                      height: '16px', 
                      border: '2px solid #ffffff', 
                      borderTop: '2px solid transparent', 
                      borderRadius: '50%', 
                      animation: 'spin 1s linear infinite'
                    }}></span>
                    Downloading...
                  </>
                ) : (
                  'Download CSV'
                )}
              </button>
            </div>
            {busy && (
              <div style={{ padding: '20px', textAlign: 'center', background: '#f8f9fa', borderRadius: '4px', margin: '10px 0' }}>
                <div>
                  <span style={{ 
                    display: 'inline-block', 
                    width: '16px', 
                    height: '16px', 
                    border: '2px solid #007bff', 
                    borderTop: '2px solid transparent', 
                    borderRadius: '50%', 
                    animation: 'spin 1s linear infinite',
                    marginRight: '8px'
                  }}></span>
                  Processing batch job... Please wait.
                </div>
                <div style={{ fontSize: '0.9em', color: '#666', marginTop: '5px' }}>
                  Results: {batchResults.length} processed so far
                </div>
                {progressMessage && (
                  <div style={{ 
                    fontSize: '0.9em', 
                    color: progressMessage.includes('failed') || progressMessage.includes('error') ? '#dc3545' : '#28a745', 
                    marginTop: '5px', 
                    fontWeight: 'bold',
                    padding: '8px',
                    background: progressMessage.includes('failed') || progressMessage.includes('error') ? '#f8d7da' : '#d4edda',
                    borderRadius: '4px',
                    border: progressMessage.includes('failed') || progressMessage.includes('error') ? '1px solid #f5c6cb' : '1px solid #c3e6cb'
                  }}>
                    {progressMessage}
                  </div>
                )}
                <div style={{ fontSize: '0.8em', color: '#888', marginTop: '3px' }}>
                  Real-time updates via Server-Sent Events • Processing in 50-address chunks
                </div>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Address</th>
                  <th>Unit</th>
                  <th>Meter Status</th>
                  <th>Property Status</th>
                  <th>Status Captured</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  console.log('Rendering batchResults:', batchResults)
                  console.log('batchResults length:', batchResults?.length)
                  console.log('batchResults type:', typeof batchResults)
                  const resultsArray = batchResults || []
                  console.log('resultsArray length:', resultsArray.length)
                  return resultsArray.map((r, idx) => {
                  try {
                    // Ensure r is an object and not something else
                    if (!r || typeof r !== 'object') {
                      console.warn('Invalid row data:', r)
                      return (
                        <tr key={idx}>
                          <td data-label="#">{idx+1}</td>
                          <td data-label="Address" colSpan="6" className="error">Invalid data</td>
                        </tr>
                      )
                    }
                    
                    return (
                      <tr key={idx}>
                        <td data-label="#">{idx+1}</td>
                        <td data-label="Address">{String(r?.address || '-')}</td>
                        <td data-label="Unit">{String(r?.unit || '-')}</td>
                        <td data-label="Meter Status">{String(r?.meterStatus || '-')}</td>
                        <td data-label="Property Status">{String(r?.propertyStatus || '-')}</td>
                        <td data-label="Status Captured">{r?.statusCapturedAt ? new Date(r.statusCapturedAt).toLocaleString() : '-'}</td>
                        <td data-label="Error" className="error">{String(r?.error || '-')}</td>
                      </tr>
                    )
                  } catch (error) {
                    console.error('Error rendering row:', error, r)
                    return (
                  <tr key={idx}>
                    <td data-label="#">{idx+1}</td>
                        <td data-label="Address" colSpan="6" className="error">Error rendering row</td>
                      </tr>
                    )
                  }
                })
                })()}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Search Previous Runs</h2>
        <form onSubmit={searchJobs}>
          <div className="grid">
            <input 
              type="date" 
              placeholder="Start Date (optional)" 
              value={searchForm.startDate} 
              onChange={(e) => setSearchForm({...searchForm, startDate: e.target.value})}
            />
            <input 
              type="date" 
              placeholder="End Date (optional)" 
              value={searchForm.endDate} 
              onChange={(e) => setSearchForm({...searchForm, endDate: e.target.value})}
            />
          </div>
          <button type="submit" disabled={searchLoading}>
            {searchLoading ? (
              <>
                <span style={{ 
                  display: 'inline-block', 
                  width: '16px', 
                  height: '16px', 
                  border: '2px solid #ffffff', 
                  borderTop: '2px solid transparent', 
                  borderRadius: '50%', 
                  animation: 'spin 1s linear infinite',
                  marginRight: '8px'
                }}></span>
                Searching...
              </>
            ) : (
              'Search Jobs'
            )}
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className="table-wrapper">
            <div className="toolbar">
              <span>Found {searchResults.length} job(s)</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Processed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((job) => (
                  <tr key={job.jobId}>
                    <td data-label="Job ID">{job.jobId}</td>
                    <td data-label="Created">{new Date(job.createdAt).toLocaleString()}</td>
                    <td data-label="Status">{job.status}</td>
                    <td data-label="Total">{job.total}</td>
                    <td data-label="Processed">{job.processed}</td>
                    <td data-label="Actions">
                      <button 
                        onClick={() => loadJobResults(job.jobId)}
                        disabled={downloadingJobId === job.jobId}
                        style={{ 
                          background: downloadingJobId === job.jobId ? '#6c757d' : '#28a745', 
                          color: 'white', 
                          border: 'none', 
                          padding: '4px 8px', 
                          borderRadius: '3px',
                          cursor: downloadingJobId === job.jobId ? 'not-allowed' : 'pointer',
                          fontSize: '0.8em',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        {downloadingJobId === job.jobId ? (
                          <>
                            <span style={{ 
                              display: 'inline-block', 
                              width: '12px', 
                              height: '12px', 
                              border: '2px solid #ffffff', 
                              borderTop: '2px solid transparent', 
                              borderRadius: '50%', 
                              animation: 'spin 1s linear infinite'
                            }}></span>
                            Downloading...
                          </>
                        ) : (
                          'Download & Copy'
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
  } catch (renderError) {
    console.error('Rendering error:', renderError)
    return (
      <div className="container">
        <h1>FPL Power/Meter Status</h1>
        <div style={{ background: '#f8d7da', color: '#721c24', padding: '20px', borderRadius: '4px', margin: '20px 0' }}>
          <h3>Rendering Error</h3>
          <p>An error occurred while rendering the page: {renderError.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: '10px', padding: '8px 16px' }}>
            Reload Page
          </button>
        </div>
      </div>
    )
  }
}

export default App
