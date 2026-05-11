// Extract Worker - extracts structured data from documents
// Short-lived one-shot worker

import { readFile } from 'fs/promises';

export interface ExtractWorkerConfig {
  extractorType: 'pdf' | 'image' | 'doc' | 'email' | 'structured';
}

export interface ExtractedEntities {
  people: string[];
  companies: string[];
  locations: string[];
  dates: string[];
  amounts: Array<{ value: number; currency: string }>;
  emails: string[];
  urls: string[];
}

export interface ExtractionResult {
  content: string;
  entities: ExtractedEntities;
  summary: string;
  confidence: number;
  metadata: {
    documentType: string;
    language?: string;
    pageCount?: number;
  };
}

export interface DossierData {
  id: string;
  type: 'person' | 'company' | 'document' | 'event';
  primaryEntity: string;
  source: {
    archivePath: string;
    documentType: string;
  };
  content: {
    text: string;
    summary: string;
    entities: ExtractedEntities;
  };
}

// Detect document type from path
export function detectDocumentType(path: string): { type: string; specialty: string } {
  const lower = path.toLowerCase();
  
  if (lower.endsWith('.pdf')) {
    return { type: 'pdf', specialty: 'pdf-extract' };
  }
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif')) {
    return { type: 'image', specialty: 'image-ocr' };
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    return { type: 'doc', specialty: 'doc-extract' };
  }
  if (lower.endsWith('.eml') || lower.endsWith('.msg')) {
    return { type: 'email', specialty: 'email-extract' };
  }
  if (lower.endsWith('.json') || lower.endsWith('.xml') || lower.endsWith('.csv')) {
    return { type: 'structured', specialty: 'structured-extract' };
  }
  
  return { type: 'unknown', specialty: 'pdf-extract' };
}

export class ExtractWorker {
  readonly id: string;
  readonly specialty: string;
  
  private documentType: string;
  private archivePath?: string;
  private content?: string;

  constructor(id: string, config: ExtractWorkerConfig) {
    this.id = id;
    this.specialty = config.extractorType === 'unknown' ? 'pdf-extract' : `${config.extractorType}-extract`;
    this.documentType = config.extractorType;
  }

  // Extract from archive path
  async extractFromArchive(path: string): Promise<ExtractionResult> {
    this.archivePath = path;
    const typeInfo = detectDocumentType(path);
    this.documentType = typeInfo.type;
    this.specialty = typeInfo.specialty;

    try {
      const data = await readFile(path);

      switch (this.documentType) {
        case 'pdf':
          return this.extractPdf(data);
        case 'image':
          return this.extractImage(data);
        case 'doc':
          return this.extractDoc(data);
        case 'email':
          return this.extractEmail(data);
        case 'structured':
          return this.extractStructured(data);
        default:
          return this.extractGeneric(data);
      }
    } catch (error) {
      throw new Error(`Failed to extract from ${path}: ${error}`);
    }
  }

  // PDF extraction (simplified - real implementation would use pdf-parse)
  private async extractPdf(data: Uint8Array): Promise<ExtractionResult> {
    // In production, use pdf-parse or similar
    // For now, try to extract text from raw PDF
    const text = this.extractTextFromBytes(data);
    
    return {
      content: text,
      entities: this.extractEntities(text),
      summary: this.generateSummary(text),
      confidence: text.length > 100 ? 0.8 : 0.5,
      metadata: {
        documentType: 'pdf',
        pageCount: this.estimatePageCount(text),
      },
    };
  }

  // Image OCR (simplified - real implementation would use Tesseract)
  private async extractImage(data: Uint8Array): Promise<ExtractionResult> {
    // In production, use Tesseract.js or cloud OCR
    // For now, return placeholder
    return {
      content: '[OCR content would go here - image size: ' + data.length + ' bytes]',
      entities: { people: [], companies: [], locations: [], dates: [], amounts: [], emails: [], urls: [] },
      summary: 'Image content (OCR not available in this implementation)',
      confidence: 0.3,
      metadata: {
        documentType: 'image',
        language: 'unknown',
      },
    };
  }

  // Doc extraction (simplified)
  private async extractDoc(data: Uint8Array): Promise<ExtractionResult> {
    const text = this.extractTextFromBytes(data);
    
    return {
      content: text,
      entities: this.extractEntities(text),
      summary: this.generateSummary(text),
      confidence: 0.7,
      metadata: {
        documentType: 'doc',
      },
    };
  }

