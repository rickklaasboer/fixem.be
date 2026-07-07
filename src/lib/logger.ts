export interface Logger {
  info(fields: object, msg: string): void;
  warn(fields: object, msg: string): void;
  error(fields: object, msg: string): void;
}

interface Sink {
  write(line: string): void;
}

function line(level: string, fields: object, msg: string): string {
  return `${JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })}\n`;
}

export function createLogger(sink: Sink = process.stdout): Logger {
  return {
    info: (fields, msg) => sink.write(line("info", fields, msg)),
    warn: (fields, msg) => sink.write(line("warn", fields, msg)),
    error: (fields, msg) => sink.write(line("error", fields, msg)),
  };
}
