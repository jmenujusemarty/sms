export function createDryRunSender() {
  return {
    name: "dry-run",
    async send(message) {
      return {
        provider: "dry-run",
        providerMessageId: `dry-${message.id}`,
        detail: `Would send ${message.kind} message to ${message.to}`
      };
    }
  };
}

