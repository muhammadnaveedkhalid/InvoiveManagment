import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Import token keys and token store directly for inspection
import { tokenStore, TOKEN_KEY, REALM_ID_KEY, REFRESH_TOKEN_KEY, TOKEN_EXPIRY_KEY, qbo, refreshQuickBooksToken } from '@/lib/quickbooks/api';

export async function GET(request: Request) {
  try {
    // Get all cookies
    const cookieStore = cookies();
    
    // Get token-related cookies
    const accessTokenCookie = cookieStore.get(TOKEN_KEY);
    const realmIdCookie = cookieStore.get(REALM_ID_KEY);
    const refreshTokenCookie = cookieStore.get(REFRESH_TOKEN_KEY);
    const tokenExpiryCookie = cookieStore.get(TOKEN_EXPIRY_KEY);
    
    // Calculate token status
    let tokenStatus = 'unknown';
    let tokenExpiryTime = null;
    let timeRemaining = null;
    
    if (tokenExpiryCookie) {
      const expiryTime = parseInt(tokenExpiryCookie.value, 10);
      tokenExpiryTime = new Date(expiryTime).toISOString();
      const now = Date.now();
      
      if (expiryTime > now) {
        tokenStatus = 'valid';
        timeRemaining = Math.floor((expiryTime - now) / 1000 / 60); // minutes
      } else {
        tokenStatus = 'expired';
        timeRemaining = Math.floor((now - expiryTime) / 1000 / 60); // minutes since expiry
      }
    } else if (accessTokenCookie && realmIdCookie) {
      tokenStatus = 'valid (no expiry)';
    } else {
      tokenStatus = 'missing';
    }
    
    // Check memory store status
    const memoryStoreStatus = {
      hasAccessToken: !!tokenStore.accessToken,
      hasRealmId: !!tokenStore.realmId,
      hasRefreshToken: !!tokenStore.refreshToken,
      hasTokenExpiry: !!tokenStore.tokenExpiry,
      tokenExpiryDate: tokenStore.tokenExpiry ? new Date(tokenStore.tokenExpiry).toISOString() : null
    };
    
    // Check QuickBooks client status
    const qboClient = qbo as any; // Type assertion to access properties
    const qboStatus = {
      isInitialized: !!qbo,
      hasAccessToken: qboClient ? !!qboClient.accessToken : false,
      hasRealmId: qboClient ? !!qboClient.realmId : false,
      hasOAuthVersion: qboClient ? qboClient.oauthversion || null : null,
    };
    
    // Check URL params
    const url = new URL(request.url);
    const shouldTestRefresh = url.searchParams.get('refresh') === 'true';
    
    // Test token refresh if requested
    let refreshResult = null;
    if (shouldTestRefresh && refreshTokenCookie) {
      try {
        console.log('Debug endpoint: Testing token refresh');
        refreshResult = await refreshQuickBooksToken(refreshTokenCookie.value);
      } catch (refreshError) {
        console.error('Error during test refresh:', refreshError);
        refreshResult = {
          success: false,
          error: refreshError instanceof Error ? refreshError.message : 'Unknown refresh error'
        };
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'QuickBooks authentication debug information',
      cookies: {
        hasAccessToken: !!accessTokenCookie,
        hasRealmId: !!realmIdCookie,
        hasRefreshToken: !!refreshTokenCookie,
        hasTokenExpiry: !!tokenExpiryCookie,
        tokenStatus,
        tokenExpiryTime,
        timeRemaining: timeRemaining !== null ? `${timeRemaining} minutes ${tokenStatus === 'expired' ? 'ago' : 'remaining'}` : null
      },
      memoryStore: memoryStoreStatus,
      qboClient: qboStatus,
      refreshTest: refreshResult,
      tokenValues: {
        // Mask most of the token values for security but show enough to debug
        accessToken: accessTokenCookie ? `${accessTokenCookie.value.substring(0, 10)}...` : null,
        realmId: realmIdCookie ? realmIdCookie.value : null,
        refreshToken: refreshTokenCookie ? `${refreshTokenCookie.value.substring(0, 8)}...` : null
      },
      environment: {
        hasClientId: !!process.env.QUICKBOOKS_CLIENT_ID,
        hasClientSecret: !!process.env.QUICKBOOKS_CLIENT_SECRET,
        hasBaseUrl: !!process.env.NEXT_PUBLIC_BASE_URL
      }
    });
  } catch (error) {
    console.error('Error in auth debug route:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 