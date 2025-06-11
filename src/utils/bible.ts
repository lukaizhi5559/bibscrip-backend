// Bible verse fetching utility using Scripture API Bible
import { logger } from './logger';
import { BibleVerseCache } from '../services/bibleVerseCache';

// Types for Bible API responses
export interface BibleVerse {
  reference: string;
  text: string;
  translation: string;
  translationName: string;
  book: string;
  chapter: number;
  verse: string | number;
  copyright?: string;
}

export interface TranslationInfo {
  id: string;
  name: string;
  abbreviation: string;
  language: string;
  description?: string;
}

// BibleVerse is already exported above

/**
 * Get a Bible verse from Scripture API Bible
 * @param reference The verse reference (e.g., "John 3:16")
 * @param translation The Bible translation to use (e.g., "NIV")
 * @returns The Bible verse data or null if not found
 */
export async function getBibleVerse(
  reference: string, 
  translation: string = 'NIV'
): Promise<BibleVerse | null> {
  try {
    // Step 0: Check cache first
    const cachedVerse = await BibleVerseCache.get(reference, translation);
    if (cachedVerse) {
      return cachedVerse;
    }
    
    // Check if we've exceeded our rate limits
    const withinLimits = await BibleVerseCache.checkRateLimits();
    if (!withinLimits) {
      logger.warn('Bible API rate limit reached, falling back to free alternative or error message');
      // Here we could implement fallback to free Bible API or return a friendly error
      // For now, we'll error out
      return null;
    }
    
    const apiKey = process.env.BIBLE_API_KEY;
    
    if (!apiKey) {
      logger.error('Bible API key not configured');
      return null;
    }
    
    // Step 1: Parse the reference to get book, chapter, and verse parts
    const { parsedReference, isRange } = parseVerseReference(reference);
    
    // Step 2: Get the Bible ID for the translation
    const bibleId = getBibleId(translation);
    
    // Step 3: Build the API URL based on whether this is a single verse or range
    let apiUrl: string;
    let response;
    
    if (isRange) {
      // For a range or multiple verses, use the passages endpoint
      apiUrl = `https://api.scripture.api.bible/v1/bibles/${bibleId}/passages/${encodeURIComponent(parsedReference)}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`;
    } else {
      // For a single verse, use the verses endpoint
      apiUrl = `https://api.scripture.api.bible/v1/bibles/${bibleId}/search?query=${encodeURIComponent(parsedReference)}&sort=relevance`;
    }
    
    // Increment the API counter before making the request
    await BibleVerseCache.incrementApiCounter();
    
    // Step 4: Make the API request
    response = await fetch(apiUrl, {
      headers: {
        'api-key': apiKey
      }
    });
    
    if (!response.ok) {
      logger.error(`Bible API error: ${response.status} ${response.statusText}`, {
        reference,
        translation,
        statusCode: response.status
      });
      // Return a placeholder verse with error information instead of null
      // This will allow the frontend to still display the AI response
      return {
        reference: reference,
        text: `[Unable to retrieve verse due to API error: ${response.status}]`,
        translation: translation,
        translationName: translation,
        book: reference.split(' ')[0],
        chapter: parseInt(reference.split(' ')[1]?.split(':')[0] || '1', 10),
        verse: reference.split(':')[1] || '1',
        copyright: 'API Error'
      };
    }
    
    const data = await response.json();
    
    // Step 5: Process the response based on the endpoint used
    let verse;
    if (isRange) {
      // Handle passage response
      if (data?.data?.content) {
        verse = {
          reference: data.data.reference,
          text: cleanPassageText(data.data.content),
          translation,
          translationName: data.data.bibleId || translation,
          book: data.data.bookId,
          chapter: parseInt(data.data.chapterIds?.[0] || '1', 10),
          verse: data.data.verseCount > 1 ? `${data.data.verseRanges}` : data.data.verseRanges,
          copyright: data.data.copyright
        };
      }
    } else {
      // Handle search response
      if (data?.data?.verses && data.data.verses.length > 0) {
        const firstVerse = data.data.verses[0];
        verse = {
          reference: firstVerse.reference,
          text: firstVerse.text,
          translation,
          translationName: data.data.bibleId || translation,
          book: firstVerse.bookId,
          chapter: parseInt(firstVerse.chapterId, 10),
          verse: firstVerse.verseId
        };
      }
    }
    
    if (!verse) {
      logger.error('No verse found in Bible API response', { reference, translation });
      return null;
    }
    
    // Store the verse in cache for future use
    await BibleVerseCache.store(reference, translation, verse);
    
    return verse;
  } catch (error) {
    logger.error('Error fetching Bible verse:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      reference,
      translation 
    });
    return null;
  }
}

