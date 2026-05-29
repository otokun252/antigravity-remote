# Antigravity Remote

Phone-friendly remote UI for controlling a local Antigravity desktop session.

This project gives you a mobile web bridge for:

- viewing the current Antigravity conversation from your phone
- sending prompts into Antigravity
- switching Antigravity projects from the phone
- browsing the current workspace files
- copying file paths and file contents
- using a LAN URL or a Cloudflare Tunnel URL

This is a practical bridge, not an official Antigravity API client.

## Requirements

- Windows machine with Antigravity desktop installed
- Node.js 20+
- npm
- optional: `cloudflared` for outside access

## Quick Start

```bash
npm install
npm run mobile
```

After startup, open `connection.txt` and use the generated URL on your phone.

For outside access:

```bash
npm run mobile:tunnel
```

If `cloudflared` is available, the tunnel URL is appended to `connection.txt`.

## Environment

Copy `.env.example` to `.env` if you want to override defaults.

Available settings:

- `ANTIGRAVITY_REMOTE_TOKEN`
- `ANTIGRAVITY_REMOTE_PORT`
- `ANTIGRAVITY_REMOTE_HOST`
- `TARGET_WORKSPACE_PATH`

## Main Scripts

```bash
npm run dev
npm run build
npm run server
npm run mobile
npm run mobile:tunnel
npm run lint
```

## Typical Flow

1. Start Antigravity on the PC.
2. Run `npm run mobile` or `npm run mobile:tunnel`.
3. Open the URL from `connection.txt` on the phone.
4. Pick the target project or workspace.
5. Send prompts from the mobile UI.

## Updating

Once this repo is on GitHub, updates can be pulled with:

```bash
git pull
npm install
npm run mobile
```

## Safety Notes

- The URL token acts as an access key.
- Do not share the tokenized URL publicly.
- Quick Tunnel URLs can change after restart.

## Development

Checks used in this repo:

```bash
npm run lint
npm run build
```

GitHub Actions runs both on push and pull request.

## License

MIT
