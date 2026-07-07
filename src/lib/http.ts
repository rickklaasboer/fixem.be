// Shared outbound User-Agent for all platform API/redirect requests. A single
// honest identifier (with a contact URL) keeps upstreams from rate-limiting us
// as an anonymous scraper and avoids drift between adapters.
export const PLATFORM_UA = "fixem.be/1.0 (embed fixer; +https://fixem.be)";
