// Utility for extracting Bible verse references from text

/**
 * Extract Bible verse references from a text string
 * @param text The text to parse for Bible verse references
 * @returns Array of verse references found in the text
 */
export function extractVerseReferences(text: string): string[] {
  if (!text) {
    return [];
  }

  // Common Bible book names and abbreviations
  const bookNames = [
    'Genesis', 'Gen', 'Exodus', 'Exo', 'Exod', 'Leviticus', 'Lev', 
    'Numbers', 'Num', 'Deut', 'Deuteronomy', 'Joshua', 'Josh', 
    'Judges', 'Judg', 'Ruth', '1 Samuel', '1 Sam', '1Sam', '2 Samuel', '2 Sam', '2Sam',
    '1 Kings', '1Kings', '1 Kgs', '2 Kings', '2Kings', '2 Kgs',
    '1 Chronicles', '1 Chron', '1 Chr', '2 Chronicles', '2 Chron', '2 Chr',
    'Ezra', 'Nehemiah', 'Neh', 'Esther', 'Est', 'Job',
    'Psalms', 'Psalm', 'Ps', 'Proverbs', 'Prov', 'Pro',
    'Ecclesiastes', 'Eccl', 'Ecc', 'Song of Solomon', 'Song', 'SOS',
    'Isaiah', 'Isa', 'Jeremiah', 'Jer', 'Lamentations', 'Lam',
    'Ezekiel', 'Ezek', 'Daniel', 'Dan', 'Hosea', 'Hos',
    'Joel', 'Amos', 'Obadiah', 'Obad', 'Jonah', 'Jon', 'Micah', 'Mic',
    'Nahum', 'Nah', 'Habakkuk', 'Hab', 'Zephaniah', 'Zeph',
    'Haggai', 'Hag', 'Zechariah', 'Zech', 'Malachi', 'Mal',
    'Matthew', 'Matt', 'Mark', 'Luke', 'John', 'Jn',
    'Acts', 'Romans', 'Rom', '1 Corinthians', '1 Cor', '1Cor', '2 Corinthians', '2 Cor', '2Cor',
    'Galatians', 'Gal', 'Ephesians', 'Eph', 'Philippians', 'Phil',
    'Colossians', 'Col', '1 Thessalonians', '1 Thess', '1Thess', '2 Thessalonians', '2 Thess', '2Thess',
    '1 Timothy', '1 Tim', '1Tim', '2 Timothy', '2 Tim', '2Tim', 'Titus', 'Philemon', 'Phlm',
    'Hebrews', 'Heb', 'James', 'Jas', '1 Peter', '1 Pet', '1Pet', '2 Peter', '2 Pet', '2Pet',
    '1 John', '1 Jn', '1Jn', '2 John', '2 Jn', '2Jn', '3 John', '3 Jn', '3Jn',
    'Jude', 'Revelation', 'Rev'
  ];

  // Construct the regex pattern for book names
  const bookPattern = bookNames.map(book => book.replace(/\s/g, '\\s?')).join('|');
  
  // Pattern for verse references like "John 3:16" or "John 3:16-18" or "John 3:16,18"
  const versePattern = new RegExp(`(${bookPattern})\\s?(\\d+):(\\d+)(?:[\\-–—]\\d+)?(?:,\\s?\\d+(?:[\\-–—]\\d+)?)*`, 'gi');
  
  const matches = text.match(versePattern) || [];
  
  // Clean up the matches and remove duplicates
  return Array.from(new Set(matches.map(match => match.trim())));
}
