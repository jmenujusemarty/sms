import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function loadConfig(overrides = {}) {
  return {
    host: process.env.SMS_BRIDGE_HOST || "127.0.0.1",
    port: intEnv("SMS_BRIDGE_PORT", 8787),
    dataFile: process.env.SMS_BRIDGE_DATA_FILE || path.join(rootDir, "data", "sms-bridge.sqlite"),
    legacyJsonFile: process.env.SMS_BRIDGE_LEGACY_JSON_FILE || path.join(rootDir, "data", "queue.json"),
    backupDir: process.env.SMS_BRIDGE_BACKUP_DIR || path.join(rootDir, "backups"),
    logDir: process.env.SMS_BRIDGE_LOG_DIR || path.join(rootDir, "logs"),
    sender: process.env.SMS_BRIDGE_SENDER || "dry-run",
    adminEmail: process.env.SMS_BRIDGE_ADMIN_EMAIL || "admin@example.local",
    adminPassword: process.env.SMS_BRIDGE_ADMIN_PASSWORD || "ChangeMe123!",
    devApiToken: process.env.SMS_BRIDGE_DEV_API_TOKEN || "",
    dispatchIntervalMs: intEnv("SMS_BRIDGE_DISPATCH_INTERVAL_MS", 15000),
    maxAttempts: intEnv("SMS_BRIDGE_MAX_ATTEMPTS", 3),
    sendingStaleMs: intEnv("SMS_BRIDGE_SENDING_STALE_MS", 10 * 60 * 1000),
    dispatchLockMs: intEnv("SMS_BRIDGE_DISPATCH_LOCK_MS", 60 * 1000),
    serviceDailyLimit: intEnv("SMS_BRIDGE_SERVICE_DAILY_LIMIT", 300),
    campaignDailyLimit: intEnv("SMS_BRIDGE_CAMPAIGN_DAILY_LIMIT", 100),
    serviceMinGapSeconds: intEnv("SMS_BRIDGE_SERVICE_MIN_GAP_SECONDS", 10),
    campaignMinGapSeconds: intEnv("SMS_BRIDGE_CAMPAIGN_MIN_GAP_SECONDS", 60),
    quietHoursStart: process.env.SMS_BRIDGE_QUIET_HOURS_START || "21:00",
    quietHoursEnd: process.env.SMS_BRIDGE_QUIET_HOURS_END || "08:00",
    allowCampaignDuringQuietHours: process.env.SMS_BRIDGE_ALLOW_CAMPAIGN_QUIET_HOURS === "1",
    ...overrides
  };
}
