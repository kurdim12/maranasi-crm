// Showcase dataset: fills every screen of the CRM with realistic-looking
// leads, mail threads and activity. All demo rows are keyed — source='demo'
// (leads), trigger='demo' (scrape runs), joined-through-demo-leads (mail,
// activities, suppression) — so removal deletes exactly the seeded rows.
// Demo leads can never be emailed: the sequence engine excludes
// source='demo' from eligibility, the manual send endpoint rejects demo
// leads, addresses use the reserved .example.com domain, and stored demo
// mail is dry_run=1 with no Gmail ids (so real-send threading never matches).

interface DemoLead {
  key: string;
  company: string;
  contact: string | null;
  email: string | null;
  emailStatus: 'unverified' | 'verified' | 'invalid';
  phone: string | null;
  phoneStatus: 'unknown' | 'valid_format' | 'reached' | 'unresponsive';
  category: string;
  city: string;
  country: 'VN' | 'TH';
  status: string;
  step: number;
  needsCall: 0 | 1;
  confirmed: 0 | 1;
  nextActionDays: number | null; // relative to now; null = no scheduled action
  lastContactedDays: number | null; // days ago
  createdDays: number; // days ago
  dropReason: string | null;
  notes: string | null;
}

const LEADS: DemoLead[] = [
  {
    key: 'rex', company: 'Rex Saigon Events', contact: 'Nguyen Thi Mai', email: 'hello@rex-events.example.com',
    emailStatus: 'verified', phone: '+84 28 3829 2185', phoneStatus: 'valid_format', category: 'event agency',
    city: 'Ho Chi Minh City', country: 'VN', status: 'contacted', step: 2, needsCall: 0, confirmed: 1,
    nextActionDays: 3, lastContactedDays: 11, createdDays: 24, dropReason: null,
    notes: 'Runs corporate galas for banking clients. Big activation budgets Q4.',
  },
  {
    key: 'lotus', company: 'Lotus Grand Ballroom', contact: 'Tran Van Duc', email: 'events@lotusgrand.example.com',
    emailStatus: 'verified', phone: '+84 24 3936 3333', phoneStatus: 'valid_format', category: 'venue',
    city: 'Hanoi', country: 'VN', status: 'interested', step: 2, needsCall: 0, confirmed: 1,
    nextActionDays: null, lastContactedDays: 8, createdDays: 22, dropReason: null,
    notes: 'Replied asking for our activation portfolio — send deck before the intro call.',
  },
  {
    key: 'mekong', company: 'Mekong Exhibition Co', contact: 'Le Hoang Long', email: 'info@mekongexpo.example.com',
    emailStatus: 'verified', phone: '+84 292 3838 999', phoneStatus: 'valid_format', category: 'exhibition organizer',
    city: 'Can Tho', country: 'VN', status: 'contacted', step: 1, needsCall: 0, confirmed: 1,
    nextActionDays: 1, lastContactedDays: 2, createdDays: 9, dropReason: null, notes: null,
  },
  {
    key: 'hanoifairs', company: 'Hanoi Trade Fairs JSC', contact: null, email: 'contact@hanoitradefairs.example.com',
    emailStatus: 'verified', phone: '+84 24 3825 5546', phoneStatus: 'valid_format', category: 'exhibition organizer',
    city: 'Hanoi', country: 'VN', status: 'unresponsive_email', step: 3, needsCall: 1, confirmed: 1,
    nextActionDays: null, lastContactedDays: 6, createdDays: 26, dropReason: null,
    notes: 'Full sequence sent, no reply — call them (organizes VIETBUILD side events).',
  },
  {
    key: 'skyline', company: 'Saigon Skyline Rooftop', contact: 'Pham Quynh Anh', email: 'book@saigonskyline.example.com',
    emailStatus: 'verified', phone: '+84 28 3910 7799', phoneStatus: 'valid_format', category: 'venue',
    city: 'Ho Chi Minh City', country: 'VN', status: 'verified', step: 0, needsCall: 0, confirmed: 1,
    nextActionDays: 1, lastContactedDays: null, createdDays: 3, dropReason: null, notes: null,
  },
  {
    key: 'danang', company: 'Da Nang Beach Festivals', contact: null, email: 'team@danangfest.example.com',
    emailStatus: 'unverified', phone: null, phoneStatus: 'unknown', category: 'event agency',
    city: 'Da Nang', country: 'VN', status: 'enriched', step: 0, needsCall: 0, confirmed: 0,
    nextActionDays: null, lastContactedDays: null, createdDays: 2, dropReason: null, notes: null,
  },
  {
    key: 'pearl', company: 'Pearl River Weddings', contact: 'Vo Minh Chau', email: 'hello@pearlriverweddings.example.com',
    emailStatus: 'verified', phone: '+84 28 3844 1234', phoneStatus: 'unresponsive', category: 'wedding planner',
    city: 'Ho Chi Minh City', country: 'VN', status: 'dropped', step: 3, needsCall: 0, confirmed: 1,
    nextActionDays: null, lastContactedDays: 16, createdDays: 30,
    dropReason: 'No reply to 3 emails and unreachable by phone (owner logged the call).',
    notes: null,
  },
  {
    key: 'bkkhub', company: 'Bangkok Convention Hub', contact: 'Somsak Charoen', email: 'sales@bkkconventionhub.example.com',
    emailStatus: 'verified', phone: '+66 2 203 4000', phoneStatus: 'valid_format', category: 'venue',
    city: 'Bangkok', country: 'TH', status: 'interested', step: 1, needsCall: 1, confirmed: 1,
    nextActionDays: null, lastContactedDays: 5, createdDays: 12, dropReason: null,
    notes: 'Hot: asked for a call this week about a joint activation package.',
  },
  {
    key: 'cmexpo', company: 'Chiang Mai Expo Center', contact: 'Pimchanok S.', email: 'info@cmexpo.example.com',
    emailStatus: 'verified', phone: '+66 53 248 604', phoneStatus: 'valid_format', category: 'exhibition organizer',
    city: 'Chiang Mai', country: 'TH', status: 'contacted', step: 1, needsCall: 0, confirmed: 1,
    nextActionDays: 2, lastContactedDays: 4, createdDays: 10, dropReason: null, notes: null,
  },
  {
    key: 'siam', company: 'Siam Event Studio', contact: 'Anucha W.', email: 'studio@siamevent.example.com',
    emailStatus: 'verified', phone: '+66 2 655 8899', phoneStatus: 'valid_format', category: 'event agency',
    city: 'Bangkok', country: 'TH', status: 'not_interested', step: 1, needsCall: 0, confirmed: 1,
    nextActionDays: null, lastContactedDays: 12, createdDays: 18, dropReason: null,
    notes: 'Polite pass — they produce in-house. Revisit next year.',
  },
  {
    key: 'phuket', company: 'Phuket Marina Weddings', contact: null, email: 'weddings@phuketmarina.example.com',
    emailStatus: 'verified', phone: '+66 76 360 811', phoneStatus: 'valid_format', category: 'wedding planner',
    city: 'Phuket', country: 'TH', status: 'opted_out', step: 1, needsCall: 0, confirmed: 1,
    nextActionDays: null, lastContactedDays: 10, createdDays: 17, dropReason: null, notes: null,
  },
  {
    key: 'orchid', company: 'Royal Orchid Hotel Events', contact: 'Kanya Ratanaporn', email: 'events@royalorchid.example.com',
    emailStatus: 'verified', phone: '+66 2 266 0123', phoneStatus: 'valid_format', category: 'venue',
    city: 'Bangkok', country: 'TH', status: 'verified', step: 0, needsCall: 0, confirmed: 1,
    nextActionDays: 2, lastContactedDays: null, createdDays: 4, dropReason: null, notes: null,
  },
  {
    key: 'thaifest', company: 'Thai Fest Productions', contact: null, email: null,
    emailStatus: 'unverified', phone: '+66 2 934 5511', phoneStatus: 'valid_format', category: 'event agency',
    city: 'Bangkok', country: 'TH', status: 'new', step: 0, needsCall: 0, confirmed: 0,
    nextActionDays: null, lastContactedDays: null, createdDays: 1, dropReason: null, notes: null,
  },
  {
    key: 'ayutthaya', company: 'Ayutthaya Heritage Tours', contact: null, email: 'tours@ayutthayaheritage.example.com',
    emailStatus: 'invalid', phone: null, phoneStatus: 'unknown', category: 'event agency',
    city: 'Ayutthaya', country: 'TH', status: 'invalid_email', step: 0, needsCall: 0, confirmed: 0,
    nextActionDays: null, lastContactedDays: null, createdDays: 5, dropReason: null,
    notes: 'Mailbox does not exist — find another contact or drop after review.',
  },
];

