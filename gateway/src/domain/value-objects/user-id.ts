/**
 * User ID Value Object
 * Represents a Discord User ID with validation
 */
export class UserId {
  private readonly _value: string;

  constructor(value: string) {
    if (!value || typeof value !== 'string') {
      throw new Error('User ID must be a non-empty string');
    }

    if (!/^\d{17,19}$/.test(value)) {
      throw new Error('User ID must be a valid Discord snowflake (17-19 digits)');
    }

    this._value = value;
  }

  get value(): string {
    return this._value;
  }

  equals(other: UserId): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  static from(value: string): UserId {
    return new UserId(value);
  }
}