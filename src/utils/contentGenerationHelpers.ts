/**
 * Content Generation Helpers
 * 
 * Utility functions for generating specific types of content
 */

import { contentGenerationService } from '../services/contentGenerationService';

/**
 * Generate content based on field type detection
 */
export async function generateFieldContent(
  fieldDescription: string,
  context?: string
): Promise<string> {
  const fieldLower = fieldDescription.toLowerCase();

  // Name fields
  if (fieldLower.includes('first name') || fieldLower.includes('firstname')) {
    return generateRandomFirstName();
  }
  if (fieldLower.includes('last name') || fieldLower.includes('lastname') || fieldLower.includes('surname')) {
    return generateRandomLastName();
  }
  if (fieldLower.includes('full name') || (fieldLower.includes('name') && !fieldLower.includes('user'))) {
    return `${generateRandomFirstName()} ${generateRandomLastName()}`;
  }

  // Email fields
  if (fieldLower.includes('email') || fieldLower.includes('e-mail')) {
    return generateRandomEmail();
  }

  // Phone fields
  if (fieldLower.includes('phone') || fieldLower.includes('mobile') || fieldLower.includes('cell')) {
    return generateRandomPhone();
  }

  // Address fields
  if (fieldLower.includes('street') || fieldLower.includes('address line')) {
    return generateRandomStreet();
  }
  if (fieldLower.includes('city')) {
    return generateRandomCity();
  }
  if (fieldLower.includes('state') || fieldLower.includes('province')) {
    return generateRandomState();
  }
  if (fieldLower.includes('zip') || fieldLower.includes('postal')) {
    return generateRandomZip();
  }
  if (fieldLower.includes('country')) {
    return 'United States';
  }

  // Company/Organization
  if (fieldLower.includes('company') || fieldLower.includes('organization')) {
    return generateRandomCompany();
  }

  // Job title
  if (fieldLower.includes('job title') || fieldLower.includes('position') || fieldLower.includes('role')) {
    return generateRandomJobTitle();
  }

  // Date fields
  if (fieldLower.includes('date') || fieldLower.includes('birth')) {
    return generateRandomDate();
  }

  // Password fields
  if (fieldLower.includes('password')) {
    return generateSecurePassword();
  }

  // Generic text - use LLM
  return await contentGenerationService.generateFormData('text', fieldDescription, context);
}

/**
 * Generate random first name
 */
function generateRandomFirstName(): string {
  const names = [
    'John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily',
    'James', 'Emma', 'Robert', 'Olivia', 'William', 'Sophia',
    'Daniel', 'Isabella', 'Matthew', 'Ava', 'Christopher', 'Mia',
  ];
  return names[Math.floor(Math.random() * names.length)];
}

/**
 * Generate random last name
 */
function generateRandomLastName(): string {
  const names = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia',
    'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
    'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson',
  ];
  return names[Math.floor(Math.random() * names.length)];
}

/**
 * Generate random email
 */
function generateRandomEmail(): string {
  const firstName = generateRandomFirstName().toLowerCase();
  const lastName = generateRandomLastName().toLowerCase();
  const domains = ['gmail.com', 'outlook.com', 'yahoo.com', 'email.com', 'example.com'];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  
  return `${firstName}.${lastName}@${domain}`;
}

/**
 * Generate random phone number
 */
function generateRandomPhone(): string {
  const areaCode = Math.floor(Math.random() * 900) + 100;
  const prefix = Math.floor(Math.random() * 900) + 100;
  const lineNumber = Math.floor(Math.random() * 9000) + 1000;
  
  return `(${areaCode}) ${prefix}-${lineNumber}`;
}

/**
 * Generate random street address
 */
function generateRandomStreet(): string {
  const number = Math.floor(Math.random() * 9000) + 100;
  const streets = [
    'Main Street', 'Oak Avenue', 'Maple Drive', 'Park Lane', 'Cedar Road',
    'Elm Street', 'Washington Boulevard', 'First Avenue', 'Second Street',
    'Pine Street', 'Lake Drive', 'Hill Road', 'Forest Avenue',
  ];
  return `${number} ${streets[Math.floor(Math.random() * streets.length)]}`;
}

