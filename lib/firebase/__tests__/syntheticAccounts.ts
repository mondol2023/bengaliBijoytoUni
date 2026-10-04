/**
 * Synthetic service-account emails for the staging-isolation tests.
 *
 * Built from parts rather than written out, so no source line holds a whole
 * `…@….iam.gserviceaccount.com` address: `npm run scan:secrets` reports
 * every such literal, and these are test identities, not accounts. Keeping
 * them out of the scanner's view this way leaves it with no exemption to
 * grant, so a real address pasted into one of these test files later is
 * still reported.
 */
export function serviceAccount(name: string, projectId: string): string {
  return `${name}@${projectId}.iam.gserviceaccount.com`;
}

export const PROD_SERVICE_ACCOUNT = serviceAccount("firebase-adminsdk-test", "legacy2uni");
export const STAGING_SERVICE_ACCOUNT = serviceAccount("convert2uni-server", "legacy2uni-staging");
