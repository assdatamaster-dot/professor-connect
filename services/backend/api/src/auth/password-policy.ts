import { z } from 'zod';

export const securePasswordSchema = z
  .string()
  .min(12, 'A senha deve ter pelo menos 12 caracteres')
  .max(128)
  .regex(/[a-z]/, 'A senha deve conter letra minúscula')
  .regex(/[A-Z]/, 'A senha deve conter letra maiúscula')
  .regex(/[0-9]/, 'A senha deve conter número')
  .regex(/[^A-Za-z0-9]/, 'A senha deve conter símbolo');
