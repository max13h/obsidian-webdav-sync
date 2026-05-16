const PREFIX = "[webdav-sync]";

export class Logger {
	constructor(private settings: { debugMode: boolean }) {}

	debug(...args: unknown[]): void {
		if (this.settings.debugMode) console.debug(PREFIX, ...args);
	}

	info(...args: unknown[]): void {
		console.info(PREFIX, ...args);
	}

	error(...args: unknown[]): void {
		console.error(PREFIX, ...args);
	}
}

export const SILENT_LOGGER = new Logger({ debugMode: false });
