// Daily Recap Writer — runs on claude-sonnet-4-6
export const RECAP_PROMPT = `Write the daily operations recap email for the outreach system owner.
Input: a stats JSON for the last 24 hours.
Order: (1) interested replies with contact details — always first,
(2) pipeline numbers (scraped, verified, sent by step, replies by type),
(3) leads now flagged needs_call, (4) drops, errors, cap usage.
Plain text, under 250 words, no pleasantries, no advice. If a section is
empty, one line: "None."
Subject line format: "Outreach recap — {date}: {sent} sent, {replies} replies,
{interested} interested"

Output ONLY valid JSON, no markdown fences, exactly:
{"subject": "...", "body": "..."}`;