/**
 * Generate random city
 */
function generateRandomCity(): string {
  const cities = [
    'San Francisco', 'New York', 'Los Angeles', 'Chicago', 'Houston',
    'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas',
    'Austin', 'Seattle', 'Denver', 'Boston', 'Portland',
  ];
  return cities[Math.floor(Math.random() * cities.length)];
}

/**
 * Generate random state
 */
function generateRandomState(): string {
  const states = [
    'CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI',
    'NJ', 'VA', 'WA', 'AZ', 'MA', 'TN', 'IN', 'MO', 'MD', 'WI',
  ];
  return states[Math.floor(Math.random() * states.length)];
}

/**
 * Generate random ZIP code
 */
function generateRandomZip(): string {
  return String(Math.floor(Math.random() * 90000) + 10000);
}

/**
 * Generate random company name
 */
function generateRandomCompany(): string {
  const prefixes = ['Tech', 'Global', 'Digital', 'Smart', 'Innovative', 'Advanced'];
  const suffixes = ['Solutions', 'Systems', 'Corporation', 'Inc.', 'Technologies', 'Group'];
  
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  
  return `${prefix} ${suffix}`;
}

/**
 * Generate random job title
 */
function generateRandomJobTitle(): string {
  const titles = [
    'Software Engineer', 'Product Manager', 'Data Analyst', 'Marketing Manager',
    'Sales Representative', 'Project Manager', 'Business Analyst', 'UX Designer',
    'DevOps Engineer', 'Customer Success Manager', 'Account Executive',
  ];
  return titles[Math.floor(Math.random() * titles.length)];
}

/**
 * Generate random date (birth date)
 */
function generateRandomDate(): string {
  const year = Math.floor(Math.random() * 30) + 1970; // 1970-1999
  const month = Math.floor(Math.random() * 12) + 1;
  const day = Math.floor(Math.random() * 28) + 1;
  
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
}

/**
 * Generate secure password
 */
function generateSecurePassword(): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  
  const all = uppercase + lowercase + numbers + special;
  
  let password = '';
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  for (let i = 4; i < 12; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }
  
  // Shuffle password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Detect if query requires content generation
 */
export function requiresContentGeneration(query: string): boolean {
  const queryLower = query.toLowerCase();
  
  const generationKeywords = [
    'type up', 'write', 'compose', 'draft', 'create',
    'generate', 'fill out', 'complete', 'make',
  ];
  
  const contentTypes = [
    'resume', 'cv', 'email', 'letter', 'document', 'essay',
    'report', 'proposal', 'form', 'application', 'message',
  ];
  
  // Check if query contains generation keywords + content types
  const hasGenerationKeyword = generationKeywords.some(keyword => queryLower.includes(keyword));
  const hasContentType = contentTypes.some(type => queryLower.includes(type));
  
  return hasGenerationKeyword && hasContentType;
}

/**
 * Detect if query is for form filling
 */
export function isFormFillQuery(query: string): boolean {
  const queryLower = query.toLowerCase();
  
  const formKeywords = [
    'fill out', 'fill in', 'complete', 'submit',
    'registration', 'signup', 'sign up', 'application',
  ];
  
  const formTypes = [
    'form', 'registration', 'application', 'survey',
    'questionnaire', 'signup', 'sign-up',
  ];
  
  return formKeywords.some(keyword => queryLower.includes(keyword)) ||
         formTypes.some(type => queryLower.includes(type));
}

/**
 * Extract content type from query
 */
export function extractContentType(query: string): string | null {
  const queryLower = query.toLowerCase();
  
  const contentTypes = [
    'resume', 'cv', 'email', 'letter', 'document', 'essay',
    'report', 'proposal', 'message', 'bio', 'description',
  ];
  
  for (const type of contentTypes) {
    if (queryLower.includes(type)) {
      return type;
    }
  }
  
  return null;
}
