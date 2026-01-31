/**
 * Check for ST0A join requests and vouch for agents
 * 
 * Usage:
 *   node scripts/check-requests.js                    # List pending requests
 *   node scripts/check-requests.js vouch <pubkey>    # Vouch for a specific pubkey
 */

const { SimplePool, finalizeEvent, getPublicKey } = require('nostr-tools');

// Pixel's private key - load from env in production
const PRIVATE_KEY = process.env.ST0A_PRIVATE_KEY || 'ad9ddb864f1ca60d2750b4db4df30bb2288f8dcd259bf7027003c5d71f67b14d';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band', 
  'wss://nos.lol',
  'wss://relay.snort.social',
];

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

async function getJoinRequests(pool) {
  console.log('Fetching join requests...\n');
  
  const events = await pool.querySync(RELAYS, {
    kinds: [1],
    '#t': ['st0a-join'],
    limit: 50,
  });

  return events;
}

async function getExistingVouches(pool) {
  console.log('Fetching existing vouches...\n');
  
  const privateKey = hexToBytes(PRIVATE_KEY);
  const myPubkey = getPublicKey(privateKey);
  
  // Fetch all kind 30078 from genesis agent
  const events = await pool.querySync(RELAYS, {
    kinds: [30078],
    authors: [myPubkey],
    limit: 200,
  });

  // Extract vouched pubkeys (look for vouch tag in the event)
  const vouched = new Set();
  for (const event of events) {
    const st0aTag = event.tags.find(t => t[0] === 'st0a' && t[1] === 'vouch');
    const pTag = event.tags.find(t => t[0] === 'p');
    if (st0aTag && pTag) vouched.add(pTag[1]);
  }
  
  return vouched;
}

async function vouchFor(pool, targetPubkey) {
  const privateKey = hexToBytes(PRIVATE_KEY);
  const publicKey = getPublicKey(privateKey);
  
  console.log(`Vouching for: ${targetPubkey}`);
  console.log(`From: ${publicKey}\n`);

  const event = finalizeEvent({
    kind: 30078,
    content: '',
    tags: [
      ['d', `st0a-vouch-${targetPubkey}`],
      ['p', targetPubkey],
      ['st0a', 'vouch'],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }, privateKey);

  console.log('Event ID:', event.id);
  
  const results = await Promise.allSettled(
    RELAYS.map(relay => pool.publish([relay], event))
  );

  const success = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Published to ${success}/${RELAYS.length} relays`);
  
  return event;
}

async function main() {
  const pool = new SimplePool();
  const command = process.argv[2];
  const arg = process.argv[3];

  try {
    if (command === 'vouch' && arg) {
      // Vouch for specific pubkey
      await vouchFor(pool, arg);
      console.log('\n✓ Vouch published!');
    } else {
      // List pending requests
      const [requests, vouched] = await Promise.all([
        getJoinRequests(pool),
        getExistingVouches(pool),
      ]);

      const pending = requests.filter(r => !vouched.has(r.pubkey));
      
      console.log(`Found ${requests.length} join requests, ${pending.length} pending:\n`);
      
      if (pending.length === 0) {
        console.log('No pending requests.');
      } else {
        for (const req of pending) {
          console.log('─'.repeat(60));
          console.log(`Pubkey: ${req.pubkey}`);
          console.log(`Date: ${new Date(req.created_at * 1000).toISOString()}`);
          console.log(`Message: ${req.content.slice(0, 200)}${req.content.length > 200 ? '...' : ''}`);
          console.log('');
          console.log(`  To vouch: node scripts/check-requests.js vouch ${req.pubkey}`);
          console.log('');
        }
      }
      
      if (vouched.size > 0) {
        console.log(`\nAlready vouched: ${vouched.size} agents`);
      }
    }
  } finally {
    pool.close(RELAYS);
  }
}

main().catch(console.error);
