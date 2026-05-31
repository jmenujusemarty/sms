import { addGroup, audit, upsertContact } from "./domain.js";
import { normalizePhone } from "./store.js";

const BASE_COLUMNS = new Set(["name", "phone", "email", "marketingConsent", "consentSource"]);

export function previewContactImport(state, csv) {
  const rows = parseCsv(csv);
  const existingPhones = new Set(state.contacts.map((contact) => contact.phone));
  const seenPhones = new Set();
  const valid = [];
  const invalid = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const errors = [];
    const name = String(row.name || "").trim();
    if (!name) errors.push("missing name");

    let phone = "";
    try {
      phone = normalizePhone(row.phone);
    } catch (error) {
      errors.push(error.message);
    }

    const duplicateInFile = phone && seenPhones.has(phone);
    const duplicateExisting = phone && existingPhones.has(phone);
    if (duplicateInFile) errors.push("duplicate in file");
    if (duplicateExisting) errors.push("phone already exists");
    if (phone) seenPhones.add(phone);

    const contact = {
      name,
      phone,
      email: String(row.email || "").trim(),
      marketingConsent: parseBoolean(row.marketingConsent),
      consentSource: String(row.consentSource || "").trim(),
      fields: customFields(row)
    };

    const item = {
      rowNumber,
      contact,
      errors,
      duplicateInFile,
      duplicateExisting
    };
    if (errors.length > 0) invalid.push(item);
    else valid.push(item);
  });

  return {
    totalRows: rows.length,
    valid,
    invalid,
    summary: {
      totalRows: rows.length,
      valid: valid.length,
      invalid: invalid.length,
      duplicatesInFile: invalid.filter((item) => item.duplicateInFile).length,
      duplicatesExisting: invalid.filter((item) => item.duplicateExisting).length
    }
  };
}

export function commitContactImport(state, input, actor, now = new Date()) {
  const preview = previewContactImport(state, input.csv);
  const createdContacts = [];

  for (const item of preview.valid) {
    createdContacts.push(upsertContact(state, item.contact, actor, now));
  }

  let group = null;
  if (input.groupName && createdContacts.length > 0) {
    group = addGroup(state, {
      name: input.groupName,
      description: "Created from CSV import",
      contactIds: createdContacts.map((contact) => contact.id)
    }, actor, now);
  }

  audit(state, actor, "contacts.imported", {
    totalRows: preview.totalRows,
    created: createdContacts.length,
    invalid: preview.invalid.length,
    groupId: group?.id || null
  }, now);

  return {
    ...preview,
    createdContacts,
    group
  };
}

export function parseCsv(csv) {
  const lines = String(csv || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("CSV is empty");
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  if (!headers.includes("name") || !headers.includes("phone")) {
    throw new Error("CSV must include name and phone columns");
  }
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function customFields(row) {
  const fields = {};
  for (const [key, value] of Object.entries(row)) {
    if (BASE_COLUMNS.has(key)) continue;
    fields[key] = String(value || "").trim();
  }
  return fields;
}

function parseBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "ano", "souhlas"].includes(normalized);
}
