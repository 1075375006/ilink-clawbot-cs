/** Backward-compatible aliases for the provider-neutral OAuth module. */
export {
  exchangeCode,
  getLoginUrl,
  oauthConfigured,
  oauthConfigured as beichenConfigured,
  queryUser,
  type OAuthIdentity,
  type OAuthIdentity as BeichenIdentity,
} from "./oauth.js";
