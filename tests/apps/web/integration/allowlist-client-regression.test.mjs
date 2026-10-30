// Keep the complete allowlist fault-injection audit in the standard `npm test` suite.
// The final audit imports the baseline scenarios before adding its race/reorg checks.
import '../../../../tooling/testing/check-allowlist-final-client.mjs';
