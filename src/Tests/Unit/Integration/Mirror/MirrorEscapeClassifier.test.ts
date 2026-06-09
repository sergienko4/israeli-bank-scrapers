/**
 * Unit tests for the mirror simulator's escape classifier.
 */

import {
  BENIGN_HOST_SUFFIXES,
  classifyEscape,
} from '../../../Integration/Mirror/MirrorEscapeClassifier.js';

describe('classifyEscape — noise', () => {
  it('classifies favicon as noise regardless of resource type', () => {
    const result = classifyEscape({
      method: 'GET',
      url: 'https://example.com/favicon.ico',
      resourceType: 'image',
    });
    expect(result).toBe('noise');
  });

  it('classifies well-known probe paths as noise', () => {
    const result = classifyEscape({
      method: 'GET',
      url: 'https://example.com/.well-known/security.txt',
      resourceType: 'document',
    });
    expect(result).toBe('noise');
  });

  it('classifies data: URLs as noise', () => {
    const result = classifyEscape({
      method: 'GET',
      url: 'data:image/png;base64,AAA',
      resourceType: 'image',
    });
    expect(result).toBe('noise');
  });

  it('classifies malformed URLs as noise', () => {
    const result = classifyEscape({
      method: 'GET',
      url: 'about:blank',
      resourceType: 'document',
    });
    expect(result).toBe('noise');
  });
});

describe('classifyEscape — benign', () => {
  it('classifies image, font, stylesheet, media as benign', () => {
    const imageResult = classifyEscape({
      method: 'GET',
      url: 'https://cdn.bank.example/logo.png',
      resourceType: 'image',
    });
    const fontResult = classifyEscape({
      method: 'GET',
      url: 'https://cdn.bank.example/Roboto.woff2',
      resourceType: 'font',
    });
    const cssResult = classifyEscape({
      method: 'GET',
      url: 'https://cdn.bank.example/app.css',
      resourceType: 'stylesheet',
    });
    const mediaResult = classifyEscape({
      method: 'GET',
      url: 'https://cdn.bank.example/jingle.mp3',
      resourceType: 'media',
    });
    expect(imageResult).toBe('benign');
    expect(fontResult).toBe('benign');
    expect(cssResult).toBe('benign');
    expect(mediaResult).toBe('benign');
  });

  it.each(BENIGN_HOST_SUFFIXES)('classifies %s host suffix as benign', host => {
    const result = classifyEscape({
      method: 'POST',
      url: `https://api.${host}/beacon`,
      resourceType: 'fetch',
    });
    expect(result).toBe('benign');
  });
});

describe('classifyEscape — fatal', () => {
  it('classifies unmatched bank XHR as fatal', () => {
    const result = classifyEscape({
      method: 'POST',
      url: 'https://www.hapoalim.co.il/api/cycle-billing',
      resourceType: 'fetch',
    });
    expect(result).toBe('fatal');
  });

  it('classifies unmatched bank document GET as fatal', () => {
    const result = classifyEscape({
      method: 'GET',
      url: 'https://www.hapoalim.co.il/dashboard/accounts',
      resourceType: 'document',
    });
    expect(result).toBe('fatal');
  });

  it('classifies unmatched bank script as fatal', () => {
    const result = classifyEscape({
      method: 'GET',
      url: 'https://www.hapoalim.co.il/main.bundle.js',
      resourceType: 'script',
    });
    expect(result).toBe('fatal');
  });
});
