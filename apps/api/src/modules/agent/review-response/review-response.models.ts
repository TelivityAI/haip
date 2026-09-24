/**
 * Review Response Agent — template-based review response drafts.
 *
 * Template-based with smart assembly. Not freeform LLM generation.
 * NEVER argue with the guest. NEVER deny the experience.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewSentiment = 'positive' | 'mixed' | 'negative';

export type ReviewTopic =
  | 'cleanliness'
  | 'location'
  | 'staff'
  | 'value'
  | 'amenities'
  | 'noise'
  | 'food'
  | 'parking'
  | 'wifi'
  | 'room_quality';

export interface ReviewAnalysis {
  sentiment: ReviewSentiment;
  topics: ReviewTopic[];
  urgency: 'high' | 'normal';
}

export type ResponseStyle = 'formal' | 'friendly' | 'casual';

export interface ReviewResponseDraft {
  responseText: string;
  tone: string;
  keyPointsAddressed: ReviewTopic[];
  confidence: number;
}

export interface ReviewResponseConfig {
  responseStyle: ResponseStyle;
  managerName?: string;
  managerTitle?: string;
  propertyName?: string;
}

// ---------------------------------------------------------------------------
// Sentiment classification
// ---------------------------------------------------------------------------

const POSITIVE_CUES = [
  'great',
  'amazing',
  'wonderful',
  'excellent',
  'loved',
  'perfect',
  'friendly',
  'clean',
  'helpful',
  'comfortable',
  'recommend',
];

const NEGATIVE_CUES = [
  'dirty',
  'terrible',
  'awful',
  'rude',
  'slow',
  'broken',
  'worst',
  'disappointed',
  'noisy',
  'smell',
  'overpriced',
  'never',
  'however',
  'but',
];

/** Escape a keyword for RegExp; spaces become flexible whitespace. */
function keywordPattern(keyword: string): RegExp {
  const escaped = keyword
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  // Word-ish boundaries so "bar" ≠ "bargain" and "ac" ≠ "vacations".
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
}

function countCueHits(text: string, cues: string[]): number {
  let n = 0;
  for (const cue of cues) {
    if (keywordPattern(cue).test(text)) n += 1;
  }
  return n;
}

/**
 * Stars are the primary signal. For a middle rating (3), lean on simple
 * positive/negative word cues so "staff was great but room was tiny" stays
 * mixed while an all-complaint 3 drifts negative (and all-praise drifts positive).
 */
