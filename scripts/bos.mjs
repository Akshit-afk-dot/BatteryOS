#!/usr/bin/env node
// Cross-platform task runner for BatteryOS (Windows, macOS, Linux).
//
//   node scripts/bos.mjs setup   create the Python venv, install API + web dependencies
//   node scripts/bos.mjs dev     run API (port 8000) and web (port 3000) together
//   node scripts/bos.mjs api     run only the API
//   node scripts/bos.mjs web     run only the web app (dev server)
//   node scripts/bos.mjs test    run the API test suite
//   node scripts/bos.mjs seed    create a clearly-labelled demo workspace
//   node scripts/bos.mjs build   production build of the web app
//
// The npm scripts in the root package.json call these.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, watch as fsWatch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(ROOT, "services", "api");
const WEB = join(ROOT, "apps", "web");
const VENV = join(ROOT, ".venv");
const isWin = process.platform === "win32";
const PY = join(VENV, isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");
const NEXT = join(WEB, "node_modules", "next", "dist", "bin", "next");

const color = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(color(31, `\n✗ ${cmd} ${args.join(" ")} failed (exit ${r.status ?? r.error?.message})`));
    process.exit(r.status ?? 1);
  }
}

function findSystemPython() {
  const candidates = isWin ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info >= (3, 11))"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "True") return [cmd, pre];
  }
  console.error(color(31, "Python 3.11+ is required. Install it from python.org and try again."));
  process.exit(1);
}

function needVenv() {
  if (!existsSync(PY)) {
    console.error(color(31, "Python environment not found. Run `npm run setup` first."));
    process.exit(1);
  }
}

function needWeb() {
  if (!existsSync(NEXT)) {
    console.error(color(31, "Web dependencies not installed. Run `npm run setup` first."));
    process.exit(1);
  }
}

function setup() {
  if (!existsSync(PY)) {
    const [cmd, pre] = findSystemPython();
    console.log(color(36, "→ Creating Python virtual environment (.venv)"));
    run(cmd, [...pre, "-m", "venv", VENV]);
  }
  console.log(color(36, "→ Installing API dependencies"));
  run(PY, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"]);
  run(PY, ["-m", "pip", "install", "-r", join(API, "requirements-dev.txt"), "--quiet"]);
  console.log(color(36, "→ Installing web dependencies"));
  // npm is a .cmd shim on Windows, which needs a shell; pass one command string there.
  if (isWin) run("npm install --no-audit --no-fund", [], { cwd: WEB, shell: true });
  else run("npm", ["install", "--no-audit", "--no-fund"], { cwd: WEB });
  console.log(color(36, "→ Generating synthetic sample files (samples/)"));
  run(PY, [join(ROOT, "scripts", "generate_samples.py")]);
  console.log(color(32, "\n✓ Setup complete. Start with: npm run dev"));
}

function start(name, cmd, args, opts, tint) {
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "1", ...(opts.env ?? {}) } });
  const prefix = color(tint, `[${name}]`);
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(`${prefix} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

const API_ARGS = ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", process.env.API_PORT ?? "8000"];

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

// Restarts the API when Python files change. We do this ourselves instead of
// `uvicorn --reload`, whose Windows reloader sends Ctrl+C to the whole console
// and would also stop this script and the web server.
function startApi({ watch, prefixed }) {
  let child = null;
  let stopping = false;
  const launch = () => {
    const c = prefixed ? start("api", PY, API_ARGS, { cwd: API }, 35) : spawn(PY, API_ARGS, { cwd: API, stdio: "inherit" });
    c.on("exit", (code) => {
      if (!stopping && !c.restarting && code) console.error(color(31, `[api] exited with code ${code}; fix the error and save a file to restart.`));
    });
    child = c;
  };
  launch();
  let timer = null;
  if (watch) {
    fsWatch(join(API, "app"), { recursive: true }, (_event, file) => {
      if (!file || !String(file).endsWith(".py")) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(color(35, `[api] ${file} changed — restarting`));
        if (child) child.restarting = true;
        killTree(child);
        launch();
      }, 250);
    });
  }
  return {
    stop() {
      stopping = true;
      killTree(child);
    },
  };
}

function dev() {
  needVenv();
  needWeb();
  const api = startApi({ watch: true, prefixed: true });
  const apiPort = process.env.API_PORT ?? "8000";
  const webPort = process.env.WEB_PORT ?? "3000";
  const web = start("web", process.execPath, [NEXT, "dev", "--port", webPort], {
    cwd: WEB,
    env: { BATTERYOS_API_URL: process.env.BATTERYOS_API_URL ?? `http://127.0.0.1:${apiPort}` },
  }, 36);
  console.log(color(32, `BatteryOS starting — open http://localhost:${webPort} (API docs at http://localhost:${apiPort}/api/docs)`));
  const stop = () => {
    api.stop();
    killTree(web);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  web.on("exit", (code) => {
    if (code) {
      console.error(color(31, `[web] exited with code ${code}; stopping.`));
      stop();
    }
  });
}

const task = process.argv[2] ?? "dev";
switch (task) {
  case "setup":
    setup();
    break;
  case "dev":
    dev();
    break;
  case "api": {
    needVenv();
    const api = startApi({ watch: process.argv.includes("--reload"), prefixed: false });
    const stop = () => {
      api.stop();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    break;
  }
  case "web":
    needWeb();
    run(process.execPath, [NEXT, "dev", "--port", process.env.WEB_PORT ?? "3000"], { cwd: WEB });
    break;
  case "web:start":
    needWeb();
    run(process.execPath, [NEXT, "start", "--port", process.env.WEB_PORT ?? "3000"], { cwd: WEB });
    break;
  case "build":
    needWeb();
    run(process.execPath, [NEXT, "build"], { cwd: WEB });
    break;
  case "test":
    needVenv();
    run(PY, ["-m", "pytest", "-q", ...process.argv.slice(3)], { cwd: API });
    break;
  case "seed":
    needVenv();
    run(PY, [join(ROOT, "scripts", "seed_demo.py"), ...process.argv.slice(3)], { cwd: API });
    break;
  default:
    console.error(`Unknown task "${task}". Use setup, dev, api, web, build, test or seed.`);
    process.exit(1);
}