interface DemoEmail {
  leadKey: string;
  direction: 'in' | 'out';
  step: number | null;
  subject: string;
  body: string;
  classification: string | null;
  daysAgo: number;
}

const SIG = '\n\nBest regards,\nRami\nMaranasi Events — brand activations & corporate events\nIf you would rather not hear from us, just reply "unsubscribe".';

const EMAILS: DemoEmail[] = [
  // Rex Saigon — steps 1 & 2 out
  { leadKey: 'rex', direction: 'out', step: 1, subject: 'Brand activations in Ho Chi Minh City — quick question', classification: null, daysAgo: 18,
    body: 'Hi Mai,\n\nWe work with venues and agencies across Vietnam on brand activations and corporate events, and Ho Chi Minh City is a priority market for us this year.\n\nWould Rex Saigon Events be open to partnering on activation projects where you need extra production capacity?' + SIG },
  { leadKey: 'rex', direction: 'out', step: 2, subject: 'Re: Brand activations in Ho Chi Minh City — quick question', classification: null, daysAgo: 11,
    body: 'Hi Mai,\n\nFollowing up on my note last week. If partnerships are not your area, could you point me to the right person at Rex Saigon Events?' + SIG },
  // Lotus Grand — 2 out + interested reply in
  { leadKey: 'lotus', direction: 'out', step: 1, subject: 'Corporate events at Lotus Grand — partnership idea', classification: null, daysAgo: 15,
    body: 'Hi Duc,\n\nMaranasi Events produces brand activations for regional clients, and we are looking for a flagship ballroom partner in Hanoi. Lotus Grand keeps coming up.\n\nOpen to a short call about referral terms?' + SIG },
  { leadKey: 'lotus', direction: 'out', step: 2, subject: 'Re: Corporate events at Lotus Grand — partnership idea', classification: null, daysAgo: 8,
    body: 'Hi Duc,\n\nCircling back — we have two corporate galas looking for a Hanoi venue in Q4 and would love to route them to a partner.' + SIG },
  { leadKey: 'lotus', direction: 'in', step: null, subject: 'Re: Corporate events at Lotus Grand — partnership idea', classification: 'interested', daysAgo: 4,
    body: 'Hello Rami,\n\nThis sounds interesting. Could you send your activation portfolio and typical event sizes? If it fits we can set up a call next week.\n\nDuc\nLotus Grand Ballroom' },
  // Mekong — step 1 out
  { leadKey: 'mekong', direction: 'out', step: 1, subject: 'Exhibition side-events in Can Tho — Maranasi Events', classification: null, daysAgo: 2,
    body: 'Hi Long,\n\nWe design branded side-events and sponsor activations for exhibitions. Does Mekong Exhibition Co work with outside producers for sponsor experiences?' + SIG },
  // Hanoi Trade Fairs — 3 out, no reply
  { leadKey: 'hanoifairs', direction: 'out', step: 1, subject: 'Sponsor activations for your Hanoi fairs', classification: null, daysAgo: 20,
    body: 'Hello,\n\nWe produce sponsor activations and branded experiences for trade fairs across Southeast Asia. Who at Hanoi Trade Fairs handles sponsor experience partners?' + SIG },
  { leadKey: 'hanoifairs', direction: 'out', step: 2, subject: 'Re: Sponsor activations for your Hanoi fairs', classification: null, daysAgo: 13,
    body: 'Hello,\n\nFollowing up on my previous note — happy to share case studies from similar fairs in Bangkok.' + SIG },
  { leadKey: 'hanoifairs', direction: 'out', step: 3, subject: 'Re: Sponsor activations for your Hanoi fairs', classification: null, daysAgo: 6,
    body: 'Hello,\n\nLast note from me — if the timing is wrong I will leave it here. My door stays open for VIETBUILD season.' + SIG },
  // Pearl River — 3 out, dropped after phone gate
  { leadKey: 'pearl', direction: 'out', step: 1, subject: 'Destination weddings — production partner in HCMC', classification: null, daysAgo: 28,
    body: 'Hi Chau,\n\nWe handle staging, light and sound for destination weddings. Does Pearl River Weddings partner with outside production teams in peak season?' + SIG },
  { leadKey: 'pearl', direction: 'out', step: 2, subject: 'Re: Destination weddings — production partner in HCMC', classification: null, daysAgo: 22,
    body: 'Hi Chau,\n\nQuick follow-up on my note — peak season is filling up and we still have crew capacity in HCMC.' + SIG },
  { leadKey: 'pearl', direction: 'out', step: 3, subject: 'Re: Destination weddings — production partner in HCMC', classification: null, daysAgo: 16,
    body: 'Hi Chau,\n\nClosing the loop — I will stop emailing here. Reach out any time if a project needs extra hands.' + SIG },
  // Bangkok Convention Hub — 1 out + hot reply
  { leadKey: 'bkkhub', direction: 'out', step: 1, subject: 'Joint activation package for Bangkok Convention Hub', classification: null, daysAgo: 5,
    body: 'Hi Khun Somsak,\n\nWe bring regional brand-activation clients to Bangkok and are choosing one convention partner for a bundled package. Is this worth a short call?' + SIG },
  { leadKey: 'bkkhub', direction: 'in', step: null, subject: 'Re: Joint activation package for Bangkok Convention Hub', classification: 'interested', daysAgo: 1,
    body: 'Khun Rami,\n\nYes — we are actively looking for exactly this. Can you call me this week? My mobile is on our site.\n\nSomsak\nBangkok Convention Hub' },
  // Chiang Mai Expo — 1 out
  { leadKey: 'cmexpo', direction: 'out', step: 1, subject: 'Sponsor experiences at Chiang Mai Expo Center', classification: null, daysAgo: 4,
    body: 'Hi Pimchanok,\n\nWe produce sponsor activations for exhibitions — booths people actually queue for. Does CM Expo work with outside experience producers?' + SIG },
  // Siam Event Studio — out + polite decline
  { leadKey: 'siam', direction: 'out', step: 1, subject: 'Production partnership — Maranasi Events', classification: null, daysAgo: 12,
    body: 'Hi Anucha,\n\nWe are looking for a Bangkok agency partner for overflow production work. Would Siam Event Studio be open to a referral arrangement?' + SIG },
  { leadKey: 'siam', direction: 'in', step: null, subject: 'Re: Production partnership — Maranasi Events', classification: 'not_interested', daysAgo: 9,
    body: 'Hi Rami,\n\nThanks for reaching out. We keep all production in-house so this is not a fit for us right now. Good luck!\n\nAnucha' },
  // Phuket Marina — out + opt-out
  { leadKey: 'phuket', direction: 'out', step: 1, subject: 'Wedding production support in Phuket', classification: null, daysAgo: 10,
    body: 'Hello,\n\nWe provide staging and AV crews for destination weddings in Phuket. Do you take on outside production partners in high season?' + SIG },
  { leadKey: 'phuket', direction: 'in', step: null, subject: 'Re: Wedding production support in Phuket', classification: 'opt_out', daysAgo: 7,
    body: 'Please unsubscribe us from this list. We are not interested in partner emails.\n\nPhuket Marina Weddings' },
];

