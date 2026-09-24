import { describe, it, expect } from 'vitest';
import {
  classifySentiment,
  extractTopics,
  analyzeReview,
  generateResponseDraft,
  type ReviewResponseConfig,
} from './review-response.models';

// ---------------------------------------------------------------------------
// classifySentiment
// ---------------------------------------------------------------------------

describe('classifySentiment', () => {
  it('classifies 4-5 as positive', () => {
    expect(classifySentiment(4)).toBe('positive');
    expect(classifySentiment(5)).toBe('positive');
  });

  it('classifies 3 as mixed when cues are balanced or absent', () => {
    expect(classifySentiment(3)).toBe('mixed');
    expect(classifySentiment(3, 'Staff was great but the room was disappointing')).toBe('mixed');
  });

  it('leans a rating-3 review negative when complaint cues dominate', () => {
    expect(
      classifySentiment(3, 'Dirty room, terrible smell, rude service, never again'),
    ).toBe('negative');
  });

  it('leans a rating-3 review positive when praise cues dominate', () => {
    expect(
      classifySentiment(3, 'Amazing staff, wonderful location, excellent breakfast, loved it'),
    ).toBe('positive');
  });

  it('classifies 1-2 as negative', () => {
    expect(classifySentiment(1)).toBe('negative');
    expect(classifySentiment(2)).toBe('negative');
  });
});

// ---------------------------------------------------------------------------
// extractTopics
// ---------------------------------------------------------------------------

describe('extractTopics', () => {
  it('detects cleanliness topic', () => {
    const topics = extractTopics('The room was not very clean and the bathroom had stains');
    expect(topics).toContain('cleanliness');
  });

  it('detects staff topic', () => {
    const topics = extractTopics('The staff was incredibly friendly and helpful');
    expect(topics).toContain('staff');
  });

  it('detects multiple topics', () => {
    const topics = extractTopics('Great location, friendly staff, but the wifi was terrible');
    expect(topics).toContain('location');
    expect(topics).toContain('staff');
    expect(topics).toContain('wifi');
  });

  it('detects noise topic', () => {
    const topics = extractTopics('Very noisy at night, could hear traffic through the walls');
    expect(topics).toContain('noise');
  });

  it('detects value topic', () => {
    const topics = extractTopics('Way too expensive for what you get, not worth the price');
    expect(topics).toContain('value');
  });

  it('returns empty for unrecognized content', () => {
    const topics = extractTopics('Had a lovely time overall, would return');
    expect(topics.length).toBe(0);
  });

  it('detects food topic', () => {
    const topics = extractTopics('The breakfast buffet was amazing');
    expect(topics).toContain('food');
  });

  it('detects room quality topic', () => {
    const topics = extractTopics('The bed was extremely comfortable and the bathroom was modern');
    expect(topics).toContain('room_quality');
  });

  it('does not treat substring false positives as topics', () => {
    // "bargain" must not match amenities "bar"; "vacations" must not match "ac"
    const topics = extractTopics('Found a bargain on our vacations package online');
    expect(topics).not.toContain('amenities');
    expect(topics).not.toContain('room_quality');
  });

  it('still matches AC as a whole word for room quality', () => {
    expect(extractTopics('The AC was broken all night')).toContain('room_quality');
    expect(extractTopics('The bar was closed')).toContain('amenities');
  });
});

// ---------------------------------------------------------------------------
// analyzeReview
// ---------------------------------------------------------------------------

describe('analyzeReview', () => {
  it('returns high urgency for negative reviews', () => {
    const result = analyzeReview(1, 'Terrible experience, dirty room');
    expect(result.sentiment).toBe('negative');
    expect(result.urgency).toBe('high');
    expect(result.topics).toContain('cleanliness');
  });

  it('returns normal urgency for positive reviews', () => {
    const result = analyzeReview(5, 'Amazing stay, loved the location');
    expect(result.sentiment).toBe('positive');
    expect(result.urgency).toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// generateResponseDraft
// ---------------------------------------------------------------------------

describe('generateResponseDraft', () => {
  const config: ReviewResponseConfig = {
    responseStyle: 'friendly',
    managerName: 'John Smith',
    managerTitle: 'General Manager',
    propertyName: 'Telivity Grand Hotel',
  };

  it('generates thankful response for positive review', () => {
    const draft = generateResponseDraft(
      5,
      'Amazing staff, everyone was so friendly and helpful',
      'Alice',
      config,
    );
    expect(draft.tone).toContain('positive');
    expect(draft.responseText).toContain('Alice');
    expect(draft.responseText.toLowerCase()).toContain('thank');
    expect(draft.keyPointsAddressed).toContain('staff');
  });

  it('generates apologetic response for negative review', () => {
    const draft = generateResponseDraft(
      1,
      'Room was dirty, noisy all night, terrible experience',
      'Bob',
      config,
    );
    expect(draft.tone).toContain('negative');
    expect(draft.responseText).toContain('sorry');
    expect(draft.keyPointsAddressed).toContain('cleanliness');
    expect(draft.keyPointsAddressed).toContain('noise');
  });

  it('generates balanced response for mixed review', () => {
    const draft = generateResponseDraft(
      3,
      'Staff was great but the room was a bit small for the price',
      'Carol',
      config,
    );
    expect(draft.tone).toContain('mixed');
    expect(draft.responseText).toContain('Carol');
  });

  it('includes stay details when matched', () => {
    const draft = generateResponseDraft(
      5,
      'Wonderful stay',
      'Dave',
      config,
      { roomType: 'Executive Suite', nights: 4 },
    );
    expect(draft.responseText).toContain('Executive Suite');
    expect(draft.responseText).toContain('4-night');
  });

  it('includes manager signature', () => {
    const draft = generateResponseDraft(5, 'Great hotel', 'Eve', config);
    expect(draft.responseText).toContain('John Smith');
    expect(draft.responseText).toContain('General Manager');
    expect(draft.responseText).toContain('Telivity Grand Hotel');
  });

  it('respects formal style', () => {
    const formalConfig: ReviewResponseConfig = { ...config, responseStyle: 'formal' };
    const draft = generateResponseDraft(5, 'Wonderful staff', 'Frank', formalConfig);
    expect(draft.responseText).toContain('Dear Frank');
  });

  it('respects casual style', () => {
    const casualConfig: ReviewResponseConfig = { ...config, responseStyle: 'casual' };
    const draft = generateResponseDraft(5, 'Great place', 'Grace', casualConfig);
    expect(draft.responseText).toContain('Hey Grace');
  });

  it('handles review with no detectable topics', () => {
    const draft = generateResponseDraft(4, 'Had a lovely time overall', 'Hank', config);
    expect(draft.responseText).toContain('glad you enjoyed');
    expect(draft.keyPointsAddressed.length).toBe(0);
  });

  it('confidence increases with topic coverage but stays modest', () => {
    const noTopics = generateResponseDraft(5, 'Nice', 'Ivy', config);
    const withTopics = generateResponseDraft(
      2,
      'Dirty room, noisy, terrible wifi, overpriced',
      'Jay',
      config,
    );
    expect(withTopics.confidence).toBeGreaterThan(noTopics.confidence);
    expect(withTopics.confidence).toBeLessThanOrEqual(0.85);
  });

  it('caps keyword-based confidence at 0.85', () => {
    const draft = generateResponseDraft(
      1,
      'Dirty, noisy, rude staff, overpriced, terrible food, bad parking, slow wifi',
      'Kay',
      config,
    );
    expect(draft.confidence).toBeLessThanOrEqual(0.85);
  });
});
