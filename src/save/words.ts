/**
 * The studio-key wordlist: 256 short, plain software-engineering terms.
 *
 * Exactly 256 so that one word carries exactly 8 bits and the entropy of a key
 * is trivial to reason about: KEY_WORDS words = KEY_WORDS * 8 bits. The list is
 * asserted to be exactly 256 unique entries at module load, because a silent
 * duplicate would quietly bias key generation.
 *
 * Chosen for transcription, not flavour. A key gets written on paper and typed
 * on another machine, so the list avoids anything that survives a sloppy
 * copy badly:
 *
 *   - nothing over eight letters
 *   - no pair one edit apart (no TREE *and* TRIE, no SPAN *and* SPAWN, no
 *     LINKER *and* LINTER) — checked by the test suite, not by eye
 *   - no word that is a prefix of another (no HEAD *and* HEADER)
 *   - no abbreviations a player would have to guess the spelling of
 *
 * Deliberately absent: MASTER/SLAVE, and the process-lifecycle vocabulary
 * (KILL, ZOMBIE, ORPHAN, ABORT). All are real terms; four of them drawn at
 * random and hyphenated together read badly on a public leaderboard, and no
 * word here is load-bearing enough to be worth that.
 */
export const WORDS: readonly string[] = [
  // version control
  "COMMIT", "BRANCH", "MERGE", "REBASE", "CLONE", "FORK", "DIFF", "PATCH",
  "STASH", "TAG", "REMOTE", "ORIGIN", "UPSTREAM", "BLAME", "REVERT", "SQUASH",
  // build and release
  "BUILD", "COMPILE", "LINKER", "BUNDLE", "MINIFY", "DEPLOY", "RELEASE", "ROLLOUT",
  "ARTIFACT", "PIPELINE", "WORKFLOW", "STAGING", "CANARY", "ROLLBACK", "HOTFIX", "NIGHTLY",
  // testing
  "ASSERT", "MOCK", "STUB", "FIXTURE", "HARNESS", "COVERAGE", "FLAKY", "REGRESS",
  "SMOKE", "FUZZING", "BENCH", "SNAPSHOT", "SPY", "FAKE", "SUITE", "GOLDEN",
  // data structures
  "ARRAY", "VECTOR", "LIST", "STACK", "QUEUE", "MATRIX", "HEAP", "TREE",
  "GRAPH", "BITMAP", "TUPLE", "SET", "MAP", "HASH", "BUCKET", "NODE",
  // types and values
  "STRING", "INTEGER", "BOOLEAN", "FLOAT", "DOUBLE", "CHAR", "BYTE", "NULL",
  "VOID", "ENUM", "STRUCT", "UNION", "POINTER", "RECORD", "SYMBOL", "LITERAL",
  // language constructs
  "CLASS", "OBJECT", "METHOD", "LAMBDA", "CLOSURE", "SCOPE", "MODULE", "PACKAGE",
  "IMPORT", "EXPORT", "MACRO", "TRAIT", "MIXIN", "GENERIC", "ITERATOR", "VISITOR",
  // concurrency
  "THREAD", "ASYNC", "AWAIT", "PROMISE", "FUTURE", "MUTEX", "ATOMIC", "CHANNEL",
  "WORKER", "SPAWN", "YIELD", "BLOCKING", "PARALLEL", "LATENCY", "THROTTLE", "PREEMPT",
  // memory and runtime
  "BUFFER", "MEMORY", "CACHE", "REGISTER", "RUNTIME", "PROFILER", "ASSEMBLY", "OPCODE",
  "BINARY", "KERNEL", "PROCESS", "DAEMON", "SEGMENT", "PAGING", "GARBAGE", "LEAK",
  // networking
  "SOCKET", "PACKET", "ROUTER", "PROXY", "GATEWAY", "ENDPOINT", "REQUEST", "RESPONSE",
  "HEADER", "PAYLOAD", "COOKIE", "SESSION", "TIMEOUT", "RETRY", "POLLING", "WEBHOOK",
  // databases
  "SCHEMA", "TABLE", "COLUMN", "INDEX", "QUERY", "CURSOR", "MIGRATE", "SHARDING",
  "REPLICA", "BACKUP", "JOURNAL", "VACUUM", "PRIMARY", "FOREIGN", "TRIGGER", "RESTORE",
  // security
  "TOKEN", "CIPHER", "ENTROPY", "NONCE", "SALT", "DIGEST", "KEYPAIR", "VERIFY",
  "CAPTCHA", "FIREWALL", "SANDBOX", "AUDIT", "POLICY", "ROTATE", "REVOKE", "SECRET",
  // parsing and text
  "PARSER", "LEXER", "SYNTAX", "GRAMMAR", "REGEX", "PATTERN", "MATCHER", "ENCODE",
  "INDENT", "ESCAPE", "UNICODE", "NEWLINE", "PREFIX", "SUFFIX", "TRIM", "TEMPLATE",
  // architecture and patterns
  "ADAPTER", "FACADE", "FACTORY", "OBSERVER", "INJECTOR", "SERVICE", "HANDLER", "WRAPPER",
  "MEDIATOR", "PROVIDER", "RESOLVER", "BINDING", "CONTRACT", "PROTOCOL", "FALLBACK", "DELEGATE",
  // operations and observability
  "LOGGING", "METRIC", "TRACING", "ALERT", "UPTIME", "HEALTH", "PROBE", "RUNBOOK",
  "SAMPLE", "VERBOSE", "WARNING", "SEVERITY", "INCIDENT", "ONCALL", "BASELINE", "GAUGE",
  // algorithms
  "SORTING", "SEARCH", "RECURSE", "GREEDY", "DYNAMIC", "TRAVERSE", "PIVOT", "MEDIAN",
  "COMPLEX", "LINEAR", "OPTIMAL", "BISECT", "MEMOIZE", "INVERT", "PERMUTE", "SUBSET",
  // everyday project work
  "REFACTOR", "DEBUG", "LEGACY", "SCAFFOLD", "BACKLOG", "SPRINT", "REVIEW", "TICKET",
  "ISSUE", "README", "LICENSE", "VERSION", "SEMVER", "LOCKFILE", "VENDOR", "UPGRADE",
];

// A duplicate or a miscount would bias generation and silently cost entropy, so
// it is checked once at load rather than trusted.
if (WORDS.length !== 256 || new Set(WORDS).size !== 256) {
  throw new Error(
    `wordlist must be 256 unique words, got ${WORDS.length} (${new Set(WORDS).size} unique)`,
  );
}
