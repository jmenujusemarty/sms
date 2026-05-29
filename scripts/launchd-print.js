import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();
const launchdDir = path.join(rootDir, "launchd");
await mkdir(launchdDir, { recursive: true });
await mkdir(config.logDir, { recursive: true });

const nodePath = process.execPath;
const serverPlist = plist({
  label: "cz.smsbridge.server",
  programArguments: [nodePath, path.join(rootDir, "src/server.js")],
  workingDirectory: rootDir,
  stdout: path.join(config.logDir, "server.log"),
  stderr: path.join(config.logDir, "server.err.log"),
  env: launchEnv(config)
});
const dispatcherPlist = plist({
  label: "cz.smsbridge.dispatcher",
  programArguments: [nodePath, path.join(rootDir, "src/dispatcher.js"), "--loop"],
  workingDirectory: rootDir,
  stdout: path.join(config.logDir, "dispatcher.log"),
  stderr: path.join(config.logDir, "dispatcher.err.log"),
  env: launchEnv(config)
});

const serverPath = path.join(launchdDir, "cz.smsbridge.server.plist");
const dispatcherPath = path.join(launchdDir, "cz.smsbridge.dispatcher.plist");
await writeFile(serverPath, serverPlist);
await writeFile(dispatcherPath, dispatcherPlist);

console.log(`Wrote ${serverPath}`);
console.log(`Wrote ${dispatcherPath}`);
console.log("");
console.log("Install:");
console.log(`launchctl bootstrap gui/$(id -u) ${serverPath}`);
console.log(`launchctl bootstrap gui/$(id -u) ${dispatcherPath}`);

function launchEnv(config) {
  return {
    SMS_BRIDGE_HOST: config.host,
    SMS_BRIDGE_PORT: String(config.port),
    SMS_BRIDGE_SENDER: config.sender,
    SMS_BRIDGE_DATA_FILE: config.dataFile,
    SMS_BRIDGE_LOG_DIR: config.logDir
  };
}

function plist({ label, programArguments, workingDirectory, stdout, stderr, env }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((item) => `    <string>${escapeXml(item)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`).join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderr)}</string>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
