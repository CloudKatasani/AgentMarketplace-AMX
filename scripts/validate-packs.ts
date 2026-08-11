/**
 * `pnpm pack:validate` — run in CI.
 *
 * A malformed pack should fail a build, not a customer's first workspace. This
 * checks structure, cross-references, and the rules that would produce a broken
 * seeded workspace rather than merely a broken file.
 */
import { loadAllPacks, packKeys } from "../src/lib/packs/load";

const keys = packKeys();
if (keys.length === 0) {
  console.error("No packs found. Expected at least packs/_generic/pack.yaml.");
  process.exit(1);
}

const { loaded, failed } = loadAllPacks();

for (const pack of loaded) {
  console.info(
    `✔ ${pack.key.padEnd(14)} ${pack.name.padEnd(22)} ` +
      `${pack.personas.length} personas · ${pack.questionLibrary.length} questions · ` +
      `${pack.dataProducts.length} products · ${pack.starterAgents.length} starter agents · ` +
      `${pack.regulatoryConstraints.length} constraints · ${pack.academy.length} academy paths`,
  );
}

for (const failure of failed) {
  if (failure.ok) continue;
  console.error(`\n✘ ${failure.key}`);
  for (const issue of failure.issues) {
    console.error(`    ${issue.path}: ${issue.message}`);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} pack(s) failed validation.`);
  process.exit(1);
}

console.info(`\n${loaded.length} packs valid.`);
