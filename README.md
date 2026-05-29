# Antigravity Remote

Mobile web bridge for a local Antigravity desktop session.

This repo is meant to be shared through GitHub and run on each user's own machine. The recommended architecture is:

- Antigravity desktop runs locally on the user's PC or Mac
- this bridge server runs locally on the same machine
- the phone opens the remote UI through a Cloudflare Tunnel URL

This is not an official Antigravity API client. It is a local bridge that mirrors and controls a real Antigravity desktop session.

## What it does

- mirror the current Antigravity conversation on a phone
- send prompts from a phone into Antigravity
- stop a running response from the phone
- switch projects and conversations
- browse workspace files and copy paths or contents
- upload images and videos into the workspace
- trigger screenshots
- handle approval prompts from the phone

## Requirements

- Antigravity desktop installed on Windows or macOS
- Node.js 20+
- npm
- `cloudflared` installed for the default outside-access flow

## Quick start

### Windows

```powershell
git clone https://github.com/otokun252/antigravity-remote.git
cd antigravity-remote
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
npm run mobile
```

### macOS

```bash
git clone https://github.com/otokun252/antigravity-remote.git
cd antigravity-remote
chmod +x ./scripts/setup-macos.sh
./scripts/setup-macos.sh
npm run mobile
```

`npm run mobile` starts the bridge in tunnel mode by default. After startup, open `connection.txt` and use the `URL:` value on your phone.

Example:

```txt
MODE: tunnel
URL: https://example.trycloudflare.com?token=...
```

## Local-only mode

This repo now treats outside access as the default. If you explicitly want same-Wi-Fi testing only:

```bash
npm run mobile:local
```

## cloudflared

The default startup expects `cloudflared` to be installed. If it is missing, `npm run mobile` fails instead of silently falling back to LAN mode.

Cloudflare installation docs:

- https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

## Environment

Copy `.env.example` to `.env` if you need overrides.

Available settings:

- `ANTIGRAVITY_REMOTE_TOKEN`
- `ANTIGRAVITY_REMOTE_PORT`
- `ANTIGRAVITY_REMOTE_HOST`
- `TARGET_WORKSPACE_PATH`

## Scripts

```bash
npm run dev
npm run build
npm run server
npm run mobile
npm run mobile:local
npm run lint
```

## Typical flow

1. Start Antigravity on the computer.
2. Run `npm run mobile`.
3. Wait for the tunnel URL to appear in `connection.txt`.
4. Open that URL on the phone.
5. Work from the phone while Antigravity stays on the desktop.

## Updating

```bash
git pull
npm install
npm run mobile
```

## Safety notes

- The tokenized URL is an access key.
- Do not share the tokenized URL publicly.
- Quick Tunnel URLs are temporary and can change after restart.

## Development checks

```bash
npm run lint
npm run build
```

## License

MIT
