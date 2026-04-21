import type { WebdavSyncSettings } from "../../src/settings";

export function makeSettings(overrides: Partial<WebdavSyncSettings> = {}): WebdavSyncSettings {
	return {
		serverUrl: "https://dav.example.com",
		remoteBasePath: "/vault",
		username: "user",
		passwordSecret: "secret",
		syncDirection: "two-way",
		conflictResolution: "newest-wins",
		deletionHandling: "mirror",
		syncScope: "full-vault",
		customSyncFolder: "",
		syncOnStartup: false,
		syncOnSave: false,
		periodicSync: false,
		periodicSyncInterval: 5,
		statusBarEnabled: true,
		notificationsEnabled: true,
		...overrides,
	};
}
