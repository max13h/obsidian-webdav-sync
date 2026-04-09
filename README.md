# Webdav-sync Obsidian plugin

This plugin allows you to sync your Obsidian vault with a WebDAV server. It provides a simple interface to connect to your WebDAV server and sync your files.

## Contributing

Contributions are welcome! If you have any ideas for new features or improvements, please feel free to submit a pull request.

### Setup
1. Clone the repository:
   ```bash
   git clone git@github.com:max13h/obsidian-webdav-sync.git
    ```
2. Install dependencies:
    ```bash
   pnpm install
   ```
3. Run the development build:
   ```bash
   pnpm dev
   ```
4. Link the plugin to your Obsidian vault:
   ```bash
   ln -sf "$(pwd)/dist" ~/path/to/obsidian-vault/.obsidian/plugins/webdav-sync
   ```
