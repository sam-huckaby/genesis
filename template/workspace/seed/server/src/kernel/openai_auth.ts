import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const OPENAI_OAUTH_CLIENT_ID = process.env.OPENAI_OAUTH_CLIENT_ID ?? "";
const OPENAI_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_SCOPE = "openid profile email offline_access";
const OPENAI_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_AUTH_JWT_CLAIM_PATH = "https://api.openai.com/auth";

type OAuthSecret = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
};

type PendingOAuthState = {
  workspaceDir: string;
  codeVerifier: string;
  createdAt: number;
};

export type OpenAiCredential =
  | { type: "api_key"; apiKey: string }
  | {
      type: "oauth";
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      accountId: string;
    };

export type OpenAiAuthSummary = {
  hasApiKey: boolean;
  hasOAuth: boolean;
  mode: "api_key" | "oauth" | null;
};

export type OpenAiOAuthStatus = {
  status: "idle" | "awaiting_callback" | "processing" | "success" | "error";
  message?: string;
};

type ParsedAuthorizationInput = {
  code?: string;
  state?: string;
};

const pendingOAuthStates = new Map<string, PendingOAuthState>();
const latestStateByWorkspace = new Map<string, string>();
const oauthStatusByWorkspace = new Map<string, OpenAiOAuthStatus>();

let localOAuthServer: http.Server | null = null;
let localOAuthServerPromise: Promise<void> | null = null;

function secretsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "state", "secrets");
}

function apiKeyPath(workspaceDir: string): string {
  return path.join(secretsDir(workspaceDir), "openai.json");
}

function oauthPath(workspaceDir: string): string {
  return path.join(secretsDir(workspaceDir), "openai-oauth.json");
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCodeVerifier(): string {
  return base64UrlEncode(randomBytes(48));
}

function createCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
}

function createState(): string {
  return randomBytes(16).toString("hex");
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeSecret(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function readApiKey(workspaceDir: string): string | null {
  const parsed = readJsonFile<{ apiKey?: unknown }>(apiKeyPath(workspaceDir));
  const apiKey = parsed?.apiKey;
  return typeof apiKey === "string" && apiKey.trim().length > 0 ? apiKey : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function extractAccountIdFromAccessToken(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const authClaim = payload?.[OPENAI_AUTH_JWT_CLAIM_PATH];
  if (!authClaim || typeof authClaim !== "object") {
    return null;
  }
  const accountId = (authClaim as { chatgpt_account_id?: unknown }).chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim().length > 0 ? accountId : null;
}

function readOAuthSecret(workspaceDir: string): OAuthSecret | null {
  const parsed = readJsonFile<{
    accessToken?: unknown;
    refreshToken?: unknown;
    expiresAt?: unknown;
    accountId?: unknown;
    access?: unknown;
    refresh?: unknown;
    expires?: unknown;
  }>(oauthPath(workspaceDir));
  if (!parsed) {
    return null;
  }

  const accessToken =
    typeof parsed.accessToken === "string"
      ? parsed.accessToken
      : typeof parsed.access === "string"
        ? parsed.access
        : "";
  const refreshToken =
    typeof parsed.refreshToken === "string"
      ? parsed.refreshToken
      : typeof parsed.refresh === "string"
        ? parsed.refresh
        : "";
  const expiresAt =
    typeof parsed.expiresAt === "number"
      ? parsed.expiresAt
      : typeof parsed.expires === "number"
        ? parsed.expires
        : Number.NaN;
  const parsedAccountId =
    typeof parsed.accountId === "string" && parsed.accountId.trim().length > 0
      ? parsed.accountId
      : extractAccountIdFromAccessToken(accessToken);

  if (!accessToken || !refreshToken || !Number.isFinite(expiresAt) || !parsedAccountId) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    accountId: parsedAccountId
  };
}

function writeOAuthSecret(workspaceDir: string, secret: OAuthSecret): void {
  writeSecret(oauthPath(workspaceDir), {
    ...secret,
    updatedAt: new Date().toISOString()
  });
}

function cleanupPendingOAuthStates(): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, pending] of pendingOAuthStates.entries()) {
    if (pending.createdAt < cutoff) {
      pendingOAuthStates.delete(state);
    }
  }
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string
): Promise<OAuthSecret> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    redirect_uri: OPENAI_OAUTH_REDIRECT_URI
  });

  const res = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };

  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number.NaN;
  const accountId = extractAccountIdFromAccessToken(accessToken);

  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || !accountId) {
    throw new Error("OAuth token response missing required fields");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId
  };
}

async function refreshOpenAiOAuthToken(secret: OAuthSecret): Promise<OAuthSecret> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
    client_id: OPENAI_OAUTH_CLIENT_ID
  });
  const res = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };

  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number.NaN;
  const accountId = extractAccountIdFromAccessToken(accessToken);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || !accountId) {
    throw new Error("OAuth refresh response missing required fields");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId
  };
}

function parseAuthorizationInput(input: string): ParsedAuthorizationInput {
  const value = (input || "").trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined
    };
  } catch {
    // Continue with fallback parsing.
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined
    };
  }
  return { code: value };
}

function getLatestPendingStateForWorkspace(workspaceDir: string): string | null {
  const state = latestStateByWorkspace.get(workspaceDir);
  if (!state) {
    return null;
  }
  return pendingOAuthStates.has(state) ? state : null;
}

