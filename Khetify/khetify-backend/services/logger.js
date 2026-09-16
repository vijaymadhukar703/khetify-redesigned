const pino = require("pino");

/**
 * Structured logger. Uses pino-pretty in development IF it's installed
 * (devDependency); otherwise falls back to plain JSON so the app never crashes
 * over a missing pretty-printer. Production always emits JSON.
 */
let options = {
  level: process.env.LOG_LEVEL || "info",
  // pino-http logs request headers; never ship bearer tokens, API keys, cookies
  // or webhook signatures to stdout / CloudWatch.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-key"]',
      'req.headers["x-razorpay-signature"]',
      'res.headers["set-cookie"]',
    ],
    censor: "[REDACTED]",
  },
};

if (process.env.NODE_ENV !== "production") {
  try {
    require.resolve("pino-pretty");
    options.transport = { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } };
  } catch {
    /* pino-pretty not installed — plain JSON logs are fine */
  }
}

module.exports = pino(options);
