# Sansa for OpenClaw — Installer

One-line installer that configures [OpenClaw](https://openclaw.ai) to route
through [Sansa](https://sansaml.com), giving you access to frontier models at a
fraction of the cost.

## Quick Start

```bash
curl -fsSL https://app.sansaml.com/openclaw/install.sh | sh -s -- YOUR_API_KEY
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## What It Does

1. **Configures the Sansa provider** — merges an `sansa-ai` provider entry and
   default model into `~/.openclaw/openclaw.json`.
2. **Installs a startup hook** — logs a Sansa banner on every gateway start so
   you can confirm routing is active.
3. **Creates a savings config** — writes `~/.openclaw/sansa.json` with baseline
   vs. Sansa pricing for cost tracking.
4. **Drops a savings tracker** — a standalone Node script at
   `~/.openclaw/sansa/savings-tracker.mjs` that scans session logs and reports
   how much you've saved.
5. **Optionally updates HEARTBEAT.md** — so your agent reports savings at the
   start of each session.

## Requirements

- **Node.js 20+** (OpenClaw already requires this)
- An existing OpenClaw installation
- A Sansa API key — get one at [app.sansaml.com](https://app.sansaml.com)

## Development

```bash
npm install
npm run build        # produces dist/install.mjs
npm run typecheck    # type-check without emitting
```

Test locally without downloading from the CDN:

```bash
SANSA_INSTALLER_LOCAL=./dist/install.mjs sh install.sh YOUR_API_KEY
```

## Project Structure

```
src/
  install.ts       # CLI entry point — orchestrates all install steps
  config-patch.ts  # Reads/writes openclaw.json with deep-merge
  templates.ts     # File templates embedded as strings (hook, tracker)
  types.ts         # Shared types, constants, and path definitions
install.sh         # Shell bootstrap that downloads and runs install.mjs
```

## License

[MIT](LICENSE)