/**
 * Get multiple Bible verses in a range or list
 * @param reference The verse reference range (e.g., "John 3:16-18" or "Romans 8:28,31,38-39")
 * @param translation The Bible translation to use
 */
export async function getBiblePassage(
  reference: string,
  translation: string = 'NIV'
): Promise<BibleVerse | null> {
  try {
    // This is a specialized case of getBibleVerse that's optimized for passages
    return await getBibleVerse(reference, translation);
  } catch (error) {
    logger.error('Error fetching Bible passage:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      reference,
      translation 
    });
    return null;
  }
}

/**
 * Get an entire chapter from the Bible
 * @param book Bible book (e.g., "John", "Psalms", "1 Corinthians")
 * @param chapter Chapter number
 * @param translation The Bible translation to use
 */
export async function getBibleChapter(
  book: string,
  chapter: number,
  translation: string = 'NIV'
): Promise<BibleVerse | null> {
  try {
    // Format the reference for cache lookup
    const reference = `${book} ${chapter}`;
    
    // Step 0: Check cache first
    const cachedVerse = await BibleVerseCache.get(reference, translation);
    if (cachedVerse) {
      return cachedVerse;
    }
    
    // Check if we've exceeded our rate limits
    const withinLimits = await BibleVerseCache.checkRateLimits();
    if (!withinLimits) {
      logger.warn('Bible API rate limit reached, falling back to free alternative or error message');
      return null;
    }
    
    const apiKey = process.env.BIBLE_API_KEY;
    
    if (!apiKey) {
      logger.error('Bible API key not configured');
      return null;
    }
    
    // Get the Bible ID for the translation
    const bibleId = getBibleId(translation);
    
    // Normalize book name to API format
    const normalizedBook = normalizeBookName(book);
    
    // Use the chapters endpoint directly
    const apiUrl = `https://api.scripture.api.bible/v1/bibles/${bibleId}/chapters/${normalizedBook}.${chapter}?content-type=text&include-notes=false&include-titles=true&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`;
    
    // Increment the API counter before making the request
    await BibleVerseCache.incrementApiCounter();
    
    // Make the API request
    const response = await fetch(apiUrl, {
      headers: {
        'api-key': apiKey
      }
    });
    
    if (!response.ok) {
      logger.error(`Bible API error: ${response.status} ${response.statusText}`, {
        book,
        chapter,
        translation,
        statusCode: response.status
      });
      // Return a placeholder chapter with error information instead of null
      // This will allow the frontend to still display the AI response
      return {
        reference: `${book} ${chapter}`,
        text: `[Unable to retrieve chapter due to API error: ${response.status}]`,
        translation: translation,
        translationName: translation,
        book: book,
        chapter: chapter,
        verse: '1-end',
        copyright: 'API Error'
      };
    }
    
    const data = await response.json();
    
    // Process the chapter response
    let verse;
    if (data?.data?.content) {
      verse = {
        reference: data.data.reference || `${book} ${chapter}`,
        text: cleanPassageText(data.data.content),
        translation,
        translationName: data.data.bibleId || translation,
        book: data.data.bookId || book,
        chapter: chapter,
        verse: '1-999', // Representing full chapter
        copyright: data.data.copyright
      };
    }
    
    if (!verse) {
      logger.error('No chapter data found in Bible API response', { book, chapter, translation });
      return null;
    }
    
    // Store the verse in cache for future use
    await BibleVerseCache.store(reference, translation, verse);
    
    return verse;
  } catch (error) {
    logger.error('Error fetching Bible chapter:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      book,
      chapter,
      translation 
    });
    return null;
  }
}

/**
 * Get multiple chapters from the Bible
 * @param book Bible book 
 * @param startChapter Starting chapter number
 * @param endChapter Ending chapter number (inclusive)
 * @param translation The Bible translation to use
 */
