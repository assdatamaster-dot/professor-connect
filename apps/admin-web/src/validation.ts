export interface PasswordCheck {
  readonly valid: boolean;
  readonly message: string;
}

export function validatePassword(value: string): PasswordCheck {
  if (value.length < 12) return { valid: false, message: 'Use pelo menos 12 caracteres' };
  if (!/[A-Z]/.test(value)) return { valid: false, message: 'Inclua uma letra maiúscula' };
  if (!/[a-z]/.test(value)) return { valid: false, message: 'Inclua uma letra minúscula' };
  if (!/\d/.test(value)) return { valid: false, message: 'Inclua um número' };
  if (!/[^A-Za-z0-9]/.test(value)) {
    return { valid: false, message: 'Inclua um caractere especial' };
  }
  return { valid: true, message: 'Senha segura' };
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function createSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}
