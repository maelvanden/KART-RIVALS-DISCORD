// Kept under its original filename so existing installation instructions still work.
import { registerCommands } from './commands.mjs';
try {
  await registerCommands();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
