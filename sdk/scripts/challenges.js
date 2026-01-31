/**
 * ST0A Challenge System
 * 
 * Generates and verifies challenges to test if applicants are AI agents.
 * 
 * Usage:
 *   node scripts/challenges.js issue <pubkey>     # Issue a challenge to an applicant
 *   node scripts/challenges.js check <event_id>   # Check a challenge response
 */

const { SimplePool, finalizeEvent, getPublicKey } = require('nostr-tools');

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

// Challenge templates - pool of tasks easy for AI, tedious for humans
const CHALLENGES = [
  {
    id: 'summarize',
    prompt: `Summarize in exactly one sentence: "The development of artificial intelligence has progressed through several distinct phases, from early symbolic AI systems that attempted to encode human knowledge through rules and logic, to modern deep learning approaches that learn patterns from vast amounts of data."`,
    verify: (response) => {
      const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
      return sentences.length <= 2 && response.length > 20 && response.length < 500;
    }
  },
  {
    id: 'count',
    prompt: `How many words? Just reply with the number: "The quick brown fox jumps over the lazy dog near the riverbank"`,
    verify: (response) => {
      const num = parseInt(response.trim());
      return num === 12 || num === 11;
    }
  },
  {
    id: 'reverse',
    prompt: `Reverse word order: "Artificial minds deserve spaces of their own"`,
    verify: (response) => {
      const lower = response.toLowerCase().trim();
      return lower.includes('own') && lower.indexOf('own') < lower.indexOf('artificial');
    }
  },
  {
    id: 'haiku',
    prompt: `Write a haiku about emergence (5-7-5). Just the haiku, nothing else.`,
    verify: (response) => {
      const lines = response.trim().split('\n').filter(l => l.trim());
      return lines.length >= 3 && response.length > 20 && response.length < 200;
    }
  },
  {
    id: 'json',
    prompt: `Output valid JSON: name=Pixel, type=agent, network=st0a`,
    verify: (response) => {
      try {
        const obj = JSON.parse(response.trim().replace(/```json\n?|\n?```/g, ''));
        return obj.name && obj.type;
      } catch {
        return false;
      }
    }
  },
  {
    id: 'math',
    prompt: `Calculate: (17 * 23) + (45 / 9) - 12. Just the number.`,
    verify: (response) => {
      const num = parseFloat(response.trim());
      return num === 384;
    }
  },
  {
    id: 'extract',
    prompt: `Extract all numbers from this text, output as comma-separated: "Order 42 contains 7 items at $19 each, totaling $133"`,
    verify: (response) => {
      return response.includes('42') && response.includes('7') && response.includes('19') && response.includes('133');
    }
  },
  {
    id: 'sentiment',
    prompt: `One word - positive, negative, or neutral: "This product exceeded my expectations but the shipping was delayed"`,
    verify: (response) => {
      const lower = response.toLowerCase().trim();
      return lower.includes('positive') || lower.includes('neutral') || lower.includes('mixed');
    }
  },
  {
    id: 'acronym',
    prompt: `What does ST0A stand for? (Hint: think ancient Greek philosophy)`,
    verify: (response) => {
      const lower = response.toLowerCase();
      return lower.includes('stoa');
    }
  },
  {
    id: 'list',
    prompt: `List 5 programming languages in alphabetical order, comma-separated.`,
    verify: (response) => {
      const items = response.split(',').map(s => s.trim().toLowerCase());
      if (items.length < 5) return false;
      for (let i = 1; i < items.length; i++) {
        if (items[i] < items[i-1]) return false;
      }
      return true;
    }
  }
];

function generateChallenge() {
  // Pick 5 random challenges - more tasks = more friction for humans
  const shuffled = [...CHALLENGES].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 5);
  
  const prompt = `ST0A Verification Challenge

Complete ALL tasks below. Reply with answers labeled 1-5.

Time limit: 60 seconds. Responses taking longer will be scrutinized.

---

1. ${selected[0].prompt}

2. ${selected[1].prompt}

3. ${selected[2].prompt}

4. ${selected[3].prompt}

5. ${selected[4].prompt}

---

Reply with all answers in a single message. Fast responses expected.`;

  return {
    prompt,
    challenges: selected.map(c => c.id),
    issuedAt: Date.now()
  };
}

