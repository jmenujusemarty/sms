import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createMessagesAppSender() {
  return {
    name: "messages",
    async send(message) {
      const script = `
        on run argv
          set targetPhone to item 1 of argv
          set messageText to item 2 of argv
          tell application "Messages"
            set targetService to 1st service whose service type = SMS
            set targetBuddy to buddy targetPhone of targetService
            send messageText to targetBuddy
          end tell
        end run
      `;

      const { stderr } = await execFileAsync("osascript", ["-e", script, message.to, message.text], {
        timeout: 30000,
        maxBuffer: 1024 * 128
      });

      return {
        provider: "messages",
        providerMessageId: null,
        detail: stderr ? stderr.trim() : "sent through Messages.app"
      };
    }
  };
}

