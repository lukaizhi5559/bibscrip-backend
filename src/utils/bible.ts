// Bible verse fetching utility

// Define the structure of a Bible verse
export interface BibleVerse {
  reference: string;
  text: string;
  translation: string;
  book?: string;
  chapter?: number;
  verse?: number | string;
}

/**
 * Get a Bible verse from an external API
 * @param reference The verse reference (e.g., "John 3:16")
 * @param translation The Bible translation to use (e.g., "NIV")
 * @returns The Bible verse data or null if not found
 */
export async function getBibleVerse(
  reference: string, 
  translation: string = 'NIV'
): Promise<BibleVerse | null> {
  try {
    // Bible API URL
    const apiKey = process.env.BIBLE_API_KEY;
    
    if (!apiKey) {
      console.error('Bible API key not configured');
      return null;
    }
    
    // Format the reference for the API
    const formattedRef = reference.trim().replace(/\s+/g, '+');
    
    // Build the API URL
    const apiUrl = `https://api.scripture.api.bible/v1/bibles/${getBibleId(translation)}/search?query=${formattedRef}`;
    
    // Make the API request
    const response = await fetch(apiUrl, {
      headers: {
        'api-key': apiKey
      }
    });
    
    if (!response.ok) {
      console.error(`Bible API error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    
    // Extract the verse from the response
    if (data && data.data && data.data.verses && data.data.verses.length > 0) {
      const verse = data.data.verses[0];
      
      return {
        reference: verse.reference,
        text: verse.text,
        translation: translation,
        book: verse.reference.split(' ')[0],
        chapter: parseInt(verse.reference.split(' ')[1].split(':')[0], 10),
        verse: verse.reference.split(':')[1]
      };
    }
    
    // Verse not found
    return null;
  } catch (error) {
    console.error('Error fetching Bible verse:', error);
    return null;
  }
}

/**
 * Get the Bible ID for a given translation
 * This would typically map common abbreviations to API-specific IDs
 */
function getBibleId(translation: string): string {
  // Map of translation abbreviations to Bible API IDs
  const translationMap: Record<string, string> = {
    'NIV': '78a9f6124f344018-01', // Example ID, replace with actual
    'ESV': '02b0744a939b011d-01',
    'KJV': 'de4e12af7f28f599-01',
    'NKJV': '04da588535d2c98c-01',
    'NLT': '31a5bcf6651155aa-01',
    'NASB': '97c504839b0d1ac4-01',
    'NRSV': '02dd4456c599a15e-01',
    'MSG': '65eec8e0b60e656b-01',
    'AMP': '08a5330f047700c3-01',
    'CSB': '5efad608-67bb-11ea-b7cd-c36bd6f13023',
    'WEB': '9879dbb7cfe39e4d-01'
  };
  
  // Return the ID for the requested translation or default to NIV
  return translationMap[translation] || translationMap['NIV'];
}
