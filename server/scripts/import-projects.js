#!/usr/bin/env node
/**
 * Bulk-import projects from an Excel workbook into Stashr's encrypted project
 * tracker — WITHOUT ever sending plaintext to the server.
 *
 * This script speaks the exact same protocol the browser does (see
 * client/src/lib/crypto.js): it derives your vault key from your master
 * password with PBKDF2 (using YOUR account's real salt/iterations, fetched
 * after login), encrypts every project with AES-256-GCM locally, and only
 * ever sends the server opaque ciphertext blobs via /projects/items/bulk —
 * the same endpoint the web app uses. The server cannot read what it stores.
 *
 * Your master password is used locally, in this process, only to derive the
 * key. It is never sent over the network and never written to disk.
 *
 * Usage:
 *   node server/scripts/import-projects.js path/to/projects.xlsx
 *
 * Expects the same layout as the Stashr project-tracker Excel template:
 *   Sheet "Projects":  one row per project (see COLUMN_MAP below for headers)
 *   Sheet "Databases":  project_name, label, provider, type, account_email, notes
 *   Sheet "Env Vars" (any sheet name containing "env"): project_name, variable_name / name,
 *                      value, purpose (or service / purpose)
 *
 * Rows above the header, and the yellow "example" row right under the
 * header, are skipped automatically if they don't look like real data.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const KDF_ITERATIONS = 600000;
const MAX_BATCH = 500;

/* ── crypto: must match client/src/lib/crypto.js exactly ── */

function deriveKey(password, saltB64, iterations) {
  return crypto.pbkdf2Sync(password, Buffer.from(saltB64, "base64"), iterations, 32, "sha256");
}

function encryptString(keyBytes, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([ct, tag]); // WebCrypto's AES-GCM output is ciphertext||tag
  return `v1:${iv.toString("base64")}:${combined.toString("base64")}`;
}

const encryptJSON = (keyBytes, obj) => encryptString(keyBytes, JSON.stringify(obj));

/* ── prompts ── */

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!hidden) {
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
      return;
    }
    // Best-effort masking: works in a real TTY, falls back to plain input otherwise.
    const stdin = process.stdin;
    process.stdout.write(question);
    let input = "";
    if (!stdin.isTTY) { rl.question("", (a) => { rl.close(); resolve(a.trim()); }); return; }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char) => {
      if (char === "\n" || char === "\r" || char === "\u0004") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(input.trim());
        return;
      }
      if (char === "\u0003") process.exit(1); // Ctrl+C
      if (char === "\u007f") { input = input.slice(0, -1); return; }
      input += char;
    };
    stdin.on("data", onData);
  });
}

/* ── excel ── */

function readWorkbook(file) {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch (e) {
    console.error('Missing dependency. Run: npm install xlsx --no-save   (inside server/)');
    process.exit(1);
  }
  const wb = XLSX.readFile(file);
  const sheet = (nameGuess) => {
    const name = wb.SheetNames.find((n) => n.toLowerCase().includes(nameGuess));
    return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }) : [];
  };
  return {
    projects: sheet("project"),
    databases: sheet("database"),
    envVars: sheet("env"),
  };
}

// Excel header (snake_case) -> project field (camelCase, matches client/src/lib/projectItems.js)
const COLUMN_MAP = {
  name: "name", description: "description", category: "category", tech_stack: "techStack",
  status: "status", priority: "priority", tags: "tags",
  repo_url: "repoUrl", repo_account: "repoAccount", live_url: "liveUrl", custom_domain: "customDomain",
  hosting_provider: "hostingProvider", hosting_account_email: "hostingAccountEmail",
  hosting_account_label: "hostingAccountLabel", hosting_service_name: "hostingServiceName",
  hosting_plan: "hostingPlan", hosting_region: "hostingRegion", auto_deploy_branch: "autoDeployBranch",
  firebase_project_id: "firebaseProjectId", firebase_account_email: "firebaseAccountEmail",
  google_cloud_project_id: "googleCloudProjectId", google_cloud_account_email: "googleCloudAccountEmail",
  play_store_package_name: "playStorePackageName", play_store_account_email: "playStoreAccountEmail",
  play_store_url: "playStoreUrl", play_store_status: "playStoreStatus",
  dns_provider: "dnsProvider", dns_account_email: "dnsAccountEmail",
  env_vars_location: "envVarsLocationNote", env_var_names: "envVarNamesNote",
  monitoring_provider: "monitoringProvider", monitoring_account_email: "monitoringAccountEmail",
  last_deployed_at: "lastDeployedAt", notes: "notes",
};

