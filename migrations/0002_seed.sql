-- Migration number: 0002 	 Seed data: search queries + placeholder templates

INSERT INTO search_queries (query, city, country, category) VALUES
  ('event management company in Ho Chi Minh City', 'Ho Chi Minh City', 'VN', 'event agency'),
  ('event venue in Ho Chi Minh City',              'Ho Chi Minh City', 'VN', 'event venue'),
  ('brand activation agency in Ho Chi Minh City',  'Ho Chi Minh City', 'VN', 'brand activation agency'),
  ('event management company in Hanoi',            'Hanoi',            'VN', 'event agency'),
  ('exhibition organizer in Hanoi',                'Hanoi',            'VN', 'exhibition organizer'),
  ('event management company in Bangkok',          'Bangkok',          'TH', 'event agency'),
  ('event venue in Bangkok',                       'Bangkok',          'TH', 'event venue'),
  ('exhibition organizer in Bangkok',              'Bangkok',          'TH', 'exhibition organizer'),
  ('brand activation agency in Bangkok',           'Bangkok',          'TH', 'brand activation agency'),
  ('event venue in Phuket',                        'Phuket',           'TH', 'event venue');

-- Placeholder templates (steps 1-3). Replace copy before go-live (see GOLIVE.md).
INSERT INTO templates (name, sequence_step, language, subject_template, body_template, active) VALUES
  (
    'step1_intro_placeholder', 1, 'en',
    'Events in {{city}} - quick question',
    'Hi {{contact_name}},

[PLACEHOLDER COPY - replace before go-live]

I came across {{company_name}} while researching the events scene in {{city}}. We are Maranasi Events, an events and brand activation company expanding into Southeast Asia, and we are looking to partner with established local teams like yours.

Would you be open to a short call to see if there is a fit?

Best regards,
{{sender_name}}
Maranasi Events

PS: If you would rather not hear from me, just reply "no thanks" and I will close your file.',
    1
  ),
  (
    'step2_followup_placeholder', 2, 'en',
    'Re: Events in {{city}} - quick question',
    'Hi {{contact_name}},

[PLACEHOLDER COPY - replace before go-live]

Following up on my last note. We work with venues, agencies and exhibition organizers on brand activations and corporate events, and {{city}} is a priority market for us this year.

If partnerships are not your area, could you point me to the right person at {{company_name}}?

Best regards,
{{sender_name}}
Maranasi Events

PS: If you would rather not hear from me, just reply "no thanks" and I will close your file.',
    1
  ),
  (
    'step3_final_placeholder', 3, 'en',
    'Re: Events in {{city}} - quick question',
    'Hi {{contact_name}},

[PLACEHOLDER COPY - replace before go-live]

Last note from me. If expanding your event pipeline with an international partner is interesting at some point, my door stays open - just reply to this email.

Either way, thanks for reading, and all the best with the season in {{city}}.

Best regards,
{{sender_name}}
Maranasi Events

PS: This is my last email unless you reply - no more follow-ups from me.',
    1
  );