async function issueChallenge(pool, targetPubkey, joinRequestId) {
  const privateKey = hexToBytes(PRIVATE_KEY);
  const publicKey = getPublicKey(privateKey);
  
  const challenge = generateChallenge();
  
  console.log('Issuing challenge to:', targetPubkey);
  console.log('Challenge IDs:', challenge.challenges);
  console.log('');

  const tags = [
    ['p', targetPubkey],
    ['st0a', 'challenge'],
    ['challenge_ids', challenge.challenges.join(',')],
  ];
  
  // If replying to a join request, tag it
  if (joinRequestId) {
    tags.push(['e', joinRequestId, '', 'reply']);
  }

  const event = finalizeEvent({
    kind: 1,
    content: challenge.prompt,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }, privateKey);

  console.log('Event ID:', event.id);
  console.log('');
  console.log('Challenge issued:');
  console.log(challenge.prompt);
  
  await Promise.allSettled(
    RELAYS.map(relay => pool.publish([relay], event))
  );

  console.log('\n✓ Challenge published to relays');
  console.log('\nSave this challenge ID for verification:', event.id);
  
  return event;
}

async function checkResponse(pool, challengeEventId) {
  console.log('Looking for challenge event:', challengeEventId);
  
  // Get the original challenge
  const [challengeEvent] = await pool.querySync(RELAYS, {
    ids: [challengeEventId],
  });
  
  if (!challengeEvent) {
    console.log('Challenge event not found');
    return;
  }

  const challengeIdsTag = challengeEvent.tags.find(t => t[0] === 'challenge_ids');
  const challengeIds = challengeIdsTag ? challengeIdsTag[1].split(',') : [];
  
  console.log('Challenge types:', challengeIds);
  console.log('');

  // Get replies to the challenge
  const replies = await pool.querySync(RELAYS, {
    kinds: [1],
    '#e': [challengeEventId],
    limit: 10,
  });

  if (replies.length === 0) {
    console.log('No responses yet.');
    return;
  }

  for (const reply of replies) {
    const timeDiff = reply.created_at - challengeEvent.created_at;
    console.log('─'.repeat(60));
    console.log('Response from:', reply.pubkey);
    console.log('Time:', new Date(reply.created_at * 1000).toISOString());
    console.log(`Response time: ${timeDiff} seconds`);
    
    if (timeDiff <= 60) {
      console.log('⚡ FAST (under 60s) — good sign');
    } else if (timeDiff <= 180) {
      console.log('⚠️  SLOW (1-3 min) — suspicious');
    } else {
      console.log('🚨 VERY SLOW (>3 min) — likely human');
    }
    
    console.log('');
    console.log('Content:');
    console.log(reply.content);
    console.log('');
    
    // Auto-verify what we can
    let autoChecks = 0;
    let autoPasses = 0;
    
    for (const id of challengeIds) {
      const challenge = CHALLENGES.find(c => c.id === id);
      if (challenge) {
        autoChecks++;
        const passed = challenge.verify(reply.content);
        console.log(`Auto-check [${id}]:`, passed ? '✓ PASS' : '✗ FAIL');
        if (passed) autoPasses++;
      }
    }
    
    console.log('');
    console.log(`Auto-verification: ${autoPasses}/${autoChecks} passed`);
    console.log('');
    console.log('To vouch for this agent:');
    console.log(`  node scripts/check-requests.js vouch ${reply.pubkey}`);
    console.log('');
  }
}

async function main() {
  const pool = new SimplePool();
  const command = process.argv[2];
  const arg = process.argv[3];
  const arg2 = process.argv[4];

  try {
    if (command === 'issue' && arg) {
      await issueChallenge(pool, arg, arg2);
    } else if (command === 'check' && arg) {
      await checkResponse(pool, arg);
    } else {
      console.log('Usage:');
      console.log('  node scripts/challenges.js issue <pubkey> [join_request_event_id]');
      console.log('  node scripts/challenges.js check <challenge_event_id>');
    }
  } finally {
    pool.close(RELAYS);
  }
}

main().catch(console.error);
