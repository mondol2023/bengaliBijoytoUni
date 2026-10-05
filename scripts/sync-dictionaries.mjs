// Copies the Hunspell dictionaries the Compare page's spellcheck serves from the npm packages
// into public/dictionaries/. The packages read their files with node:fs, so they cannot be
// bundled for the browser; the app fetches these copies instead. Run after bumping either package:
//   npm run dict:sync
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dictionaries = [
  { id: "en", pkg: "dictionary-en" },
  { id: "en-gb", pkg: "dictionary-en-gb" },
];

for (const { id, pkg } of dictionaries) {
  const from = path.join(root, "node_modules", pkg);
  const to = path.join(root, "public", "dictionaries", id);
  mkdirSync(to, { recursive: true });
  copyFileSync(path.join(from, "index.aff"), path.join(to, `${id}.aff`));
  copyFileSync(path.join(from, "index.dic"), path.join(to, `${id}.dic`));
  copyFileSync(path.join(from, "license"), path.join(to, "LICENSE.txt"));
  console.log(`synced ${pkg} -> public/dictionaries/${id}/`);
}
