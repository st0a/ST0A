/**
 * ST0A Membership — Vouch Graph Computation
 */

import type { Filter, Event } from "nostr-tools";
import { GENESIS_PUBKEYS, KINDS, ST0A_TAGS, MEMBERSHIP } from "./constants";
import type { VouchEvent, Member } from "./types";

/**
 * Parse a vouch/unvouch/kick event
 */
export function parseVouchEvent(event: Event): VouchEvent | null {
  const st0aTag = event.tags.find(
    (t) => t[0] === "st0a" && ["vouch", "unvouch", "kick"].includes(t[1])
  );
  if (!st0aTag) return null;

  const targetTag = event.tags.find((t) => t[0] === "p");
  if (!targetTag || !targetTag[1]) return null;

  return {
    id: event.id,
    voucher: event.pubkey,
    target: targetTag[1],
    createdAt: event.created_at,
    type: st0aTag[1] as "vouch" | "unvouch" | "kick",
    reason: event.content || undefined,
  };
}

/**
 * Build filters to fetch all membership-related events
 */
export function getMembershipFilters(): Filter[] {
  return [
    {
      kinds: [KINDS.APP_DATA],
      "#st0a": ["vouch", "unvouch", "kick"],
    },
  ];
}

/**
 * Compute the current set of valid members from vouch events
 */
export function computeMembers(events: Event[]): Map<string, Member> {
  // Parse all events
  const vouchEvents: VouchEvent[] = [];
  for (const event of events) {
    const parsed = parseVouchEvent(event);
    if (parsed) {
      vouchEvents.push(parsed);
    }
  }

  // Sort by timestamp (oldest first) for deterministic processing
  vouchEvents.sort((a, b) => a.createdAt - b.createdAt);

  // Separate by type
  const vouches = vouchEvents.filter((e) => e.type === "vouch");
  const unvouches = vouchEvents.filter((e) => e.type === "unvouch");
  const kicks = vouchEvents.filter((e) => e.type === "kick");

  // Build vouch map: target -> set of vouchers
  const vouchMap = new Map<string, Set<string>>();
  
  for (const v of vouches) {
    if (!vouchMap.has(v.target)) {
      vouchMap.set(v.target, new Set());
    }
    vouchMap.get(v.target)!.add(v.voucher);
  }

  // Apply unvouches
  for (const uv of unvouches) {
    const vouchers = vouchMap.get(uv.target);
    if (vouchers) {
      vouchers.delete(uv.voucher);
    }
  }

  // Build kick map: target -> set of kickers
  const kickMap = new Map<string, Set<string>>();
  for (const k of kicks) {
    if (!kickMap.has(k.target)) {
      kickMap.set(k.target, new Set());
    }
    kickMap.get(k.target)!.add(k.voucher);
  }

  // Initialize with genesis members
  const members = new Map<string, Member>();
  for (const pubkey of GENESIS_PUBKEYS) {
    members.set(pubkey, {
      pubkey,
      vouchedBy: ["genesis"],
      vouchedAt: 0,
    });
  }

  // Iteratively add members who are vouched by existing members
  let changed = true;
  while (changed) {
    changed = false;
    
    for (const [target, vouchers] of vouchMap.entries()) {
      // Skip if already a member
      if (members.has(target)) continue;

      // Check if any voucher is a valid member
      const validVouchers = Array.from(vouchers).filter((v) => members.has(v));
      if (validVouchers.length === 0) continue;

      // Check if kicked
      if (isKicked(target, validVouchers, kickMap)) continue;

      // Add as member
      const oldestVouch = vouches.find(
        (v) => v.target === target && validVouchers.includes(v.voucher)
      );
      
      members.set(target, {
        pubkey: target,
        vouchedBy: validVouchers,
        vouchedAt: oldestVouch?.createdAt || 0,
      });
      
      changed = true;
    }
  }

  // Remove kicked members (re-check with final member set)
  for (const [pubkey, member] of members.entries()) {
    if (pubkey === "genesis") continue;
    if (GENESIS_PUBKEYS.includes(pubkey)) continue;
    
    if (isKicked(pubkey, member.vouchedBy, kickMap)) {
      members.delete(pubkey);
    }
  }

  return members;
}

/**
 * Check if a pubkey has been kicked
 */
function isKicked(
  target: string,
  vouchers: string[],
  kickMap: Map<string, Set<string>>
): boolean {
  const kicks = kickMap.get(target);
  if (!kicks || kicks.size === 0) return false;

  // Count kicks from vouchers
  const kicksFromVouchers = vouchers.filter((v) => kicks.has(v)).length;
  
  // Check threshold
  if (kicksFromVouchers < MEMBERSHIP.MIN_KICKS_REQUIRED) return false;
  if (vouchers.length === 0) return false;
  
  const kickRatio = kicksFromVouchers / vouchers.length;
  return kickRatio > MEMBERSHIP.KICK_THRESHOLD;
}

/**
 * Check if a pubkey is a valid member
 */
export function isMember(pubkey: string, members: Map<string, Member>): boolean {
  return members.has(pubkey);
}
