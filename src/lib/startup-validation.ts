/**
 * Startup Security Validation
 * 
 * Validates security-critical configuration at application startup.
 * Call this from your app initialization (e.g., instrumentation.ts or main entry point).
 * 
 * This prevents running with insecure defaults in production environments.
 */

// Required environment variables for production
const REQUIRED_PRODUCTION_VARS = [
  'ATI_PEPPER',
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
  'DATABASE_URL'
] as const

// Environment variables that should have minimum length for security
const SECURE_LENGTH_VARS = {
  ATI_PEPPER: 32,
  JWT_SECRET: 32,
  REFRESH_TOKEN_SECRET: 32
} as const

/**
 * Validate security-critical configuration
 * Throws an error if configuration is invalid in production
 */
export function validateSecurityConfig(): void {
  const errors: string[] = []
  const warnings: string[] = []
  
  const nodeEnv = process.env.NODE_ENV
  const isProduction = nodeEnv === 'production'
  
  // ==========================================================================
  // NODE_ENV Validation
  // ==========================================================================
  if (!nodeEnv) {
    errors.push('NODE_ENV must be set')
  }
  
  // Check for production-like environments without production NODE_ENV
  const isVercel = !!process.env.VERCEL
  const isRailway = !!process.env.RAILWAY_ENVIRONMENT
  const isProductionDomain = process.env.NEXT_PUBLIC_URL?.includes('patentnest') ||
                             process.env.NEXTAUTH_URL?.includes('patentnest')
  
  if ((isVercel || isRailway || isProductionDomain) && !isProduction) {
    const platformName = isVercel ? 'Vercel' : isRailway ? 'Railway' : 'production domain'
    errors.push(`NODE_ENV must be "production" when running on ${platformName}. Current value: "${nodeEnv}"`)
  }
  
  // ==========================================================================
  // Required Production Variables
  // ==========================================================================
  if (isProduction) {
    for (const varName of REQUIRED_PRODUCTION_VARS) {
      if (!process.env[varName]) {
        errors.push(`${varName} is required in production`)
      }
    }
  }
  
  // ==========================================================================
  // Security Length Validation
  // ==========================================================================
  for (const [varName, minLength] of Object.entries(SECURE_LENGTH_VARS)) {
    const value = process.env[varName]
    if (value && value.length < minLength) {
      const message = `${varName} should be at least ${minLength} characters for security (current: ${value.length})`
      if (isProduction) {
        errors.push(message)
      } else {
        warnings.push(message)
      }
    }
  }
  
  // ==========================================================================
  // Check for Default/Weak Secrets
  // ==========================================================================
  const weakPatterns = [
    'change-in-production',
    'your-super-secure',
    'default',
    'secret123',
    'password'
  ]
  
  const secretVars = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ATI_PEPPER']
  for (const varName of secretVars) {
    const value = process.env[varName]?.toLowerCase() || ''
    if (value && weakPatterns.some(pattern => value.includes(pattern))) {
      const message = `${varName} appears to contain a weak/default value`
      if (isProduction) {
        errors.push(message)
      } else {
        warnings.push(message)
      }
    }
  }
  
  // ==========================================================================
  // Output Results
  // ==========================================================================
  if (warnings.length > 0) {
    console.warn('[Security Validation] Warnings:')
    warnings.forEach(w => console.warn(`  - ${w}`))
  }
  
  if (errors.length > 0) {
    console.error('[Security Validation] CRITICAL ERRORS:')
    errors.forEach(e => console.error(`  - ${e}`))
    
    if (isProduction) {
      throw new Error(
        `Security validation failed with ${errors.length} error(s). ` +
        `Fix these issues before running in production:\n` +
        errors.map(e => `  - ${e}`).join('\n')
      )
    }
  }
  
  console.log(`[Security Validation] Configuration validated successfully (env: ${nodeEnv})`)
}

/**
 * Check if we're running in a production-like environment
 */
export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production' ||
         !!process.env.VERCEL ||
         !!process.env.RAILWAY_ENVIRONMENT ||
         (process.env.NEXT_PUBLIC_URL?.includes('patentnest') ?? false)
}

/**
 * Get security configuration summary (for logging/debugging)
 */
export function getSecurityConfigSummary(): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV || 'not set',
    ATI_PEPPER_SET: process.env.ATI_PEPPER ? 'yes' : 'no',
    JWT_SECRET_SET: process.env.JWT_SECRET ? 'yes' : 'no',
    REFRESH_TOKEN_SECRET_SET: process.env.REFRESH_TOKEN_SECRET ? 'yes' : 'no',
    DATABASE_URL_SET: process.env.DATABASE_URL ? 'yes' : 'no',
    IS_VERCEL: process.env.VERCEL ? 'yes' : 'no',
    IS_PRODUCTION_DOMAIN: (process.env.NEXT_PUBLIC_URL?.includes('patentnest') ?? false) ? 'yes' : 'no'
  }
}
