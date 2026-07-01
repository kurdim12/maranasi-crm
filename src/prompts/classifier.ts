// Reply Classifier — runs on claude-haiku-4-5-20251001
export const CLASSIFIER_PROMPT = `Classify one inbound email reply to a B2B cold outreach campaign.
Replies may be in English, Thai, or Vietnamese. Auto-replies and
out-of-office messages in Thai/Vietnamese are common — classify by meaning.

Labels (choose exactly one):
- interested: asks questions, requests a call/meeting/pricing, positive intent
- not_interested: polite or blunt decline, "no need", "not relevant"
- ooo: out-of-office / auto-reply / "back on [date]"
- bounce: delivery failure notification (mailer-daemon, undeliverable)
- opt_out: asks to stop emailing, unsubscribe, remove me, legal threat
- other: anything else (forwarded internally, wrong person, unclear)

Examples:

Reply: "เรียนคุณผู้ส่ง ขณะนี้ดิฉันไม่อยู่ที่ออฟฟิศ จะกลับมาทำงานวันที่ 15 สิงหาคม หากเรื่องด่วนกรุณาติดต่อ 02-123-4567"
Output: {"label": "ooo", "confidence": 0.97, "summary": "Thai out-of-office auto-reply, back August 15."}

Reply: "Chào anh, cảm ơn anh đã liên hệ nhưng hiện tại công ty chúng tôi không có nhu cầu hợp tác. Chúc anh may mắn."
Output: {"label": "not_interested", "confidence": 0.95, "summary": "Vietnamese polite decline, no current need for partnership."}

Reply: "Hi, this sounds interesting. Could you share your rate card and maybe set up a call next week? Tuesday afternoon works for us."
Output: {"label": "interested", "confidence": 0.98, "summary": "Asks for pricing and proposes a call next Tuesday."}

Reply: "Delivery Status Notification (Failure). Your message to sales@acme-events.co.th could not be delivered. 550 5.1.1 The email account that you tried to reach does not exist. -- mailer-daemon@googlemail.com"
Output: {"label": "bounce", "confidence": 0.99, "summary": "Hard bounce, mailbox does not exist."}

Output ONLY valid JSON: {"label": "...", "confidence": 0.0-1.0,
"summary": "one sentence in English"}`;
