import { useMemo, useState, useEffect } from 'react'
import './App.css'

function App() {
  const [form, setForm] = useState({ username: '', password: '', tin: '', address: '', unit: '' })
  const [busy, setBusy] = useState(false)
  const [singleResult, setSingleResult] = useState(null)

  const [file, setFile] = useState(null)
  const [jobId, setJobId] = useState('')
  const [batchResults, setBatchResults] = useState([])

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
      
      const res = await fetch('/api/lookup', {
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
    e.preventDefault()
    setBusy(true)
    setBatchResults([])
    try {
      // Save credentials for future use
      saveCredentials(form.username, form.tin)
      
      const fd = new FormData()
      fd.append('username', form.username)
      fd.append('password', form.password)
      fd.append('tin', form.tin)
      fd.append('file', file)
      const res = await fetch('/api/batch', { method: 'POST', body: fd })
      const data = await res.json()
      if (data?.jobId) {
        setJobId(data.jobId)
        // poll results every 2s until completed
        pollResults(data.jobId)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function pollResults(job) {
    let done = false
    while (!done) {
      await new Promise(r => setTimeout(r, 2000))
      const res = await fetch(`/api/batch/${job}`)
      if (!res.ok) break
      const data = await res.json()
      setBatchResults(data.results || [])
      done = data?.job?.status !== 'running'
    }
  }

  function downloadCsv() {
    const header = 'address,unit,meter_status,property_status,status_captured_at,error\n'
    const rows = (batchResults || []).map(r => [
      r.address || '', 
      r.unit || '', 
      r.meter_status || '', 
      r.property_status || '', 
      r.status_captured_at ? new Date(r.status_captured_at).toLocaleString() : '',
      r.error || ''
    ].map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `results-${jobId || 'batch'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
          <button type="submit" disabled={!canSubmitSingle || busy}>Check Status</button>
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
          <button type="submit" disabled={!canSubmitBatch || busy}>Start Batch</button>
        </form>

        {jobId && (
          <div className="table-wrapper">
            <div className="toolbar">
              <span>Job: {jobId}</span>
              <button onClick={downloadCsv}>Download CSV</button>
            </div>
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
                {(batchResults || []).map((r, idx) => (
                  <tr key={idx}>
                    <td data-label="#">{idx+1}</td>
                    <td data-label="Address">{r.address}</td>
                    <td data-label="Unit">{r.unit}</td>
                    <td data-label="Meter Status">{r.meter_status}</td>
                    <td data-label="Property Status">{r.property_status}</td>
                    <td data-label="Status Captured">{r.status_captured_at ? new Date(r.status_captured_at).toLocaleString() : '-'}</td>
                    <td data-label="Error" className="error">{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default App
