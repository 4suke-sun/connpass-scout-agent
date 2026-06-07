#!/usr/bin/env node
// AgentCore Runtime の Node.js zip デプロイ用に、自己完結した node_modules を同梱した
// デプロイ可能ディレクトリ (deploy/) を生成する。
//
// npm workspaces はワークスペース間の依存をルートの node_modules にホイストするため、
// packages/agent/node_modules には実行時依存が揃わない。AgentCore Runtime はビルド環境を
// 持たず zip をそのまま実行するため、deploy/ 配下で package.json を絞り込んだうえで
// クリーンインストールし、自己完結したパッケージを作る。
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(packageDir, "dist");
const deployDir = join(packageDir, "deploy");

rmSync(deployDir, { recursive: true, force: true });
mkdirSync(deployDir, { recursive: true });
cpSync(distDir, join(deployDir, "dist"), { recursive: true });

const sourcePackageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf-8"));
const deployPackageJson = {
  name: sourcePackageJson.name,
  version: sourcePackageJson.version,
  type: sourcePackageJson.type,
  main: sourcePackageJson.main,
  dependencies: sourcePackageJson.dependencies,
};
writeFileSync(join(deployDir, "package.json"), `${JSON.stringify(deployPackageJson, null, 2)}\n`);

execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: deployDir,
  stdio: "inherit",
});

console.log(`デプロイ用パッケージを生成しました: ${deployDir}`);
