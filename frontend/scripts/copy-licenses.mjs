import { copyFile, mkdir } from "node:fs/promises";

const dependencies = [
  "react", "react-dom", "scheduler", "skinview3d", "skinview-utils", "three", "@fontsource/vt323",
];

await mkdir("dist/licenses", { recursive: true });
for (const dependency of dependencies) {
  await copyFile(
    `node_modules/${dependency}/LICENSE`,
    `dist/licenses/${dependency.replaceAll("/", "-").replace("@", "")}.txt`,
  );
}
