// Approve necessary build scripts for pnpm
function readPackage(pkg) {
  // Allow these packages to run build scripts
  const allowedPackages = [
    '@prisma/client',
    '@prisma/engines',
    'esbuild',
    'prisma',
    'protobufjs',
    '@sentry/profiling-node'
  ];

  if (allowedPackages.includes(pkg.name)) {
    pkg.scripts = pkg.scripts || {};
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage
  }
};