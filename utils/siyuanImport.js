const TAPPAY_SKIP_REGEX = /tappay/i;
const TAIPEI_OFFSET_HOURS = 8;

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizeCampus(rawCampus) {
  const campus = (rawCampus || "").replace(/\s+/g, " ").trim();
  if (/^台北分部\s*Taipei Campus$/i.test(campus)) return "台北分部";
  if (/^台中分部\s*Taichung Campus$/i.test(campus)) return "台中分部";
  if (/^線上分部\s*Online Campus \(Hope Nation\)$/i.test(campus))
    return "線上分部";
  return "其他";
}

function parseTaipeiDateTime(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  const [datePart, timePart] = trimmed.split(/\s+/);
  if (!datePart || !timePart) return null;

  const [year, month, day] = datePart.split("/").map(Number);
  const [hourStr, minuteStr, secondStr] = timePart.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = secondStr ? Number(secondStr) : 0;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return null;
  }

  const utcTimestamp = Date.UTC(
    year,
    month - 1,
    day,
    hour - TAIPEI_OFFSET_HOURS,
    minute,
    second
  );

  if (Number.isNaN(utcTimestamp)) {
    return null;
  }

  return new Date(utcTimestamp);
}

function cleanAmount(rawAmount) {
  const cleaned = (rawAmount || "").replace(/,/g, "").trim();
  const amount = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount;
}

function isHeaderRow(line) {
  return /捐款編號/.test(line) || /Hope/.test(line);
}

function parseSiyuanCsv(csvText, importEnv = "production") {
  const env = importEnv === "sandbox" ? "sandbox" : "production";
  const lines = (csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      records: [],
      skippedTapPay: 0,
      errors: [{ line: 0, reason: "Empty CSV" }],
    };
  }

  const dataLines = isHeaderRow(lines[0]) ? lines.slice(1) : lines;
  const errors = [];
  const records = [];
  let skippedTapPay = 0;
  const seenSiyuanIds = new Set();

  dataLines.forEach((line, index) => {
    const csvRowNumber = index + 1 + (isHeaderRow(lines[0]) ? 1 : 0);
    const cells = splitCsvLine(line).map((cell) => cell.trim());

    if (cells.length < 9) {
      errors.push({
        line: csvRowNumber,
        reason: "Expected at least 9 columns",
      });
      return;
    }

    const noteRaw = cells[8] || "";
    if (TAPPAY_SKIP_REGEX.test(noteRaw)) {
      skippedTapPay += 1;
      return;
    }

    const siyuanId = (cells[1] || "").trim();
    if (!siyuanId) {
      errors.push({
        line: csvRowNumber,
        reason: "Missing or invalid siyuan_id",
      });
      return;
    }

    if (seenSiyuanIds.has(siyuanId)) {
      errors.push({
        line: csvRowNumber,
        reason: "Duplicate siyuan_id in upload",
      });
      return;
    }
    seenSiyuanIds.add(siyuanId);

    const amount = cleanAmount(cells[5]);
    if (amount === null) {
      errors.push({ line: csvRowNumber, reason: "Invalid amount" });
      return;
    }

    const orderDate = parseTaipeiDateTime(cells[6]);
    if (!orderDate) {
      errors.push({ line: csvRowNumber, reason: "Invalid order date" });
      return;
    }

    records.push({
      name: `Siyuan-${siyuanId}`,
      amount,
      currency: "TWD",
      date: orderDate,
      phoneNumber: "N/A",
      email: "",
      receipt: false,
      paymentType: (cells[7] || "").trim(),
      upload: "siyuan_csv",
      receiptName: "",
      nationalid: "",
      company: "",
      taxid: "",
      note: noteRaw.trim(),
      campus: normalizeCampus(cells[3]),
      tpTradeID: `siyuan-${siyuanId}`,
      isSuccess: true,
      env,
      imported: true,
      siyuanId,
      createdAt: orderDate,
    });
  });

  return { records, skippedTapPay, errors };
}

module.exports = {
  parseSiyuanCsv,
  normalizeCampus,
  parseTaipeiDateTime,
};
