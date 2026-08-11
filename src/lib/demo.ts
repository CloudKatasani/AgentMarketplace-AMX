/**
 * The demo viewer.
 *
 * A real account with the business-consumer role in the read-only showcase
 * tenant, rather than a special "anonymous" code path. Anything a visitor can
 * do, a member with that role can do — so the demo exercises the product's own
 * permissions instead of a bypass built for the demo.
 */
export const DEMO_VIEWER_EMAIL = "demo.viewer@amx.demo";
export const DEMO_VIEWER_PASSWORD = "amx-demo-2024";
