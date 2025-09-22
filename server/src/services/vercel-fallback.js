// Fallback service for Vercel deployment
// This provides mock responses when Playwright isn't available

export async function runSingleLookupVercel({ username, password, tin, address, unit }) {
  // In a real deployment, you'd want to use a different approach
  // For now, return a mock response to show the app structure works
  return {
    meterStatus: "Mock: Connected",
    propertyStatus: "Mock: Occupied",
    address: address,
    unit: unit || null,
    timestamp: new Date().toISOString(),
    note: "This is a mock response. Playwright automation requires a different deployment platform."
  };
}

export async function runBatchLookupVercel({ username, password, tin, rows }) {
  const jobId = `mock-job-${Date.now()}`;
  
  // Create mock results for each row
  const mockResults = rows.map((row, index) => ({
    job_id: jobId,
    row_index: index,
    address: `${row.ADDRESS_LI}, ${row.CITY}, ${row.STATE} ${row.ZIP}`,
    unit: extractUnitFromAddress(row.ADDRESS_LI),
    meter_status: "Mock: Connected",
    property_status: "Mock: Occupied", 
    error: null,
    created_at: new Date().toISOString(),
    status_captured_at: new Date().toISOString()
  }));

  return {
    jobId,
    total: rows.length,
    results: mockResults
  };
}

function extractUnitFromAddress(address) {
  const unitMatch = address.match(/(?:APT|UNIT|#)\s*([A-Z0-9]+)/i);
  return unitMatch ? unitMatch[1] : null;
}
