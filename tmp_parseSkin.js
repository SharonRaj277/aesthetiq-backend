const fs = require('fs');

const content = fs.readFileSync('C:/Users/Sharon raj/.gemini/antigravity/brain/31ef487b-62f5-40a0-820e-a0ec36ce9be2/.system_generated/steps/214/content.md', 'utf8');

const lines = content.split('\n');
const treatments = [];
let idCounter = 1;

for (const line of lines) {
  // skip headers, empty lines or non-data lines
  if (!line.trim() || line.startsWith('Source:') || line.startsWith('---') || line.includes(',,,,,,,,,,')) {
    continue;
  }
  
  // CSV regex parsing to handle quotes
  const regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g;
  const cols = [];
  let match;
  while ((match = regex.exec(line)) !== null) {
      cols.push(match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2]);
  }
  
  // Clean up empty items at the end
  while (cols.length > 0 && !cols[cols.length-1]) cols.pop();

  if (cols.length < 9) continue;

  let [idCol, sku, name, subName, category, subCategory, type, tier, priceStr, description] = cols;
  
  if (!priceStr || !priceStr.includes('₹')) continue;

  const priceInt = parseInt(priceStr.replace(/[^0-9]/g, ''), 10);
  
  treatments.push({
    id: idCounter++,
    sku: sku || '',
    name: subName || '',
    displayName: name || '',
    category: category || '',
    subCategory: subCategory || '',
    procedureType: type || '',
    tier: tier || '',
    price: priceInt,
    description: description || ''
  });
}

// Generate models
const categories = [...new Set(treatments.map(t => t.category))].map(c => `  | '${c}'`).join('\n');

const modelCode = `export type SkinTreatmentCategory = \n${categories};\n
export type SkinTreatmentTier = 'Entry' | 'Core' | 'Premium' | 'Signature' | 'Surgical';

export interface SkinTreatmentCatalogueItem {
  id: number;
  sku: string;
  name: string;
  displayName: string;
  category: SkinTreatmentCategory;
  subCategory: string;
  procedureType: string;
  tier: SkinTreatmentTier;
  price: number; // in INR
  description: string;
}
`;

fs.mkdirSync('functions/src/skin/models', { recursive: true });
fs.writeFileSync('functions/src/skin/models/SkinTreatment.ts', modelCode);

const configCode = `import { SkinTreatmentCatalogueItem } from '../models/SkinTreatment';

export const SKIN_TREATMENTS: SkinTreatmentCatalogueItem[] = ${JSON.stringify(treatments, null, 2)};
`;

fs.mkdirSync('functions/src/skin/config', { recursive: true });
fs.writeFileSync('functions/src/skin/config/treatments.ts', configCode);

console.log('Successfully generated skin treatments config with ' + treatments.length + ' items.');