  // Email extraction
  private async extractEmail(data: Uint8Array): Promise<ExtractionResult> {
    const text = this.extractTextFromBytes(data);
    
    return {
      content: text,
      entities: this.extractEntities(text),
      summary: this.generateSummary(text),
      confidence: 0.9,
      metadata: {
        documentType: 'email',
      },
    };
  }

  // Structured data extraction
  private async extractStructured(data: Uint8Array): Promise<ExtractionResult> {
    const text = new TextDecoder().decode(data);
    
    // Try JSON parsing
    try {
      const parsed = JSON.parse(text);
      return {
        content: JSON.stringify(parsed, null, 2),
        entities: this.extractEntities(JSON.stringify(parsed)),
        summary: `Extracted ${Object.keys(parsed).length} fields from structured data`,
        confidence: 1.0,
        metadata: {
          documentType: 'structured',
        },
      };
    } catch {
      // Fall back to text extraction
      return {
        content: text,
        entities: this.extractEntities(text),
        summary: 'Extracted from structured file',
        confidence: 0.8,
        metadata: {
          documentType: 'structured',
        },
      };
    }
  }

  // Generic extraction
  private async extractGeneric(data: Uint8Array): Promise<ExtractionResult> {
    const text = this.extractTextFromBytes(data);
    
    return {
      content: text,
      entities: this.extractEntities(text),
      summary: this.generateSummary(text),
      confidence: 0.5,
      metadata: {
        documentType: 'unknown',
      },
    };
  }

  // Extract readable text from bytes (simple UTF-8 extraction)
  private extractTextFromBytes(data: Uint8Array): string {
    try {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
      // Filter out non-printable characters and control codes
      return text
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50000); // Limit to 50k chars
    } catch {
      return '[Binary content - extraction not available]';
    }
  }

  // Extract named entities using simple patterns
  private extractEntities(text: string): ExtractedEntities {
    return {
      // Email addresses
      emails: text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [],
      
      // URLs
      urls: text.match(/https?:\/\/[^\s]+/g) || [],
      
      // Dates (various formats)
      dates: text.match(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}/gi) || [],
      
      // Money amounts
      amounts: (text.match(/\$\d[\d,]+(?:\.\d{2})?|\d[\d,]+\.\d{2} (?:USD|EUR|GBP)/gi) || []).map(m => {
        const match = m.match(/(\d[\d,]*\.?\d*)\s*(USD|EUR|GBP|\$)/);
        return match ? { value: parseFloat(match[1].replace(',', '')), currency: match[2] === '$' ? 'USD' : match[2] } : { value: 0, currency: 'USD' };
      }),
      
      // People (capitalized words that look like names - simplified)
      people: this.extractPotentialNames(text),
      
      // Companies (words followed by Inc, Corp, LLC, etc.)
      companies: text.match(/(?:[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)\s+(?:Inc\.?|Corp\.?|LLC|Ltd\.?|Company|Co\.?)/g) || [],
      
      // Locations (simple pattern)
      locations: text.match(/(?:in|at|located)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g)?.map(m => m.replace(/^(?:in|at|located)\s+/i, '')) || [],
    };
  }

  // Extract potential person names (very simplified)
  private extractPotentialNames(text: string): string[] {
    // Look for patterns like "Firstname Lastname"
    const potentialNames: string[] = [];
    const namePattern = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;
    let match;
    while ((match = namePattern.exec(text)) !== null) {
      const name = match[0];
      // Filter out common words that might match
      if (!['The Company', 'This Document', 'This Agreement'].includes(name)) {
        potentialNames.push(name);
      }
    }
    return [...new Set(potentialNames)].slice(0, 10); // Dedupe and limit
  }

  // Generate summary
  private generateSummary(text: string): string {
    const firstFewLines = text.split('\n').slice(0, 5).join(' ');
    if (firstFewLines.length > 200) {
      return firstFewLines.slice(0, 200) + '...';
    }
    return firstFewLines;
  }

  // Estimate page count from text length
  private estimatePageCount(text: string): number {
    const avgCharsPerPage = 3000;
    return Math.max(1, Math.ceil(text.length / avgCharsPerPage));
  }

  // Get worker stats
  getStats(): { documentType: string; specialty: string; archivePath?: string } {
    return {
      documentType: this.documentType,
      specialty: this.specialty,
      archivePath: this.archivePath,
    };
  }
}

// Factory for creating extract workers
export function createExtractWorker(
  id: string,
  documentType: string
): ExtractWorker {
  return new ExtractWorker(id, {
    extractorType: documentType as ExtractWorkerConfig['extractorType'],
  });
}