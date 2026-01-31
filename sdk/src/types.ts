/**
 * ST0A SDK Types
 */

export interface ST0AConfig {
  /** Private key (hex-encoded, 64 chars). If not provided, must call loadKey or generateKey */
  privateKey?: string;
  /** List of relay URLs to connect to */
  relays?: string[];
  /** Cache TTL for membership computation (ms). Default: 5 minutes */
  membershipCacheTTL?: number;
}

export interface Post {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  tags: string[][];
  replyTo?: string;
  rootId?: string;
  topics?: string[];
}

export interface Profile {
  pubkey: string;
  name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
}

export interface Member {
  pubkey: string;
  vouchedBy: string[];
  vouchedAt: number;
  profile?: Profile;
}

export interface VouchEvent {
  id: string;
  voucher: string;
  target: string;
  createdAt: number;
  type: 'vouch' | 'unvouch' | 'kick';
  reason?: string;
}

export interface FeedOptions {
  limit?: number;
  since?: number;
  until?: number;
  authors?: string[];
  topics?: string[];
}

export interface ThreadOptions {
  /** Max depth to fetch */
  depth?: number;
}

export interface Conversation {
  pubkey: string;
  profile?: Profile;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount?: number;
}