interface DemoActivity {
  leadKey: string | null;
  actor: 'system' | 'crm_agent' | 'owner';
  action: string;
  detail: Record<string, unknown>;
  daysAgo: number;
}

const ACTIVITIES: DemoActivity[] = [
  { leadKey: 'lotus', actor: 'system', action: 'reply_received', detail: { classification: 'interested' }, daysAgo: 4 },
  { leadKey: 'lotus', actor: 'crm_agent', action: 'status_change', detail: { from: 'contacted', to: 'interested' }, daysAgo: 4 },
  { leadKey: 'bkkhub', actor: 'system', action: 'reply_received', detail: { classification: 'interested' }, daysAgo: 1 },
  { leadKey: 'bkkhub', actor: 'crm_agent', action: 'status_change', detail: { from: 'contacted', to: 'interested' }, daysAgo: 1 },
  { leadKey: 'bkkhub', actor: 'owner', action: 'note_added', detail: { note: 'They want a call this week — priority.' }, daysAgo: 1 },
  { leadKey: 'siam', actor: 'system', action: 'reply_received', detail: { classification: 'not_interested' }, daysAgo: 9 },
  { leadKey: 'siam', actor: 'crm_agent', action: 'status_change', detail: { from: 'contacted', to: 'not_interested' }, daysAgo: 9 },
  { leadKey: 'phuket', actor: 'system', action: 'reply_received', detail: { classification: 'opt_out' }, daysAgo: 7 },
  { leadKey: 'phuket', actor: 'system', action: 'suppression_added', detail: { email: 'weddings@phuketmarina.example.com', reason: 'opt_out' }, daysAgo: 7 },
  { leadKey: 'phuket', actor: 'crm_agent', action: 'status_change', detail: { from: 'contacted', to: 'opted_out' }, daysAgo: 7 },
  { leadKey: 'hanoifairs', actor: 'system', action: 'status_change', detail: { from: 'contacted', to: 'unresponsive_email', needs_call: 1 }, daysAgo: 3 },
  { leadKey: 'pearl', actor: 'owner', action: 'call_outcome', detail: { outcome: 'unresponsive', note: 'Two calls, no pickup, voicemail full.' }, daysAgo: 9 },
  { leadKey: 'pearl', actor: 'crm_agent', action: 'lead_dropped', detail: { reason: 'No reply to 3 emails and unreachable by phone (owner logged the call).' }, daysAgo: 8 },
  { leadKey: 'ayutthaya', actor: 'system', action: 'verification_failed', detail: { reason: 'mailbox does not exist' }, daysAgo: 5 },
];

