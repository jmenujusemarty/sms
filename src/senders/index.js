import { createDryRunSender } from "./dryRun.js";
import { createMessagesAppSender } from "./messagesApp.js";

export function createSender(config) {
  if (config.sender === "dry-run") return createDryRunSender();
  if (config.sender === "messages") return createMessagesAppSender();
  throw new Error(`Unsupported sender: ${config.sender}`);
}

