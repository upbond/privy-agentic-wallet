import { existsSync } from "fs";
import { resolve } from "path";

/**
 * Detect if we're on the delegated-signer branch (PR #7)
 * by checking for the existence of lib/delegated-tools.ts.
 */
export const IS_DELEGATED_BRANCH = existsSync(
  resolve(__dirname, "../../lib/delegated-tools.ts")
);