export async function getBibleChapters(
  book: string,
  startChapter: number,
  endChapter: number,
  translation: string = 'NIV'
): Promise<BibleVerse | null> {
  if (startChapter > endChapter) {
    logger.error('Invalid chapter range', { startChapter, endChapter });
    return null;
  }
  
  try {
    // Format the reference as "Book StartChapter-EndChapter" (e.g., "Psalms 1-3")
    const reference = `${book} ${startChapter}-${endChapter}`;
    return await getBibleVerse(reference, translation);
  } catch (error) {
    logger.error('Error fetching Bible chapters:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      book,
      startChapter,
      endChapter,
      translation 
    });
    return null;
  }
}

/**
 * Parse a verse reference into its component parts
 */
function parseVerseReferenceParts(reference: string): { book: string; chapter: number; verse: string | number } {
  // Handle complex references like "John 3:16" or "1 John 2:3-5"
  const parts = reference.trim().split(' ');
  
  let book: string;
  let chapterVerse: string;
  
  // Check if it starts with a number like "1 John" or "2 Timothy"
  if (parts.length > 2 && /^\d+$/.test(parts[0])) {
    book = `${parts[0]} ${parts[1]}`;
    chapterVerse = parts.slice(2).join(' ');
  } else {
    book = parts[0];
    chapterVerse = parts.slice(1).join(' ');
  }
  
  // Split chapter and verse
  const [chapterStr, verseStr] = chapterVerse.split(':');
  const chapter = parseInt(chapterStr, 10);
  
  // Handle verse ranges like "3-5" or "3,5-7"
  const verse = verseStr;
  
  return { book, chapter, verse };
}

/**
 * Parse and normalize a verse reference for API lookup
 */
function parseVerseReference(reference: string): { parsedReference: string; isRange: boolean } {
  const trimmedRef = reference.trim();
  
  // Check if the reference contains range indicators or is chapter-only reference
  // A reference with only book and chapter (no verse) should be treated as a range
  const isChapterReference = !/:\d+/.test(trimmedRef); // No verse number specified
  const hasRangeIndicators = /[-,]/.test(trimmedRef);
  const isRange = isChapterReference || hasRangeIndicators;
  
  // Return the processed reference
  return { 
    parsedReference: trimmedRef, 
    isRange 
  };
}

/**
 * Clean passage text from API response formatting
 */
