# Deploy to Vercel

1. Import `monjurulaminanik/insafgasfinalenov` into Vercel.
2. Select framework **Other**, root directory `.`, and Node.js **22.x**.
3. Build command: `npm run build`. Output directory: `.vercel/output`.
4. Before deploying, import the local `.env.vercel.local` file in Vercel's Environment Variables settings. This file is intentionally excluded from Git.
5. Required variables: `MONGODB_URI`, `MONGODB_DB=InsafCorporation`, and a random `SESSION_SECRET` of at least 32 characters. Keep `DEMO_LOGIN=false`.
6. Deploy. Existing MongoDB users and records are reused. If Atlas restricts network access, configure access for the Vercel deployment.
7. Add your domain in Vercel and follow the DNS records Vercel provides. The existing VPS DNS records do not point to Vercel.

The build selects Nitro's Vercel preset when Vercel provides `VERCEL=1`; local and VPS builds use `node-server`.

To make the repository private, open GitHub Settings → General → Danger Zone → Change repository visibility → Private. Ensure Vercel's GitHub integration retains access to the private repository.

Do not commit `.env`, `.env.vercel.local`, database credentials, or session secrets, even after making the repository private.
