"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const arquivos = fs.readdirSync(__dirname)
  .filter((nome) => nome.endsWith(".test.js"))
  .sort();

let falhas = 0;
for (const arquivo of arquivos) {
  const resultado = spawnSync(process.execPath, [path.join(__dirname, arquivo)], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
  if (resultado.status !== 0) falhas++;
}

console.log(`\nBateria completa: ${arquivos.length - falhas} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
