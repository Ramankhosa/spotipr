/**
 * Next.js Instrumentation
 * 
 * This file runs once when the Next.js server starts.
 * Used for security configuration validation and initialization tasks.
 * 
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server startup (not during build or in client)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import to avoid issues during build
    const { validateSecurityConfig } = await import('@/lib/startup-validation')
    
    try {
      validateSecurityConfig()
    } catch (error) {
      // In production, this will throw and prevent server start if misconfigured
      // In development, it will log warnings but allow the server to start
      console.error('[Instrumentation] Security validation failed:', error)
      
      if (process.env.NODE_ENV === 'production') {
        // Re-throw to prevent server start in production with invalid config
        throw error
      }
    }
  }
}