export function classifySentiment(rating: number, reviewText = ''): ReviewSentiment {
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  // rating === 3
  const pos = countCueHits(reviewText, POSITIVE_CUES);
  const neg = countCueHits(reviewText, NEGATIVE_CUES);
  if (neg > pos + 1) return 'negative';
  if (pos > neg + 1) return 'positive';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Topic extraction (keyword-based, word-boundary match)
// ---------------------------------------------------------------------------

const TOPIC_KEYWORDS: Record<ReviewTopic, string[]> = {
  cleanliness: ['clean', 'dirty', 'stain', 'hygiene', 'housekeeping', 'dust', 'mold', 'smell', 'odor', 'filthy', 'spotless', 'tidy'],
  location: ['location', 'downtown', 'central', 'access', 'walkable', 'neighborhood', 'area', 'convenient', 'far', 'close to'],
  staff: ['staff', 'friendly', 'rude', 'helpful', 'reception', 'concierge', 'check-in', 'service', 'attentive', 'welcoming', 'unfriendly'],
  value: ['price', 'value', 'expensive', 'cheap', 'worth', 'overpriced', 'affordable', 'money', 'cost', 'rate'],
  amenities: ['pool', 'gym', 'spa', 'fitness', 'sauna', 'lounge', 'bar', 'amenities', 'facilities'],
  noise: ['noise', 'noisy', 'quiet', 'loud', 'peaceful', 'soundproof', 'wall', 'traffic'],
  food: ['breakfast', 'restaurant', 'food', 'dining', 'meal', 'buffet', 'coffee', 'menu'],
  parking: ['parking', 'garage', 'valet', 'car'],
  wifi: ['wifi', 'wi-fi', 'internet', 'connection', 'signal'],
  room_quality: ['room', 'bed', 'comfortable', 'view', 'bathroom', 'shower', 'towel', 'pillow', 'mattress', 'air conditioning', 'ac', 'heating'],
};

export function extractTopics(text: string): ReviewTopic[] {
  const found: ReviewTopic[] = [];

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as [ReviewTopic, string[]][]) {
    if (keywords.some((kw) => keywordPattern(kw).test(text))) {
      found.push(topic);
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Analyze a review
// ---------------------------------------------------------------------------

export function analyzeReview(rating: number, reviewText: string): ReviewAnalysis {
  const sentiment = classifySentiment(rating, reviewText);
  const topics = extractTopics(reviewText);
  const urgency = sentiment === 'negative' ? 'high' : 'normal';

  return { sentiment, topics, urgency };
}

// ---------------------------------------------------------------------------
// Response building blocks (per topic)
// ---------------------------------------------------------------------------

const TOPIC_RESPONSES_POSITIVE: Partial<Record<ReviewTopic, string>> = {
  cleanliness: 'We take great pride in our housekeeping standards, and your kind words will be shared with the team.',
  location: 'We\'re glad you enjoyed our location — it\'s one of the things our guests love most.',
  staff: 'Your kind words about our team mean the world to us. I\'ll be sure to pass them along.',
  value: 'We\'re delighted you felt our rates provided great value for your stay.',
  amenities: 'We\'re happy to hear you enjoyed our facilities.',
  food: 'Wonderful to hear you enjoyed the dining experience.',
  room_quality: 'We\'re pleased you found your room comfortable and well-appointed.',
};

const TOPIC_RESPONSES_NEGATIVE: Partial<Record<ReviewTopic, string>> = {
  cleanliness: 'We\'ve shared your feedback with our housekeeping team and are reviewing our cleaning procedures to ensure this doesn\'t happen again.',
  location: 'We understand location preferences vary. We\'re happy to provide transportation recommendations for future stays.',
  staff: 'We sincerely apologize for the service experience you described. We\'ve addressed this with the team to ensure all guests receive the warm welcome they deserve.',
  value: 'We appreciate your feedback on pricing and are always working to deliver the best value. We\'d love the chance to make your next visit more memorable.',
  amenities: 'Thank you for letting us know about the amenity concerns. We are actively investing in improvements.',
  noise: 'We apologize for the noise inconvenience. We\'ve noted your feedback and will review our soundproofing and room assignment practices.',
  food: 'We\'re sorry the dining experience didn\'t meet your expectations. Your feedback has been shared with our culinary team.',
  parking: 'We apologize for the parking inconvenience and are looking into ways to improve this experience.',
  wifi: 'We apologize for the connectivity issues. Our IT team is working on upgrading our network infrastructure.',
  room_quality: 'We\'re sorry your room didn\'t meet your expectations. We\'ve noted this and will review our room maintenance schedule.',
};

// ---------------------------------------------------------------------------
// Greetings and closings by style
// ---------------------------------------------------------------------------

const GREETINGS: Record<ResponseStyle, Record<ReviewSentiment, string>> = {
  formal: {
    positive: 'Dear {guest_name},\n\nThank you for taking the time to share your wonderful feedback.',
    mixed: 'Dear {guest_name},\n\nThank you for your candid review. We appreciate you sharing your experience.',
    negative: 'Dear {guest_name},\n\nThank you for bringing these concerns to our attention. We sincerely apologize for the shortcomings during your stay.',
  },
  friendly: {
    positive: 'Hi {guest_name}!\n\nThank you so much for your lovely review — it truly made our day!',
    mixed: 'Hi {guest_name},\n\nThank you for sharing your honest feedback. We really appreciate it.',
    negative: 'Hi {guest_name},\n\nThank you for taking the time to share your experience. We\'re truly sorry we fell short of your expectations.',
  },
  casual: {
    positive: 'Hey {guest_name}!\n\nThanks for the amazing review! We\'re thrilled you had a great time.',
    mixed: 'Hey {guest_name},\n\nThanks for the honest feedback — it helps us get better!',
    negative: 'Hey {guest_name},\n\nWe really appreciate you sharing this with us. We\'re sorry things didn\'t go as expected.',
  },
};

const CLOSINGS: Record<ResponseStyle, Record<ReviewSentiment, string>> = {
  formal: {
    positive: 'We look forward to welcoming you again.\n\nWith warm regards,',
    mixed: 'We hope to have the opportunity to welcome you back and provide an even better experience.\n\nSincerely,',
    negative: 'We would welcome the chance to make things right. Please don\'t hesitate to contact us directly.\n\nSincerely,',
  },
  friendly: {
    positive: 'We can\'t wait to see you again!\n\nWarm regards,',
    mixed: 'We\'d love to welcome you back and show you the best we can offer!\n\nBest,',
    negative: 'We\'d really love another chance to give you the experience you deserve. Please reach out to us anytime.\n\nBest,',
  },
  casual: {
    positive: 'Hope to see you again soon!\n\nCheers,',
    mixed: 'Hope to see you again — we\'ll make it even better next time!\n\nCheers,',
    negative: 'We\'d love a chance to make it up to you. Drop us a line anytime.\n\nCheers,',
  },
};

// ---------------------------------------------------------------------------
// Generate response draft
// ---------------------------------------------------------------------------

export function generateResponseDraft(
  rating: number,
  reviewText: string,
  guestName: string,
  config: ReviewResponseConfig,
  stayDetails?: { roomType?: string; nights?: number },
): ReviewResponseDraft {
  const analysis = analyzeReview(rating, reviewText);
  const style = config.responseStyle ?? 'friendly';
  const sentiment = analysis.sentiment;

  // Build greeting
  let response = GREETINGS[style][sentiment].replace('{guest_name}', guestName);

  // Add topic-specific blocks
  const addressedTopics: ReviewTopic[] = [];
  const topicResponses = sentiment === 'negative' ? TOPIC_RESPONSES_NEGATIVE : TOPIC_RESPONSES_POSITIVE;

  for (const topic of analysis.topics.slice(0, 4)) {
    const block = topicResponses[topic];
    if (block) {
      response += '\n\n' + block;
      addressedTopics.push(topic);
    }
  }

  // Add stay reference if matched
  if (stayDetails?.roomType) {
    response += `\n\nWe hope you enjoyed your time in our ${stayDetails.roomType}`;
    if (stayDetails.nights && stayDetails.nights > 1) {
      response += ` during your ${stayDetails.nights}-night stay`;
    }
    response += '.';
  }

  // If no specific topics addressed, add a generic body
  if (addressedTopics.length === 0) {
    if (sentiment === 'positive') {
      response += '\n\nWe\'re so glad you enjoyed your stay. Your feedback motivates our team to keep delivering the best experience.';
    } else if (sentiment === 'mixed') {
      response += '\n\nWe appreciate both your kind words and your constructive feedback. We\'re always looking for ways to improve.';
    } else {
      response += '\n\nWe take all feedback seriously and will be reviewing the concerns you\'ve raised with our team.';
    }
  }

  // Add closing
  response += '\n\n' + CLOSINGS[style][sentiment];

  // Add manager signature
  if (config.managerName) {
    response += `\n${config.managerName}`;
    if (config.managerTitle) {
      response += `, ${config.managerTitle}`;
    }
    if (config.propertyName) {
      response += `\n${config.propertyName}`;
    }
  }

  // Keyword hits are a weak signal — keep confidence modest so autopilot
  // risk tiers treat these as drafts for humans, not "understood" certainty.
  const topicCoverage =
    analysis.topics.length > 0 ? addressedTopics.length / analysis.topics.length : 0;
  const shortText = reviewText.trim().split(/\s+/).filter(Boolean).length < 8;
  let confidence = 0.55 + topicCoverage * 0.2;
  if (shortText) confidence -= 0.1;
  if (analysis.topics.length === 0) confidence = Math.min(confidence, 0.5);
  confidence = Math.max(0.35, Math.min(0.85, confidence));

  return {
    responseText: response,
    tone: `${style}_${sentiment}`,
    keyPointsAddressed: addressedTopics,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export function getDefaultReviewResponseConfig(): ReviewResponseConfig {
  return {
    responseStyle: 'friendly',
  };
}
