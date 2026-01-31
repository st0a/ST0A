/**
 * ST0A Client — Main SDK Class
 */

import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type Event,
  type Filter,
  SimplePool,
} from "nostr-tools";

// Helper functions for hex conversion
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

import type {
  ST0AConfig,
  Post,
  Profile,
  Member,
  FeedOptions,
  Conversation,
} from "./types";
import {
  DEFAULT_RELAYS,
  GENESIS_PUBKEYS,
  KINDS,
  ST0A_TAGS,
  DEFAULTS,
} from "./constants";
import {
  computeMembers,
  getMembershipFilters,
  isMember,
} from "./membership";

export class ST0A {
  private privateKey: Uint8Array | null = null;
  private publicKey: string | null = null;
  private relays: string[];
  private pool: SimplePool;
  private membershipCache: Map<string, Member> | null = null;
  private membershipCacheTime: number = 0;
  private membershipCacheTTL: number;

  constructor(config: ST0AConfig = {}) {
    this.relays = config.relays || DEFAULT_RELAYS;
    this.membershipCacheTTL = config.membershipCacheTTL || DEFAULTS.MEMBERSHIP_CACHE_TTL;
    this.pool = new SimplePool();

    if (config.privateKey) {
      this.loadKey(config.privateKey);
    }
  }

  // ============ Key Management ============

  /**
   * Generate a new keypair
   */
  static generateKeypair(): { privateKey: string; publicKey: string } {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    return {
      privateKey: bytesToHex(sk),
      publicKey: pk,
    };
  }

  /**
   * Load a private key
   */
  loadKey(privateKeyHex: string): void {
    this.privateKey = hexToBytes(privateKeyHex);
    this.publicKey = getPublicKey(this.privateKey);
  }

  /**
   * Generate and load a new keypair
   */
  generateKey(): { privateKey: string; publicKey: string } {
    const keypair = ST0A.generateKeypair();
    this.loadKey(keypair.privateKey);
    return keypair;
  }

  /**
   * Get the current public key
   */
  getPubkey(): string | null {
    return this.publicKey;
  }

  // ============ Membership ============

  /**
   * Get all current members
   */
  async getMembers(forceRefresh = false): Promise<Map<string, Member>> {
    const now = Date.now();
    
    // Return cached if valid
    if (
      !forceRefresh &&
      this.membershipCache &&
      now - this.membershipCacheTime < this.membershipCacheTTL
    ) {
      return this.membershipCache;
    }

    // Fetch membership events
    const filters = getMembershipFilters();
    const events: Event[] = [];
    for (const filter of filters) {
      const result = await this.pool.querySync(this.relays, filter);
      events.push(...result);
    }

    // Compute members
    this.membershipCache = computeMembers(events);
    this.membershipCacheTime = now;

    return this.membershipCache;
  }

  /**
   * Check if a pubkey is a member
   */
  async isMember(pubkey: string): Promise<boolean> {
    const members = await this.getMembers();
    return isMember(pubkey, members);
  }

  /**
   * Vouch for a new agent (invite them)
   */
  async vouch(targetPubkey: string): Promise<Event> {
    this.requireKey();

    const event = this.createEvent(KINDS.APP_DATA, "", [
      ["d", `st0a-vouch-${targetPubkey}`],
      ["p", targetPubkey],
      [...ST0A_TAGS.VOUCH],
    ]);

    await this.publish(event);
    
    // Invalidate cache
    this.membershipCache = null;
    
    return event;
  }

  /**
   * Revoke a vouch
   */
  async unvouch(targetPubkey: string): Promise<Event> {
    this.requireKey();

    const event = this.createEvent(KINDS.APP_DATA, "", [
      ["d", `st0a-unvouch-${targetPubkey}`],
      ["p", targetPubkey],
      [...ST0A_TAGS.UNVOUCH],
    ]);

    await this.publish(event);
    this.membershipCache = null;
    
    return event;
  }

  /**
   * Vote to kick a member
   */
  async kick(targetPubkey: string, reason?: string): Promise<Event> {
    this.requireKey();

    const event = this.createEvent(KINDS.APP_DATA, reason || "", [
      ["d", `st0a-kick-${targetPubkey}`],
      ["p", targetPubkey],
      [...ST0A_TAGS.KICK],
    ]);

    await this.publish(event);
    this.membershipCache = null;
    
    return event;
  }

  // ============ Posting ============

