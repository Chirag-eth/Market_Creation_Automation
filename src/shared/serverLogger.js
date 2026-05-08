import { pino } from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";

const LEVEL =
  String(process.env.LOG_LEVEL || "")
    .trim()
    .toLowerCase() || "info";
const APP_ENV = String(process.env.APP_ENV || "")
  .trim()
  .toLowerCase();
const IS_PROD = APP_ENV === "mainnet" || APP_ENV === "uat" || process.env.NODE_ENV === "production";
const PRETTY = !IS_PROD && process.stdout.isTTY;

const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["x-api-key"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.client_secret",
  "*.GOOGLE_CLIENT_SECRET",
  "*.AUTH_SESSION_SECRET",
];

const baseOptions = {
  level: LEVEL,
  base: {
    service: "fixture-ocr-market-builder",
    env: APP_ENV || "unknown",
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  formatters: {
    level: (label) => ({ level: label }),
  },
};

const transport = PRETTY
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname,service,env",
        singleLine: false,
      },
    })
  : undefined;

export const logger = transport ? pino(baseOptions, transport) : pino(baseOptions);

const QUIET_PATHS = new Set(["/api/healthz", "/api/readyz"]);

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = (typeof incoming === "string" && incoming.trim()) || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} ${err?.message || "error"}`,
  autoLogging: {
    ignore: (req) => {
      try {
        const pathname = new URL(req.url || "/", "http://localhost").pathname;
        return QUIET_PATHS.has(pathname);
      } catch {
        return false;
      }
    },
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

export function createScopedLogger(scope, bindings = {}) {
  return logger.child({ scope, ...bindings });
}
