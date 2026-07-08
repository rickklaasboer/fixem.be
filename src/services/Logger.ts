export interface Sink {
    write(line: string): void;
}

/**
 * Structured JSON-line logger. One line per event to a sink (stdout in prod).
 * Concrete (single impl); registered as an instance because `sink` is a value.
 */
export default class Logger {
    constructor(private sink: Sink = process.stdout) {}

    private write(level: string, fields: object, msg: string): void {
        this.sink.write(
            `${JSON.stringify({level, time: new Date().toISOString(), msg, ...fields})}\n`,
        );
    }

    /** Log at info level. */
    public info(fields: object, msg: string): void {
        this.write('info', fields, msg);
    }

    /** Log at warn level. */
    public warn(fields: object, msg: string): void {
        this.write('warn', fields, msg);
    }

    /** Log at error level. */
    public error(fields: object, msg: string): void {
        this.write('error', fields, msg);
    }
}
