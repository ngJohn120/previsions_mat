This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

The dev server runs on **`http://localhost:3001`** (port 3000 is permanently reserved for the Hermes WhatsApp bridge on this machine).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Local Supabase (Podman)

Local Supabase runs in containers via **Podman** (WSL2 machine), not Docker Desktop.

One-time setup:
- `DOCKER_HOST=npipe:////./pipe/podman-machine-default` (user env var, set once)
- Supabase CLI ≥ 2.116.0 (2.111.0 had a Podman workdir regression, see supabase/cli#6035)
- Podman machine: `podman machine start` (WSL memory cap lives in `~/.wslconfig`, 6GB —
  shared with Docker Desktop's WSL distro if it is running)
- `supabase/snippets/` and `supabase/functions/` must exist (Podman won't auto-create
  missing bind-mount dirs the way Docker Desktop does)
- Ports: this project uses **54420–54429** to avoid clashing with other local Supabase
  stacks on the default 5432x range (e.g. Website_Design)
- Windows→WSL port bridges: run `scripts/add-prevision-portproxy.ps1 <WSL_IP>` elevated
  after each reboot (WSL VM IP: `wsl -d podman-machine-default -- ip -4 addr show eth0`)

Daily use:
```bash
supabase start        # API :54421, DB :54422, Studio :54423, Mailpit :54424
supabase stop
```
`.env.local` must point at `http://127.0.0.1:54421` with the keys from
`supabase status -o env` for local dev (prod values live in Vercel).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
