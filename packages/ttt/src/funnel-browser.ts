// Bundled to apps/web/public/tttfunnel.js (window.TTTFUN): the common engine's funnel reporter. First-party endpoint, no personal details, Global Privacy Control respected.
import { makeReporter } from "../../../vendor/game-core/packages/core/src/funnel";
(globalThis as any).TTTFUN = { makeReporter };
