// Ingest Worker - downloads and archives documents
// Short-lived one-shot worker

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

export interface IngestWorkerConfig {
  archivePath: string;
  maxSize?: number; // bytes, default 50MB
}

export interface IngestResult {
  archivePath: string;
  metadata: {
    url: string;
    contentType: string;
    size: number;
    downloadedAt: Date;
    filename?: string;
    hash: string;
  };
}

export interface IngestTask {
  url: string;
  typeHint?: 'pdf' | 'image' | 'html' | 'doc' | 'unknown';
  options?: {
    filename?: string;
    headers?: Record<string, string>;
  };
}

// Content type detection from URL/headers
export function detectContentType(url: string, contentType?: string): { type: string; extension: string; specialty: string } {
  if (contentType) {
    if (contentType.includes('pdf')) {
      return { type: 'application/pdf', extension: '.pdf', specialty: 'pdf-handler' };
    }
    if (contentType.includes('image')) {
      const ext = contentType.includes('png') ? '.png' : '.jpg';
      return { type: contentType, extension: ext, specialty: 'image-handler' };
    }
    if (contentType.includes('html')) {
      return { type: 'text/html', extension: '.html', specialty: 'url-handler' };
    }
    if (contentType.includes('word') || contentType.includes('docx')) {
      return { type: contentType, extension: '.docx', specialty: 'url-handler' };
    }
  }

  // Detect from URL
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf') || lower.includes('pdf')) {
    return { type: 'application/pdf', extension: '.pdf', specialty: 'pdf-handler' };
  }
  if (lower.endsWith('.png')) {
    return { type: 'image/png', extension: '.png', specialty: 'image-handler' };
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return { type: 'image/jpeg', extension: '.jpg', specialty: 'image-handler' };
  }
  if (lower.endsWith('.gif')) {
    return { type: 'image/gif', extension: '.gif', specialty: 'image-handler' };
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return { type: 'text/html', extension: '.html', specialty: 'url-handler' };
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    return { type: 'application/msword', extension: '.doc', specialty: 'url-handler' };
  }

  return { type: 'application/octet-stream', extension: '.bin', specialty: 'url-handler' };
}

export class IngestWorker {
  readonly id: string;
  readonly specialty: string;
  readonly archivePath: string;
  
  private maxSize: number;
  private downloadedData?: Uint8Array;
  private hash?: string;

  constructor(id: string, config: IngestWorkerConfig) {
    this.id = id;
    this.specialty = 'url-handler';
    this.archivePath = config.archivePath;
    this.maxSize = config.maxSize || 50 * 1024 * 1024; // 50MB default
  }

  // Download and archive content from URL
  async ingestUrl(url: string, typeHint?: string): Promise<IngestResult> {
    const contentTypeInfo = typeHint 
      ? { type: typeHint, extension: `.${typeHint}`, specialty: 'url-handler' }
      : detectContentType(url);
    
    this.specialty = contentTypeInfo.specialty;

    try {
      // In a real implementation, this would use fetch or similar
      // For now, we simulate the download
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Jaensen-Bot/1.0',
          ...contentTypeInfo.type !== 'application/octet-stream' && {
            'Accept': contentTypeInfo.type,
          },
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || contentTypeInfo.type;
      const finalTypeInfo = detectContentType(url, contentType);
      this.specialty = finalTypeInfo.specialty;

      // Check size
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > this.maxSize) {
          throw new Error(`File too large: ${size} bytes (max: ${this.maxSize})`);
        }
      }

      // Download
      const arrayBuffer = await response.arrayBuffer();
      this.downloadedData = new Uint8Array(arrayBuffer);
      this.hash = this.computeHash(this.downloadedData);

      // Generate archive path with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${timestamp}-${this.hash.slice(0, 8)}${finalTypeInfo.extension}`;
      const archivePath = join(this.archivePath, filename);

      // Ensure directory exists
      await mkdir(this.archivePath, { recursive: true });

      // Write to archive
      await writeFile(archivePath, this.downloadedData);

      // Extract filename from URL if available
      const urlParts = url.split('/');
      const suggestedFilename = urlParts[urlParts.length - 1].split('?')[0];

      return {
        archivePath,
        metadata: {
          url,
          contentType: finalTypeInfo.type,
          size: this.downloadedData.length,
          downloadedAt: new Date(),
          filename: suggestedFilename !== url ? suggestedFilename : undefined,
          hash: `sha256:${this.hash}`,
        },
      };
    } catch (error) {
      throw new Error(`Failed to ingest URL: ${error}`);
    }
  }

  // Archive binary content (for email attachments)
  async ingestBinary(content: Uint8Array, metadata: {
    filename?: string;
    contentType?: string;
    source?: string;
  }): Promise<IngestResult> {
    this.downloadedData = content;
    this.hash = this.computeHash(content);

    const contentTypeInfo = metadata.contentType
      ? detectContentType(metadata.filename || '', metadata.contentType)
      : { type: 'application/octet-stream', extension: '.bin', specialty: 'url-handler' };

    this.specialty = contentTypeInfo.specialty;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = contentTypeInfo.extension;
    const filename = metadata.filename || `${timestamp}-${this.hash.slice(0, 8)}${ext}`;
    const archivePath = join(this.archivePath, filename);

    await mkdir(this.archivePath, { recursive: true });
    await writeFile(archivePath, content);

    return {
      archivePath,
      metadata: {
        url: metadata.source || 'binary-upload',
        contentType: contentTypeInfo.type,
        size: content.length,
        downloadedAt: new Date(),
        filename,
        hash: `sha256:${this.hash}`,
      },
    };
  }

  // Get download stats
  getStats(): { size?: number; hash?: string; specialty: string } {
    return {
      size: this.downloadedData?.length,
      hash: this.hash,
      specialty: this.specialty,
    };
  }

  // Compute SHA256 hash
  private computeHash(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
  }
}

// Factory for creating ingest workers
export function createIngestWorker(
  id: string,
  archivePath: string
): IngestWorker {
  return new IngestWorker(id, { archivePath });
}