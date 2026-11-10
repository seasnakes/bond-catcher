"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

const MODEL = process.env.CB_AI_MODEL || "gpt-6-astra";
const EFFORT = process.env.CB_AI_REASONING_EFFORT || "high";
const ENV_ALLOWLIST = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"];

async function executable(file) { try { await fs.access(file, 1); return true; } catch { return false; } }
async function findCodex() {
  const names = process.platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  const candidates = [process.env.CB_AI_CODEX_PATH,
    "/Applications/ChatGPT.app/Contents/Resources/codex", "/Applications/Codex.app/Contents/Resources/codex",
    ...String(process.env.PATH || "").split(path.delimiter).flatMap(dir => names.map(name => path.join(dir, name))),
  ].filter(Boolean);
  for (const file of candidates) if (await executable(file)) return file;
  return null;
}
function sourceHome() { return process.env.CODEX_HOME || path.join(os.homedir(), ".codex"); }
function processEnvironment(home) {
  const env = Object.fromEntries(ENV_ALLOWLIST.filter(k => process.env[k]).map(k => [k, process.env[k]]));
  env.CODEX_HOME = home;
  env.NO_COLOR = "1";
  env.NO_PROXY = env.no_proxy = [...new Set(`${process.env.NO_PROXY || process.env.no_proxy || ""},127.0.0.1,localhost,::1`.split(","))].filter(Boolean).join(",");
  return env;
}
let statusCache = null;
async function status() {
  if (statusCache && Date.now() - statusCache.at < 30_000) return statusCache.value;
  const binary = await findCodex();
  const result = { provider: "codex_cli", model: MODEL, reasoning_effort: EFFORT, available: Boolean(binary), configured: false, message: "未找到本机 Codex CLI" };
  if (binary) {
    try {
      const [version, login] = await Promise.all([
        exec(binary, ["--version"], { timeout: 8_000, maxBuffer: 64_000 }),
        exec(binary, ["login", "status"], { timeout: 8_000, maxBuffer: 64_000, env: processEnvironment(sourceHome()) }),
      ]);
      await fs.access(path.join(sourceHome(), "auth.json"));
      result.configured = /logged in/i.test(`${login.stdout}\n${login.stderr}`);
      result.version = version.stdout.trim().slice(0, 80);
      result.message = result.configured ? "复用本机 Codex 登录" : "请先在本机登录 Codex";
    } catch { result.message = "Codex 已安装，请检查本机登录状态"; }
  }
  statusCache = { at: Date.now(), value: result };
  return result;
}
function abortError(message = "已取消分析") { const error = new Error(message); error.name = "AbortError"; return error; }

async function generateText(prompt, { signal, timeoutMs = 600_000, binaryOverride, homeOverride } = {}) {
  if (signal?.aborted) throw abortError();
  const binary = binaryOverride || await findCodex();
  if (!binary) throw new Error("未找到本机 Codex CLI，请检查服务配置");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 180_000) throw new Error("分析上下文为空或过大");
  const run = await fs.mkdtemp(path.join(os.tmpdir(), "finance-cb-ai-"));
  let child;
  try {
    const home = path.join(run, "codex-home"), workspace = path.join(run, "workspace"), output = path.join(home, "last-message.txt");
    await fs.mkdir(home, { mode: 0o700 });
    await fs.mkdir(workspace);
    try { await fs.copyFile(path.join(homeOverride || sourceHome(), "auth.json"), path.join(home, "auth.json")); }
    catch { throw new Error("没有可复用的 Codex 登录，请先在本机登录"); }
    await fs.chmod(path.join(home, "auth.json"), 0o600);
    const config = [
      `model = ${JSON.stringify(MODEL)}`, `model_reasoning_effort = ${JSON.stringify(EFFORT)}`,
      'approval_policy = "never"', 'sandbox_mode = "read-only"', 'web_search = "disabled"',
      "[features]", "shell_tool = false", "apps = false", "browser_use = false", "browser_use_external = false", "computer_use = false",
      "skill_search = false", "skip_host_skill_discovery = true", "view_image = false", "goals = false", "sleep_tool = false",
    ].join("\n");
    await fs.writeFile(path.join(home, "config.toml"), `${config}\n`, { mode: 0o600 });
    if (signal?.aborted) throw abortError();
    const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", "--output-last-message", output,
      "--model", MODEL, "--cd", workspace, "-"];
    await new Promise((resolve, reject) => {
      child = spawn(binary, args, { cwd: workspace, env: processEnvironment(home), stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
      let timeout, killTimer, reason = null, settled = false;
      const kill = sig => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch { /* Process already ended. */ } };
      const stop = error => { if (reason) return; reason = error; kill("SIGTERM"); killTimer = setTimeout(() => kill("SIGKILL"), 1500); killTimer.unref(); };
      const onAbort = () => stop(abortError());
      const finish = error => {
        if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(killTimer); signal?.removeEventListener("abort", onAbort);
        if (reason || error) reject(reason || error); else resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timeout = setTimeout(() => stop(new Error("Codex 分析超过10分钟，请稍后重试或检查模型服务")), timeoutMs);
      // Drain logs without retaining or publishing paths, credentials, or internal execution text.
      child.stdout.on("data", () => {}); child.stderr.on("data", () => {});
      child.on("error", () => finish(new Error("Codex 进程启动失败")));
      child.on("close", code => finish(code === 0 ? null : new Error("Codex 未完成分析，请检查登录状态、模型权限或网络后重试")));
      child.stdin.on("error", () => {});
      child.stdin.end(prompt, "utf8");
      if (signal?.aborted) onAbort();
    });
    if (signal?.aborted) throw abortError();
    const content = (await fs.readFile(output, "utf8").catch(() => "")).trim();
    if (content.length < 80) throw new Error("Codex 未返回完整分析正文，请重试");
    if (content.length > 100_000) throw new Error("模型返回内容过长，请缩小关注范围重试");
    return { content, provider: "codex_cli", model: MODEL, reasoning_effort: EFFORT };
  } finally {
    await fs.rm(run, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}

module.exports = { status, generateText, findCodex, processEnvironment, MODEL, EFFORT };