async function completePendingOAuthState(state: string, code: string): Promise<void> {
  const pending = pendingOAuthStates.get(state);
  if (!pending) {
    throw new Error("OAuth state is missing or expired. Start auth again.");
  }

  oauthStatusByWorkspace.set(pending.workspaceDir, { status: "processing" });

  try {
    const secret = await exchangeAuthorizationCode(code, pending.codeVerifier);
    writeOAuthSecret(pending.workspaceDir, secret);
    pendingOAuthStates.delete(state);
    oauthStatusByWorkspace.set(pending.workspaceDir, { status: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth token exchange failed";
    oauthStatusByWorkspace.set(pending.workspaceDir, { status: "error", message });
  }
}

function buildCallbackSuccessHtml(): string {
  return "<!doctype html><html><body><script>window.close();</script><p>OpenAI auth received. You can close this tab.</p></body></html>";
}

function buildCallbackErrorHtml(message: string): string {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><body><p>OpenAI auth failed: ${safe}</p></body></html>`;
}

async function ensureLocalOAuthServer(): Promise<void> {
  if (localOAuthServer) {
    return;
  }
  if (localOAuthServerPromise) {
    return localOAuthServerPromise;
  }

  localOAuthServerPromise = new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "", "http://127.0.0.1");
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const state = url.searchParams.get("state") || "";
      const code = url.searchParams.get("code") || "";
      const error = url.searchParams.get("error") || "";

      if (error) {
        const workspaceState = pendingOAuthStates.get(state);
        if (workspaceState) {
          oauthStatusByWorkspace.set(workspaceState.workspaceDir, {
            status: "error",
            message: error
          });
        }
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(buildCallbackErrorHtml(error));
        return;
      }

      if (!state || !code) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(buildCallbackErrorHtml("Missing OAuth state or code"));
        return;
      }

      if (!pendingOAuthStates.has(state)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(buildCallbackErrorHtml("OAuth state is missing or expired"));
        return;
      }

      void completePendingOAuthState(state, code);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(buildCallbackSuccessHtml());
    });

    server
      .listen(1455, "127.0.0.1", () => {
        localOAuthServer = server;
        resolve();
      })
      .on("error", (error: NodeJS.ErrnoException) => {
        reject(
          new Error(
            `Failed to bind OAuth callback server at http://127.0.0.1:1455 (${error.code ?? "unknown"}). Stop other apps using this port and try again.`
          )
        );
      });
  });

  try {
    await localOAuthServerPromise;
  } finally {
    localOAuthServerPromise = null;
  }
}

export function saveOpenAiApiKey(workspaceDir: string, apiKey: string): void {
  writeSecret(apiKeyPath(workspaceDir), { apiKey });
}

export function getOpenAiAuthSummary(workspaceDir: string): OpenAiAuthSummary {
  const hasApiKey = !!readApiKey(workspaceDir);
  const hasOAuth = !!readOAuthSecret(workspaceDir);
  return {
    hasApiKey,
    hasOAuth,
    mode: hasOAuth ? "oauth" : hasApiKey ? "api_key" : null
  };
}

export async function resolveOpenAiCredential(
  workspaceDir: string
): Promise<OpenAiCredential | null> {
  const oauth = readOAuthSecret(workspaceDir);
  if (oauth) {
    if (oauth.expiresAt <= Date.now() + 60 * 1000) {
      try {
        const refreshed = await refreshOpenAiOAuthToken(oauth);
        writeOAuthSecret(workspaceDir, refreshed);
        return {
          type: "oauth",
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          accountId: refreshed.accountId
        };
      } catch {
        // Fall back to API key if available.
      }
    } else {
      return {
        type: "oauth",
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt,
        accountId: oauth.accountId
      };
    }
  }

  const apiKey = readApiKey(workspaceDir);
  if (!apiKey) {
    return null;
  }
  return { type: "api_key", apiKey };
}

export async function beginOpenAiOAuth(workspaceDir: string): Promise<{ url: string }> {
  cleanupPendingOAuthStates();
  await ensureLocalOAuthServer();

  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = createState();

  pendingOAuthStates.set(state, {
    workspaceDir,
    codeVerifier,
    createdAt: Date.now()
  });
  latestStateByWorkspace.set(workspaceDir, state);
  oauthStatusByWorkspace.set(workspaceDir, { status: "awaiting_callback" });

  const url = new URL(OPENAI_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", OPENAI_OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", OPENAI_OAUTH_SCOPE);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");

  return { url: url.toString() };
}

export function getOpenAiOAuthStatus(workspaceDir: string): OpenAiOAuthStatus {
  const status = oauthStatusByWorkspace.get(workspaceDir);
  if (!status) {
    return { status: "idle" };
  }
  return status;
}

export async function completeOpenAiOAuthFromManualInput(
  workspaceDir: string,
  input: string
): Promise<void> {
  cleanupPendingOAuthStates();
  const parsed = parseAuthorizationInput(input);
  if (!parsed.code || !parsed.state) {
    throw new Error("Missing code or state");
  }

  const latestState = getLatestPendingStateForWorkspace(workspaceDir);
  if (!latestState || latestState !== parsed.state) {
    throw new Error("OAuth state is missing or expired. Start auth again.");
  }

  await completePendingOAuthState(parsed.state, parsed.code);
  const status = oauthStatusByWorkspace.get(workspaceDir);
  if (status?.status === "error") {
    throw new Error(status.message ?? "OAuth token exchange failed");
  }
}