function days(n: number): string {
  // SQLite modifier string, e.g. '-18 days'
  return `-${n} days`;
}

export interface DemoCounts {
  leads: number;
  emails: number;
  activities: number;
  suppression: number;
  scrape_runs: number;
}

const LEAD_COLS = `company_name, contact_name, email, email_status, phone, phone_status, website, domain,
           category, city, country, timezone, source, status, confirmed, needs_call, sequence_step,
           next_action_at, last_contacted_at, drop_reason, notes, created_at, updated_at`;

export async function seedDemoData(db: D1Database): Promise<DemoCounts | { error: string }> {
  const ids: Record<string, number> = {};
  let claiming = true;
  for (const l of LEADS) {
    const valueExprs = `?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'demo', ?, ?, ?, ?,
           ${l.nextActionDays === null ? 'NULL' : "datetime('now', ?)"},
           ${l.lastContactedDays === null ? 'NULL' : "datetime('now', ?)"},
           ?, ?, datetime('now', ?), datetime('now', ?)`;
    // The first insert doubles as an atomic already-seeded guard: the NOT
    // EXISTS check runs in the same statement, so concurrent seeds cannot
    // both pass a separate SELECT before either has written a row.
    const sql = claiming
      ? `INSERT INTO leads (${LEAD_COLS}) SELECT ${valueExprs}
         WHERE NOT EXISTS (SELECT 1 FROM leads WHERE source = 'demo') RETURNING id`
      : `INSERT INTO leads (${LEAD_COLS}) VALUES (${valueExprs}) RETURNING id`;
    const row = await db
      .prepare(sql)
      .bind(
        l.company, l.contact, l.email, l.emailStatus, l.phone, l.phoneStatus,
        l.email ? l.email.split('@')[1] : null,
        l.category, l.city, l.country,
        l.country === 'VN' ? 'Asia/Ho_Chi_Minh' : 'Asia/Bangkok',
        l.status, l.confirmed, l.needsCall, l.step,
        ...(l.nextActionDays === null ? [] : [`+${l.nextActionDays} days`]),
        ...(l.lastContactedDays === null ? [] : [days(l.lastContactedDays)]),
        l.dropReason, l.notes, days(l.createdDays), days(Math.max(l.createdDays - 1, 0)),
      )
      .first<{ id: number }>();
    if (claiming && !row) return { error: 'demo data is already seeded — remove it first' };
    claiming = false;
    ids[l.key] = row!.id;
  }

  for (const e of EMAILS) {
    await db
      .prepare(
        `INSERT INTO email_log (lead_id, direction, sequence_step, subject, body, gmail_message_id, gmail_thread_id,
           classification, dry_run, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 1, datetime('now', ?, '+10 hours'))`,
      )
      .bind(ids[e.leadKey], e.direction, e.step, e.subject, e.body, e.classification, days(e.daysAgo))
      .run();
  }

  for (const a of ACTIVITIES) {
    await db
      .prepare(
        `INSERT INTO activities (actor, action, lead_id, detail, created_at)
         VALUES (?, ?, ?, ?, datetime('now', ?, '+11 hours'))`,
      )
      .bind(a.actor, a.action, a.leadKey ? ids[a.leadKey] : null, JSON.stringify(a.detail), days(a.daysAgo))
      .run();
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO suppression (email, domain, reason, created_at)
       VALUES ('weddings@phuketmarina.example.com', 'phuketmarina.example.com', 'opt_out', datetime('now', '-7 days'))`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO scrape_runs (trigger, queries_run, places_found, new_leads, skipped_dupes, status, started_at, finished_at)
       VALUES ('demo', 10, 57, 14, 43, 'done', datetime('now', '-21 days'), datetime('now', '-21 days', '+4 minutes'))`,
    )
    .run();

  // Intelligence showcase (P4): briefs + fit scores on the leads people click first.
  const DEMO_BRIEFS: Record<string, { fit: number; brief: Record<string, unknown>; socials?: Record<string, string> }> = {
    'events@lotusgrand.example.com': {
      fit: 5,
      brief: {
        what_they_do: 'Operates Hanoi ballroom venues hosting corporate galas, product launches and weddings for up to 800 guests.',
        event_types: ['corporate galas', 'product launches', 'weddings'],
        size_signals: ['3 ballrooms', 'up to 800 guests'],
        hook_angle: 'They list corporate galas as a core offering — pitch routing our Q4 gala clients to their ballrooms.',
        decision_makers: [{ name: 'Tran Van Duc', title: 'Events Director' }],
      },
      socials: { instagram: 'https://www.instagram.com/example', facebook: 'https://www.facebook.com/example' },
    },
    'sales@bkkconventionhub.example.com': {
      fit: 5,
      brief: {
        what_they_do: 'Bangkok convention center renting halls and organizing exhibition services for B2B trade shows.',
        event_types: ['trade shows', 'conventions', 'sponsor activations'],
        size_signals: ['12,000 sqm hall space'],
        hook_angle: 'Their site promotes sponsor packages — propose a bundled activation package for regional brands.',
        decision_makers: [{ name: 'Somsak Charoen', title: 'Sales Director' }],
      },
    },
    'hello@rex-events.example.com': {
      fit: 4,
      brief: {
        what_they_do: 'Ho Chi Minh City event agency producing corporate events for banking and FMCG clients.',
        event_types: ['corporate events', 'brand activations'],
        size_signals: ['banking clients'],
        hook_angle: 'They serve banking clients with big activation budgets — offer overflow production capacity for Q4.',
        decision_makers: [{ name: 'Nguyen Thi Mai', title: 'Managing Director' }],
      },
    },
    'info@cmexpo.example.com': {
      fit: 4,
      brief: {
        what_they_do: 'Chiang Mai exhibition center hosting regional expos and consumer fairs.',
        event_types: ['exhibitions', 'consumer fairs'],
        size_signals: [],
        hook_angle: 'Their expo calendar shows recurring fairs — pitch sponsor experience production for the next season.',
        decision_makers: [],
      },
    },
    'book@saigonskyline.example.com': {
      fit: 3,
      brief: {
        what_they_do: 'Rooftop venue in Ho Chi Minh City for private parties and small corporate receptions.',
        event_types: ['receptions', 'private parties'],
        size_signals: ['rooftop capacity 150'],
        hook_angle: 'Small-format venue — position light staging and AV packages for corporate receptions.',
        decision_makers: [{ name: 'Pham Quynh Anh', title: 'Venue Manager' }],
      },
    },
  };
  for (const [email, d] of Object.entries(DEMO_BRIEFS)) {
    await db
      .prepare("UPDATE leads SET brief = ?, fit_score = ?, socials = ? WHERE email = ? AND source = 'demo'")
      .bind(JSON.stringify(d.brief), d.fit, d.socials ? JSON.stringify(d.socials) : null, email)
      .run();
  }

  await db
    .prepare("INSERT INTO activities (actor, action, lead_id, detail) VALUES ('owner', 'demo_seeded', NULL, ?)")
    .bind(JSON.stringify({ leads: LEADS.length, emails: EMAILS.length }))
    .run();

  return {
    leads: LEADS.length,
    emails: EMAILS.length,
    activities: ACTIVITIES.length,
    suppression: 1,
    scrape_runs: 1,
  };
}