function cleanPassageText(text: string): string {
  return text
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize book name to API format
 * Handles special cases and standardizes book names
 */
function normalizeBookName(book: string): string {
  // First normalize spacing and casing
  const normalized = book.trim();
  
  // Handle books that start with a number (e.g., "1 John" -> "1JN")
  const bookAbbreviations: Record<string, string> = {
    'genesis': 'GEN',
    'exodus': 'EXO',
    'leviticus': 'LEV',
    'numbers': 'NUM',
    'deuteronomy': 'DEU',
    'joshua': 'JOS',
    'judges': 'JDG',
    'ruth': 'RUT',
    '1 samuel': '1SA',
    'i samuel': '1SA',
    '1st samuel': '1SA',
    'first samuel': '1SA',
    '2 samuel': '2SA',
    'ii samuel': '2SA',
    '2nd samuel': '2SA',
    'second samuel': '2SA',
    '1 kings': '1KI',
    'i kings': '1KI',
    '1st kings': '1KI',
    'first kings': '1KI',
    '2 kings': '2KI',
    'ii kings': '2KI',
    '2nd kings': '2KI',
    'second kings': '2KI',
    '1 chronicles': '1CH',
    'i chronicles': '1CH',
    '1st chronicles': '1CH',
    'first chronicles': '1CH',
    '2 chronicles': '2CH',
    'ii chronicles': '2CH',
    '2nd chronicles': '2CH',
    'second chronicles': '2CH',
    'ezra': 'EZR',
    'nehemiah': 'NEH',
    'esther': 'EST',
    'job': 'JOB',
    'psalm': 'PSA',
    'psalms': 'PSA',
    'proverbs': 'PRO',
    'ecclesiastes': 'ECC',
    'song of solomon': 'SNG',
    'song of songs': 'SNG',
    'isaiah': 'ISA',
    'jeremiah': 'JER',
    'lamentations': 'LAM',
    'ezekiel': 'EZK',
    'daniel': 'DAN',
    'hosea': 'HOS',
    'joel': 'JOL',
    'amos': 'AMO',
    'obadiah': 'OBA',
    'jonah': 'JON',
    'micah': 'MIC',
    'nahum': 'NAM',
    'habakkuk': 'HAB',
    'zephaniah': 'ZEP',
    'haggai': 'HAG',
    'zechariah': 'ZEC',
    'malachi': 'MAL',
    'matthew': 'MAT',
    'mark': 'MRK',
    'luke': 'LUK',
    'john': 'JHN',
    'acts': 'ACT',
    'romans': 'ROM',
    '1 corinthians': '1CO',
    'i corinthians': '1CO',
    '1st corinthians': '1CO',
    'first corinthians': '1CO',
    '2 corinthians': '2CO',
    'ii corinthians': '2CO',
    '2nd corinthians': '2CO',
    'second corinthians': '2CO',
    'galatians': 'GAL',
    'ephesians': 'EPH',
    'philippians': 'PHP',
    'colossians': 'COL',
    '1 thessalonians': '1TH',
    'i thessalonians': '1TH',
    '1st thessalonians': '1TH',
    'first thessalonians': '1TH',
    '2 thessalonians': '2TH',
    'ii thessalonians': '2TH',
    '2nd thessalonians': '2TH',
    'second thessalonians': '2TH',
    '1 timothy': '1TI',
    'i timothy': '1TI',
    '1st timothy': '1TI',
    'first timothy': '1TI',
    '2 timothy': '2TI',
    'ii timothy': '2TI',
    '2nd timothy': '2TI',
    'second timothy': '2TI',
    'titus': 'TIT',
    'philemon': 'PHM',
    'hebrews': 'HEB',
    'james': 'JAS',
    '1 peter': '1PE',
    'i peter': '1PE',
    '1st peter': '1PE',
    'first peter': '1PE',
    '2 peter': '2PE',
    'ii peter': '2PE',
    '2nd peter': '2PE',
    'second peter': '2PE',
    '1 john': '1JN',
    'i john': '1JN',
    '1st john': '1JN',
    'first john': '1JN',
    '2 john': '2JN',
    'ii john': '2JN',
    '2nd john': '2JN',
    'second john': '2JN',
    '3 john': '3JN',
    'iii john': '3JN',
    '3rd john': '3JN',
    'third john': '3JN',
    'jude': 'JUD',
    'revelation': 'REV',
    'revelations': 'REV'
  };
  
  // First check for exact match
  const lowerCaseBook = normalized.toLowerCase();
  if (bookAbbreviations[lowerCaseBook]) {
    return bookAbbreviations[lowerCaseBook];
  }
  
  // If not found, try to find closest match
  for (const [bookName, abbreviation] of Object.entries(bookAbbreviations)) {
    if (lowerCaseBook.includes(bookName) || bookName.includes(lowerCaseBook)) {
      return abbreviation;
    }
  }
  
  // If no match found, return the input as is - API will handle the error
  return normalized;
}

/**
 * Get the Bible ID for a given translation
 * Maps common abbreviations to Bible API-specific IDs
 */
// Store cache of Bible IDs fetched from the API
const bibleIdCache: Record<string, string> = {};

function getBibleId(translation: string): string {
  // First check if we already have this translation in the runtime cache
  const translationKey = translation.toUpperCase();
  if (bibleIdCache[translationKey]) {
    return bibleIdCache[translationKey];
  }

  const translationMap: Record<string, string> = {
    // English translations
    'NIV': '78a9f6124f344018-01', // New International Version
    'ESV': '9879dbb7cfe39e4d-02', // English Standard Version (updated)
    'KJV': 'de4e12af7f28f599-01', // King James Version
    'NKJV': '04da588535d2c98c-01', // New King James Version
    'NLT': '65eec8e0b60e656b-01', // New Living Translation (updated)
    'NASB': '97c504839b0d1ac4-01', // New American Standard Bible
    'AMP': '08a9b187e4a5322b-01', // Amplified Bible (added)
    'CSB': '5efad392d777ddfe-01', // Christian Standard Bible (added)
    'MSG': '65eec8e0b60e656b-02', // The Message (added)
    
    // Spanish translations
    'RVR': '592420522e16049f-01', // Reina-Valera 1960
    'NVI': 'b32b9d1b64b4ef29-01', // Nueva Versión Internacional
    
    // French translations
    'LSG': '8f5d8c7e4d0c4fcd-01', // Louis Segond 1910
    'NEG': '56a88bbc7f70d881-01', // Nouvelle Edition de Genève
    
    // German translations
    'LUT': '5e77c8eae61c027c-01', // Luther Bibel 2017 (updated)
    'ELB': 'd67b37351d8a0a15-01', // Elberfelder Bibel
    
    // Chinese translations
    'CUV': 'c1f528a7c30d361c-01', // Chinese Union Version (Traditional)
    'CUVS': '7b7bca9be5e2b6c8-01', // Chinese Union Version (Simplified)
    
    // Korean translations
    'KRV': 'f9a1d7c8103a4161-01', // Korean Revised Version
    
    // Portuguese translations
    'ARC': '82b10eae12717be2-01', // Almeida Revista e Corrigida
    'NVI-PT': 'cf1061bf9b1f3229-01', // Nova Versão Internacional (Portuguese)
    
    // Russian translations
    'RUSV': '2995b51a50c3cb31-01', // Russian Synodal Version
    'NRT': '81c2a4bc8667d380-01', // New Russian Translation
    
    // Arabic translations
    'NAV': 'b17e246951402e50-01', // New Arabic Version
    
    // Japanese translations
    'JCB': '7142879509583d59-01', // Japanese Contemporary Bible
    
    // Other common translations
    'VULGATE': 'acf72a5e1eba1984-01', // Latin Vulgate
    'LXX': 'f89195345bd3484c-01' // Septuagint (Greek)
  };
  
  // Store result in the cache for next time
  const result = translationMap[translation.toUpperCase()] || translationMap['NIV'];
  bibleIdCache[translation.toUpperCase()] = result;
  
  return result;
}

/**
 * Fetch available Bible translations from the API
 * This can be used to verify and update Bible IDs
 */
export async function fetchBibleIds(): Promise<void> {
  try {
    const apiKey = process.env.BIBLE_API_KEY;
    
    if (!apiKey) {
      logger.error('Bible API key not configured');
      return;
    }
    
    const response = await fetch('https://api.scripture.api.bible/v1/bibles', {
      headers: {
        'api-key': apiKey
      }
    });
    
    if (!response.ok) {
      logger.error(`Failed to fetch Bible IDs: ${response.status} ${response.statusText}`);
      return;
    }
    
    const data = await response.json();
    if (!data?.data || !Array.isArray(data.data)) {
      logger.error('Invalid response format when fetching Bible IDs');
      return;
    }
    
    // Update the cache with fetched Bible IDs
    for (const bible of data.data) {
      if (bible.id && bible.abbreviation) {
        bibleIdCache[bible.abbreviation.toUpperCase()] = bible.id;
        // logger.debug(`Cached Bible ID: ${bible.abbreviation} -> ${bible.id}`);
      }
    }
    
    logger.info(`Fetched and cached ${Object.keys(bibleIdCache).length} Bible IDs from API`);
  } catch (error) {
    logger.error('Error fetching Bible IDs:', { 
      errorMessage: error instanceof Error ? error.message : String(error) 
    });
  }
}

/**
 * Get available Bible translations from the API
 * Provides a list of all available translations with their details
 */
export interface TranslationInfo {
  id: string;
  name: string;
  abbreviation: string;
  language: string;
  description?: string;
}

export async function getAvailableTranslations(): Promise<TranslationInfo[]> {
  try {
    const apiKey = process.env.BIBLE_API_KEY;
    
    if (!apiKey) {
      logger.error('Bible API key not configured');
      return [];
    }
    
    const apiUrl = 'https://api.scripture.api.bible/v1/bibles';
    
    const response = await fetch(apiUrl, {
      headers: {
        'api-key': apiKey
      }
    });
    
    if (!response.ok) {
      logger.error(`Bible API error getting translations: ${response.status} ${response.statusText}`);
      return [];
    }
    
    const data = await response.json();
    
    if (data?.data) {
      return data.data.map((bible: any) => ({
        id: bible.id,
        name: bible.name,
        abbreviation: bible.abbreviation || bible.abbreviatedTitle || '',
        language: bible.language?.name || 'Unknown',
        description: bible.description
      }));
    }
    
    return [];
  } catch (error) {
    logger.error('Error fetching Bible translations:', { 
      errorMessage: error instanceof Error ? error.message : String(error) 
    });
    return [];
  }
}