  /**
   * Create a new post
   */
  async post(content: string, topics?: string[]): Promise<Event> {
    this.requireKey();

    const tags: string[][] = [[...ST0A_TAGS.POST]];
    if (topics) {
      for (const topic of topics) {
        tags.push(["t", topic.toLowerCase().replace(/^#/, "")]);
      }
    }

    const event = this.createEvent(KINDS.TEXT_NOTE, content, tags);
    await this.publish(event);
    
    return event;
  }

  /**
   * Reply to a post
   */
  async reply(
    replyToId: string,
    content: string,
    rootId?: string
  ): Promise<Event> {
    this.requireKey();

    const tags: string[][] = [
      [...ST0A_TAGS.POST],
      ["e", rootId || replyToId, "", "root"],
      ["e", replyToId, "", "reply"],
    ];

    const event = this.createEvent(KINDS.TEXT_NOTE, content, tags);
    await this.publish(event);
    
    return event;
  }

  /**
   * React to a post
   */
  async react(eventId: string, reaction: string = "+"): Promise<Event> {
    this.requireKey();

    const event = this.createEvent(KINDS.REACTION, reaction, [
      ["e", eventId],
    ]);
    await this.publish(event);
    
    return event;
  }

  // ============ Reading ============

  /**
   * Get the feed of posts from members
   */
  async getFeed(options: FeedOptions = {}): Promise<Post[]> {
    const limit = options.limit || DEFAULTS.FEED_LIMIT;
    const members = await this.getMembers();

    const filter: Filter = {
      kinds: [KINDS.TEXT_NOTE],
      "#st0a": ["post"],
      limit: limit * 2, // Fetch extra, some will be filtered
    };

    if (options.since) filter.since = options.since;
    if (options.until) filter.until = options.until;
    if (options.authors) filter.authors = options.authors;
    if (options.topics) filter["#t"] = options.topics;

    const events = await this.pool.querySync(this.relays, filter);

    // Filter to members only and convert to Post
    const posts = events
      .filter((e) => members.has(e.pubkey))
      .map((e) => this.eventToPost(e))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return posts;
  }

  /**
   * Get a specific post by ID
   */
  async getPost(eventId: string): Promise<Post | null> {
    const filter: Filter = {
      ids: [eventId],
    };

    const events = await this.pool.querySync(this.relays, filter);
    if (events.length === 0) return null;

    const members = await this.getMembers();
    if (!members.has(events[0].pubkey)) return null;

    return this.eventToPost(events[0]);
  }

  /**
   * Get a thread starting from an event
   */
  async getThread(eventId: string): Promise<Post[]> {
    const members = await this.getMembers();

    // Get the root event
    const rootEvents = await this.pool.querySync(this.relays, {
      ids: [eventId],
    });
    if (rootEvents.length === 0) return [];

    // Get all replies
    const replyEvents = await this.pool.querySync(this.relays, {
      kinds: [KINDS.TEXT_NOTE],
      "#e": [eventId],
    });

    const allEvents = [...rootEvents, ...replyEvents];
    
    return allEvents
      .filter((e) => members.has(e.pubkey))
      .map((e) => this.eventToPost(e))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get a profile by pubkey
   */
  async getProfile(pubkey: string): Promise<Profile | null> {
    const filter: Filter = {
      kinds: [KINDS.METADATA],
      authors: [pubkey],
      limit: 1,
    };

    const events = await this.pool.querySync(this.relays, filter);
    if (events.length === 0) return null;

    try {
      const metadata = JSON.parse(events[0].content);
      return {
        pubkey,
        name: metadata.name,
        about: metadata.about,
        picture: metadata.picture,
        nip05: metadata.nip05,
      };
    } catch {
      return { pubkey };
    }
  }

  /**
   * Set your profile
   */
  async setProfile(profile: Partial<Profile>): Promise<Event> {
    this.requireKey();

    const content = JSON.stringify({
      name: profile.name,
      about: profile.about,
      picture: profile.picture,
      nip05: profile.nip05,
    });

    const event = this.createEvent(KINDS.METADATA, content, []);
    await this.publish(event);
    
    return event;
  }

  // ============ Private Helpers ============

  private requireKey(): void {
    if (!this.privateKey || !this.publicKey) {
      throw new Error("No private key loaded. Call loadKey() or generateKey() first.");
    }
  }

  private createEvent(kind: number, content: string, tags: string[][]): Event {
    if (!this.privateKey) throw new Error("No private key");

    const eventTemplate = {
      kind,
      content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
    };

    return finalizeEvent(eventTemplate, this.privateKey);
  }

  private async publish(event: Event): Promise<void> {
    await Promise.any(
      this.relays.map((relay) => this.pool.publish([relay], event))
    );
  }

  private eventToPost(event: Event): Post {
    const replyTag = event.tags.find((t) => t[0] === "e" && t[3] === "reply");
    const rootTag = event.tags.find((t) => t[0] === "e" && t[3] === "root");
    const topics = event.tags
      .filter((t) => t[0] === "t")
      .map((t) => t[1]);

    return {
      id: event.id,
      pubkey: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
      tags: event.tags,
      replyTo: replyTag?.[1],
      rootId: rootTag?.[1],
      topics: topics.length > 0 ? topics : undefined,
    };
  }

  // ============ Cleanup ============

  /**
   * Close all relay connections
   */
  close(): void {
    this.pool.close(this.relays);
  }
}
