// Offline language catalog: stable names and native aliases, no network/key needed.
export const LANGUAGE_CATALOG = [
  ['tr', 'Turkish', 'Türkçe'], ['en', 'English', 'English'],
  ['ru', 'Russian', 'Русский'], ['fr', 'French', 'Français'],
  ['es', 'Spanish', 'Español'], ['pt', 'Portuguese', 'Português'],
  ['de', 'German', 'Deutsch'], ['it', 'Italian', 'Italiano'],
  ['ar', 'Arabic', 'العربية'], ['zh', 'Chinese', '中文'],
  ['ja', 'Japanese', '日本語'], ['ko', 'Korean', '한국어'],
  ['hi', 'Hindi', 'हिन्दी'], ['bn', 'Bengali', 'বাংলা'],
  ['ur', 'Urdu', 'اردو'], ['fa', 'Persian', 'فارسی'],
  ['id', 'Indonesian', 'Bahasa Indonesia'], ['ms', 'Malay', 'Bahasa Melayu'],
  ['vi', 'Vietnamese', 'Tiếng Việt'], ['th', 'Thai', 'ไทย'],
  ['tl', 'Filipino', 'Tagalog'], ['nl', 'Dutch', 'Nederlands'],
  ['pl', 'Polish', 'Polski'], ['uk', 'Ukrainian', 'Українська'],
  ['ro', 'Romanian', 'Română'], ['el', 'Greek', 'Ελληνικά'],
  ['cs', 'Czech', 'Čeština'], ['sv', 'Swedish', 'Svenska'],
  ['no', 'Norwegian', 'Norsk'], ['da', 'Danish', 'Dansk'],
  ['fi', 'Finnish', 'Suomi'], ['hu', 'Hungarian', 'Magyar'],
  ['he', 'Hebrew', 'עברית'], ['bg', 'Bulgarian', 'Български'],
  ['sr', 'Serbian', 'Srpski'], ['hr', 'Croatian', 'Hrvatski'],
  ['sk', 'Slovak', 'Slovenčina'], ['sl', 'Slovenian', 'Slovenščina'],
  ['az', 'Azerbaijani', 'Azərbaycan'], ['kk', 'Kazakh', 'Қазақша'],
  ['sw', 'Swahili', 'Kiswahili'], ['ta', 'Tamil', 'தமிழ்'],
  ['te', 'Telugu', 'తెలుగు'], ['mr', 'Marathi', 'मराठी'],
  ['et', 'Estonian', 'Eesti'], ['lv', 'Latvian', 'Latviešu'],
  ['lt', 'Lithuanian', 'Lietuvių'], ['is', 'Icelandic', 'Íslenska'],
].map(([code, name, native]) => ({ code, name, native }));
export const DEFAULT_LANGUAGES = ['Turkish', 'English', 'Russian', 'French'];
const key = value => String(value || '').replace(/^[\p{Emoji_Presentation}\uFE0F\s]+/u, '').trim().toLocaleLowerCase('en');
const aliases = new Map(LANGUAGE_CATALOG.flatMap(language =>
  [language.code, language.name, language.native].map(alias => [key(alias), language.name])));
export function canonicalLanguage(value) {
  return aliases.get(key(value)) || String(value || '').trim();
}
export function activeLanguages(saved) {
  if (!Array.isArray(saved)) return [...DEFAULT_LANGUAGES];
  return [...new Set(saved.filter(value => typeof value === 'string').map(canonicalLanguage).filter(Boolean))];
}
export function languageCatalogMatches(language, search) {
  return [language.code, language.name, language.native].some(value => key(value).includes(key(search)));
}
