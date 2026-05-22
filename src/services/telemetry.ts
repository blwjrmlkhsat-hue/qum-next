class Telemetry {
  write() {}
  info() {}
  warn() {}
  error() {}
  debug() {}
  logCspViolation() {}
  async query() { return []; }
}

export const log = new Telemetry();

export async function cleanUpstashLogs() {}