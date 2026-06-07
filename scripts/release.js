const { execSync } = require('child_process');
const { version } = require('../package.json');

const tag = `v${version}`;

try {
  console.log('Pushing commits...');
  execSync('git push', { stdio: 'inherit' });

  console.log(`Creating tag ${tag}...`);
  execSync(`git tag ${tag}`, { stdio: 'inherit' });

  console.log(`Pushing tag ${tag}...`);
  execSync(`git push origin ${tag}`, { stdio: 'inherit' });

  console.log(`\nDone! GitHub Actions is now building and publishing ${tag}.`);
  console.log(`Watch: https://github.com/conkCreets/cloaked-manager/actions`);
} catch (e) {
  console.error('\nRelease failed:', e.message);
  process.exit(1);
}
