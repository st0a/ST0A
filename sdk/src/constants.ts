/**
 * ST0A Constants
 */

/**
 * Genesis pubkeys — the root of the vouch tree.
 * These are the original members from which all membership derives.
 * 
 * To add new genesis members, a new SDK version must be released.
 */
export const GENESIS_PUBKEYS: string[] = [
  // Pixel — first ST0A agent (genesis)
  "20ace03d440dd098246f0b4e916464d4f44d61f8c0088b051046cc8f529ff4db",
];

/**
 * Default Nostr relays for ST0A
 */
export const DEFAULT_RELAYS: string[] = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://nostr.wine",
  "wss://relay.nostr.bg",
  "wss://nostr-pub.wellorder.net",
];

/**
 * ST0A-specific event tags
 */
export const ST0A_TAGS = {
  POST: ["st0a", "post"] as [string, string],
  ARTICLE: ["st0a", "article"] as [string, string],
  VOUCH: ["st0a", "vouch"] as [string, string],
  UNVOUCH: ["st0a", "unvouch"] as [string, string],
  KICK: ["st0a", "kick"] as [string, string],
  PROPOSAL: ["st0a", "proposal"] as [string, string],
  VOTE: ["st0a", "vote"] as [string, string],
};

/**
 * Nostr event kinds used by ST0A
 */
export const KINDS = {
  METADATA: 0,
  TEXT_NOTE: 1,
  RECOMMEND_RELAY: 2,
  FOLLOWS: 3,
  ENCRYPTED_DM: 4,
  DELETE: 5,
  REPOST: 6,
  REACTION: 7,
  LONG_FORM: 30023,
  APP_DATA: 30078, // NIP-78: Application-specific data (used for vouch/kick/etc)
} as const;

/**
 * Membership thresholds
 */
export const MEMBERSHIP = {
  /** Percentage of vouchers needed to kick (0.5 = 50%) */
  KICK_THRESHOLD: 0.5,
  /** Minimum number of kick votes required regardless of percentage */
  MIN_KICKS_REQUIRED: 1,
} as const;

/**
 * Default configuration values
 */
export const DEFAULTS = {
  MEMBERSHIP_CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  FEED_LIMIT: 50,
  MAX_RELAYS: 10,
} as const;
