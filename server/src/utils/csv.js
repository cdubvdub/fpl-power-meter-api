import { parse } from "csv-parse";

export function parseCsvStream(buffer) {
  return new Promise((resolve, reject) => {
    const records = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    parser.on("readable", () => {
      let record;
      // eslint-disable-next-line no-cond-assign
      while ((record = parser.read())) {
        records.push(record);
      }
    });
    parser.on("error", reject);
    parser.on("end", () => resolve(records));
    parser.write(buffer);
    parser.end();
  });
}

export function buildAddressAndUnitFromRow(row) {
  const addressLine = (row["ADDRESS_LI"] || "").toString().trim();
  const city = (row["CITY"] || "").toString().trim();
  const state = (row["STATE"] || "").toString().trim();
  const zip = (row["ZIP"] || row["ZP"] || "").toString().trim();

  let unit = "";
  const upper = addressLine.toUpperCase();
  if (/(^|\s)(APT|UNIT|#)\s*([\w-]+)/.test(upper)) {
    const match = upper.match(/(?:^|\s)(APT|UNIT|#)\s*([\w-]+)/);
    if (match) unit = match[2];
  }

  const address = [addressLine.split(/\s+(?:APT|UNIT|#)\s*[\w-]+/i)[0].trim(), city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");

  return { address, unit: unit || undefined };
}


