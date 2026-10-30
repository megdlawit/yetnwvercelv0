import { describe, expect, it } from 'vitest';
import {
  businessInfo, internationalDigits, mailHref, ratingText, reviewProblem, reviewsText, starCounts, suggestedAmenities, telHref, websiteHref,
  websiteLabel, whatsappHref,
} from './business';

describe('contact links', () => {
  it('makes Ethiopian numbers international', () => {
    expect(internationalDigits('0911 22 33 44')).toBe('251911223344');
    expect(internationalDigits('+251 911-223344')).toBe('251911223344');
    expect(internationalDigits('00251911223344')).toBe('251911223344');
    expect(internationalDigits('911223344')).toBe('251911223344');
    expect(internationalDigits('011 551 2345')).toBe('251115512345');
    expect(internationalDigits('12')).toBeNull();
  });
  it('builds call, WhatsApp and email links', () => {
    expect(telHref('0911223344')).toBe('tel:+251911223344');
    expect(whatsappHref('0911 223 344')).toBe('https://wa.me/251911223344');
    expect(telHref('')).toBeNull();
    expect(mailHref('hello@tomoca.com')).toBe('mailto:hello@tomoca.com');
    expect(mailHref('not an email')).toBeNull();
  });
  it('only links to web pages', () => {
    expect(websiteHref('tomoca.com')).toBe('https://tomoca.com/');
    expect(websiteHref('http://example.org/menu')).toBe('http://example.org/menu');
    expect(websiteHref('javascript:alert(1)')).toBeNull();
    expect(websiteHref('  ')).toBeNull();
    expect(websiteLabel('https://www.tomoca.com/menu')).toBe('tomoca.com');
  });
});

describe('business info for visitors', () => {
  it('keeps what was filled in and drops unknown amenities', () => {
    const info = businessInfo({ phone: ' 0911 ', amenities: ['wifi', 'teleport'], price_range: '$$', business_id: 'b1', about: '' });
    expect(info).toMatchObject({ phone: '0911', amenities: ['wifi'], priceRange: '$$', claimed: true, about: null });
  });
  it('shows nothing for an empty, unclaimed profile', () => {
    expect(businessInfo({ amenities: [], business_id: null })).toBeNull();
    expect(businessInfo(null)).toBeNull();
  });
  it('suggests amenities by kind of place', () => {
    expect(suggestedAmenities('hotel')).toContain('breakfast');
    expect(suggestedAmenities('restaurant')).toContain('fasting');
    expect(suggestedAmenities('shop')).toContain('souvenirs');
  });
});

describe('reviews', () => {
  it('writes ratings plainly', () => {
    expect(ratingText(4)).toBe('4');
    expect(ratingText(4.46)).toBe('4.5');
    expect(reviewsText(1)).toBe('1 review');
    expect(reviewsText(1200)).toBe('1,200 reviews');
  });
  it('counts stars, 5 first', () => {
    expect(starCounts([{ rating: 5 }, { rating: 5 }, { rating: 2 }])).toEqual([
      { stars: 5, count: 2 }, { stars: 4, count: 0 }, { stars: 3, count: 0 }, { stars: 2, count: 1 }, { stars: 1, count: 0 },
    ]);
  });
  it('says what is missing before posting', () => {
    expect(reviewProblem(0, 'Hana', '')).toMatch(/stars/);
    expect(reviewProblem(4, ' ', '')).toMatch(/name/);
    expect(reviewProblem(4, 'Hana', 'x'.repeat(1501))).toMatch(/1,500/);
    expect(reviewProblem(4, 'Hana', 'Lovely')).toBeNull();
  });
});
