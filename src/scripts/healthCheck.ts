import {config} from 'dotenv';
config();

import {prisma} from '../prisma/client';
import {runStartupChecks} from '../utils/startupChecks';

async function main() {
  console.log('Locator backend health check\n');

  const checks = await runStartupChecks();
  const entries = Object.entries(checks) as [string, {ok: boolean; reason?: string}][];

  let routeCount = 0;
  try {
    const {apiRoutes} = await import('../routes');
    routeCount = apiRoutes.stack.length;
    console.log(`✓ Routes mountable (${routeCount} route groups)`);
  } catch (err) {
    console.log(`✗ Routes failed to load: ${(err as Error).message}`);
  }

  for (const [name, result] of entries) {
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    console.log(result.ok ? `✓ ${label}` : `⚠ ${label} — ${result.reason ?? 'unknown reason'}`);
  }

  const critical = checks.environment.ok && checks.database.ok && routeCount > 0;

  await prisma.$disconnect();

  if (!critical) {
    console.error('\nHealth check FAILED — critical dependency (environment/database/routes) is unavailable.');
    process.exit(1);
  }

  console.log('\nHealth check passed. Non-critical warnings above (Firebase/Cloudinary/Brevo) do not block startup.');
  process.exit(0);
}

main().catch(err => {
  console.error('Health check crashed:', (err as Error).message);
  process.exit(1);
});
