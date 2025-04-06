import { initializeQBO } from './api';

/**
 * Development utility to manually initialize QuickBooks without going through OAuth
 * This should ONLY be used in development environments for testing
 */
export const initQuickBooksDirectly = () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('Direct initialization cannot be used in production!');
    return false;
  }
  
  try {
    console.log('Directly initializing QuickBooks with test credentials');
    
    // Generate test tokens
    const accessToken = `test_token_${Date.now()}`;
    const realmId = `test_realm_${Date.now()}`;
    const refreshToken = accessToken;
    const expiresIn = 24 * 60 * 60; // 24 hours in seconds
    
    // Initialize QuickBooks
    const success = initializeQBO(accessToken, realmId, refreshToken, expiresIn);
    
    if (success) {
      console.log('✅ QuickBooks test initialization successful!');
      console.log('You can now use the QuickBooks API for development');
      
      // Store these values in localStorage for client-side access
      if (typeof window !== 'undefined') {
        localStorage.setItem('qb_token', accessToken);
        localStorage.setItem('qb_realm_id', realmId);
        localStorage.setItem('qb_refresh_token', refreshToken);
        localStorage.setItem('qb_token_expiry', (Date.now() + (expiresIn * 1000)).toString());
      }
      
      return true;
    } else {
      console.error('❌ QuickBooks test initialization failed');
      return false;
    }
  } catch (error) {
    console.error('Error in direct initialization:', error);
    return false;
  }
}; 