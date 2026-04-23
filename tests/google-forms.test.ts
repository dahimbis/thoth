import { describe, it, expect } from 'vitest';
import { isGoogleFormUrl } from '../src/browser/pages/google-forms.js';

describe('Google Forms', () => {
  describe('isGoogleFormUrl', () => {
    it('should detect standard Google Form URLs', () => {
      expect(isGoogleFormUrl('https://docs.google.com/forms/d/e/1FAIpQLSdPHe/viewform')).toBe(true);
      expect(isGoogleFormUrl('https://docs.google.com/forms/d/1abc123/edit')).toBe(true);
    });

    it('should detect shortened Google Form URLs', () => {
      expect(isGoogleFormUrl('https://forms.gle/abc123')).toBe(true);
    });

    it('should detect forms.google.com URLs', () => {
      expect(isGoogleFormUrl('https://forms.google.com/some-form')).toBe(true);
    });

    it('should reject non-form URLs', () => {
      expect(isGoogleFormUrl('https://www.google.com')).toBe(false);
      expect(isGoogleFormUrl('https://docs.google.com/document/d/abc')).toBe(false);
      expect(isGoogleFormUrl('https://brightspace.nyu.edu')).toBe(false);
      expect(isGoogleFormUrl('https://example.com/forms')).toBe(false);
    });
  });
});

describe('Profile Field Matching', () => {
  // Test the matching logic by importing the patterns indirectly
  // We test through the module's exported function behavior

  it('should export processGoogleForm function', async () => {
    const module = await import('../src/browser/pages/google-forms.js');
    expect(module.processGoogleForm).toBeDefined();
    expect(module.extractGoogleForm).toBeDefined();
    expect(module.fillGoogleForm).toBeDefined();
    expect(module.submitGoogleForm).toBeDefined();
  });
});
