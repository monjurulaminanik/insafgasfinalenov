import { getBranding } from '../src/lib/settings.server.ts';

async function test() {
  const b = await getBranding();
  console.log('getBranding() returned:', {
    hasLogo: Boolean(b.logo),
    logoLength: b.logo?.length,
    hasFavicon: Boolean(b.favicon),
    faviconLength: b.favicon?.length,
  });
  process.exit(0);
}

test().catch(e => {
  console.error(e);
  process.exit(1);
});