const isRealRow = (row) => String(row.name || "").trim().length > 0;

function buildProjects(sheets) {
  const projects = new Map(); // name -> project object

  sheets.projects.filter(isRealRow).forEach((row) => {
    const project = {};
    Object.entries(COLUMN_MAP).forEach(([col, field]) => { project[field] = String(row[col] ?? "").trim(); });
    project.databases = [];
    project.envVars = [];
    project.extraFields = [];
    if (project.envVarNamesNote || project.envVarsLocationNote) {
      project.notes = [project.notes, project.envVarNamesNote && `Env var names: ${project.envVarNamesNote}`, project.envVarsLocationNote && `Env vars location: ${project.envVarsLocationNote}`]
        .filter(Boolean).join("\n");
    }
    delete project.envVarNamesNote;
    delete project.envVarsLocationNote;
    projects.set(project.name, project);
  });

  sheets.databases.forEach((row) => {
    const name = String(row.project_name || "").trim();
    const project = projects.get(name);
    if (!project) return;
    if (!row.provider && !row.type && !row.label) return;
    project.databases.push({
      label: String(row.label || "").trim(),
      provider: String(row.provider || "").trim(),
      type: String(row.type || "").trim(),
      accountEmail: String(row.account_email || "").trim(),
      notes: String(row.notes || "").trim(),
    });
  });

  sheets.envVars.forEach((row) => {
    const name = String(row.project_name || "").trim();
    const project = projects.get(name);
    if (!project) return;
    const varName = String(row.variable_name || row.name || "").trim();
    if (!varName) return;
    project.envVars.push({
      name: varName,
      value: String(row.value || row["account_email (fill this)"] || "").trim(),
      purpose: String(row.purpose || row["service / purpose"] || "").trim(),
    });
  });

  return [...projects.values()];
}

/* ── API ── */

async function apiPost(baseUrl, path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
  return data;
}

async function apiGet(baseUrl, path, token) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
  return data;
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error("Usage: node server/scripts/import-projects.js path/to/projects.xlsx");
    process.exit(1);
  }

  const baseUrl = (await ask("Stashr API URL [https://password-manager-server-xxdr.onrender.com]: ")) || "https://password-manager-server-xxdr.onrender.com";
  const email = await ask("Email: ");
  const password = await ask("Master password: ", { hidden: true });

  console.log("Signing in…");
  const login = await apiPost(baseUrl.replace(/\/+$/, ""), "/login", { email, password, client: "mobile" });
  const base = baseUrl.replace(/\/+$/, "");
  const token = login.token;
  if (!token) throw new Error("Login didn't return a token — check your credentials.");
  if (!login.vault || !login.vault.kdf) throw new Error("This account has no vault key set up yet. Sign in once on the website first.");

  const key = deriveKey(password, login.vault.kdf.salt, login.vault.kdf.iterations);

  console.log(`Reading ${path.basename(file)}…`);
  const sheets = readWorkbook(file);
  const projects = buildProjects(sheets);
  if (!projects.length) { console.log("No project rows found. Nothing to do."); return; }

  console.log(`Encrypting ${projects.length} project${projects.length === 1 ? "" : "s"} locally…`);
  const items = projects.map((p) => ({ data: encryptJSON(key, p) }));

  let imported = 0;
  for (let i = 0; i < items.length; i += MAX_BATCH) {
    const chunk = items.slice(i, i + MAX_BATCH);
    const res = await apiPost(base, "/projects/items/bulk", { items: chunk }, token);
    imported += res.items.length;
    console.log(`  uploaded ${imported}/${items.length}`);
  }

  console.log(`Done — ${imported} project${imported === 1 ? "" : "s"} imported into Stashr, encrypted end-to-end.`);
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
