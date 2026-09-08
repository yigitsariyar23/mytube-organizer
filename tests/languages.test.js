import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLanguages, canonicalLanguage, languageCatalogMatches, LANGUAGE_CATALOG } from '../shared/languages.js';

test('active languages default to the requested four and allow an empty selection', () => {
  assert.deepEqual(activeLanguages(), ['Turkish', 'English', 'Russian', 'French']);
  assert.deepEqual(activeLanguages([]), []);
});
test('existing language aliases resolve without rewriting channel assignments', () => {
  assert.deepEqual(activeLanguages(['Türkçe', 'tr', '🇫🇷 Français', 'Русский', 'English']),
    ['Turkish', 'French', 'Russian', 'English']);
  assert.equal(canonicalLanguage('My custom language'), 'My custom language');
});
test('catalog search accepts English names, native names and codes', () => {
  const turkish = LANGUAGE_CATALOG.find(l => l.code === 'tr');
  assert.ok(languageCatalogMatches(turkish, 'Turkish'));
  assert.ok(languageCatalogMatches(turkish, 'Türk'));
  assert.ok(languageCatalogMatches(turkish, 'tr'));
  assert.equal(languageCatalogMatches(turkish, 'French'), false);
});
