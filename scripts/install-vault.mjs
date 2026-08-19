// Copies build artifacts into the vault plugin dir. Creates the dir if missing.
// Do NOT run during Phase A — it writes into the real vault.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const VAULT_PLUGIN_DIR = process.env.TASK_VAULT
  ? `${process.env.TASK_VAULT}/.obsidian/plugins/task-vault`
  : `${process.env.HOME}/Documents/Obsidian Vault/.obsidian/plugins/task-vault`;

mkdirSync(VAULT_PLUGIN_DIR, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  copyFileSync(file, join(VAULT_PLUGIN_DIR, file));
  console.log(`copied ${file} → ${VAULT_PLUGIN_DIR}`);
}
