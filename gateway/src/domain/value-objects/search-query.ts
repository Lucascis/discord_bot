/**
 * Search Query Value Object
 * Represents a validated music search query
 */
export class SearchQuery {
  private readonly _value: string;

  constructor(value: string) {
    if (!value || typeof value !== 'string') {
      throw new Error('Search query must be a non-empty string');
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error('Search query cannot be empty or only whitespace');
    }

    if (trimmed.length > 500) {
      throw new Error('Search query cannot exceed 500 characters');
    }

    // Basic sanitization - remove potentially dangerous characters
    if (/[<>'"&]/.test(trimmed)) {
      throw new Error('Search query contains invalid characters');
    }

    this._value = trimmed;
  }

  get value(): string {
    return this._value;
  }

  get isUrl(): boolean {
    return /^https?:\/\//.test(this._value);
  }

  get isYouTubeUrl(): boolean {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(this._value);
  }

  get isSpotifyUrl(): boolean {
    return /^https?:\/\/open\.spotify\.com/.test(this._value);
  }

  equals(other: SearchQuery): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  static from(value: string): SearchQuery {
    return new SearchQuery(value);
  }
}