// API origin comes from VITE_API_URL at BUILD time (no trailing slash needed):
//   dev   → .env             (http://localhost:5000)
//   prod  → .env.production, or VITE_API_URL set in the build environment,
//           which takes precedence (e.g. https://api.<primary-domain> on AWS).
const API_ORIGIN = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const config = {
    //BASE_URL: "http://localhost:5000/api/",
    BASE_URL: `${API_ORIGIN}/api/`,
};

export default config;
