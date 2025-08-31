import { prisma } from '../src/index.js';

async function main() {
  await prisma.guildConfig.create({ data: { guildId: '123', language: 'en' } });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