export async function removeDemoData(db: D1Database): Promise<DemoCounts> {
  // Deals/tasks hang off demo leads (seeded or created while exploring) —
  // they must go first or the leads delete trips FK constraints.
  await db.prepare("DELETE FROM tasks WHERE lead_id IN (SELECT id FROM leads WHERE source = 'demo')").run();
  await db
    .prepare("DELETE FROM tasks WHERE deal_id IN (SELECT d.id FROM deals d JOIN leads l ON l.id = d.lead_id WHERE l.source = 'demo')")
    .run();
  await db.prepare("DELETE FROM deals WHERE lead_id IN (SELECT id FROM leads WHERE source = 'demo')").run();
  const emails = await db
    .prepare("DELETE FROM email_log WHERE lead_id IN (SELECT id FROM leads WHERE source = 'demo')")
    .run();
  const acts = await db
    .prepare(
      "DELETE FROM activities WHERE lead_id IN (SELECT id FROM leads WHERE source = 'demo') OR action = 'demo_seeded'",
    )
    .run();
  const sup = await db
    .prepare("DELETE FROM suppression WHERE email IN (SELECT email FROM leads WHERE source = 'demo' AND email IS NOT NULL)")
    .run();
  const runs = await db.prepare("DELETE FROM scrape_runs WHERE trigger = 'demo'").run();
  const leads = await db.prepare("DELETE FROM leads WHERE source = 'demo'").run();
  const counts: DemoCounts = {
    leads: leads.meta.changes ?? 0,
    emails: emails.meta.changes ?? 0,
    activities: acts.meta.changes ?? 0,
    suppression: sup.meta.changes ?? 0,
    scrape_runs: runs.meta.changes ?? 0,
  };
  await db
    .prepare("INSERT INTO activities (actor, action, lead_id, detail) VALUES ('owner', 'demo_removed', NULL, ?)")
    .bind(JSON.stringify(counts))
    .run();
  return counts;
}
