import { NextResponse } from 'next/server'
import OAuthClient from 'intuit-oauth'
import { initializeQBO } from '@/lib/quickbooks/api'

// Debug flag
const DEBUG = true;

// Helper function to log debug information
const debugLog = (...args: any[]) => {
  if (DEBUG) {
    console.log('[OAuth Callback Debug]', ...args);
  }
};

// Helper to get redirect URI
const getRedirectUri = () => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/api/auth/callback`;
};

// Helper to create a cookie with appropriate settings
const createCookie = (name: string, value: string, expiresIn?: number) => {
  // Default to 30 days if no expiry provided
  const maxAge = expiresIn ? expiresIn : 30 * 24 * 60 * 60;
  
  return {
    name,
    value,
    httpOnly: true,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge // in seconds
  };
};

export async function GET(request: Request) {
  try {
    const url = request.url;
    console.log('QUICKBOOKS CALLBACK - Received request:', url);
    
    // Check for error parameters
    const urlObj = new URL(url);
    const urlParams = urlObj.searchParams;
    const error = urlParams.get('error');
    
    if (error) {
      console.error('QuickBooks OAuth error:', error);
      return NextResponse.redirect(
        new URL(`/?auth=error&message=${encodeURIComponent(error)}`, url)
      );
    }
    
    try {
      // Essential parameters
      const clientId = process.env.QUICKBOOKS_CLIENT_ID;
      const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
      const code = urlParams.get('code');
      const realmId = urlParams.get('realmId');
      
      // Log all essential values
      console.log('QUICKBOOKS AUTH - Essential parameters:', {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasCode: !!code,
        hasRealmId: !!realmId
      });
      
      // Validate requirements
      if (!clientId || !clientSecret) {
        throw new Error('Missing QuickBooks client credentials');
      }
      
      if (!code) {
        throw new Error('Missing authorization code');
    }
    
    if (!realmId) {
        throw new Error('Missing realmId parameter');
      }
      
      // Create simple OAuth client
      console.log('Creating OAuth client for token exchange');
      const authClient = new OAuthClient({
        clientId,
        clientSecret,
        environment: 'sandbox',
        redirectUri: getRedirectUri(),
        tokenSecret: clientSecret
      });
      
      // Get token with minimal error handling
      console.log('Requesting token from QuickBooks');
      const authResponse = await authClient.createToken(url);
      const tokenData = authResponse.getJson();
      
      // Log token response (excluding secrets)
      console.log('QUICKBOOKS TOKEN - Received response:', {
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        hasRealmId: !!tokenData.realmId,
        expiresIn: tokenData.expires_in,
        responseKeys: Object.keys(tokenData),
        // Log non-sensitive token info to help with debugging
        realmIdFromToken: tokenData.realmId?.substring(0, 5) + '...',
        tokenType: tokenData.token_type,
      });
      
      // Initialize QuickBooks client
      console.log('Initializing QuickBooks client with token');
      const initResult = initializeQBO(
        tokenData.access_token,
        realmId,
        tokenData.refresh_token,
        tokenData.expires_in
      );
      
      console.log('QuickBooks initialization result:', initResult);
      
      if (!initResult) {
        throw new Error('Failed to initialize QuickBooks client');
      }
      
      // Create a response with cookies to persist the token
      const response = NextResponse.redirect(new URL('/?auth=success', url));
      
      // Set cookies for server-side persistence
      const TOKEN_KEY = 'qb_token';
      const REALM_ID_KEY = 'qb_realm_id';
      const REFRESH_TOKEN_KEY = 'qb_refresh_token';
      const TOKEN_EXPIRY_KEY = 'qb_token_expiry';
      
      // Calculate expiry time in seconds
      const expiryTime = tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : undefined;
      
      // Set cookies
      response.cookies.set(createCookie(TOKEN_KEY, tokenData.access_token, tokenData.expires_in));
      response.cookies.set(createCookie(REALM_ID_KEY, realmId, tokenData.expires_in));
      
      if (tokenData.refresh_token) {
        response.cookies.set(createCookie(REFRESH_TOKEN_KEY, tokenData.refresh_token, tokenData.expires_in));
      }
      
      if (expiryTime) {
        response.cookies.set(createCookie(TOKEN_EXPIRY_KEY, expiryTime.toString(), tokenData.expires_in));
      }
      
      console.log('Tokens stored in cookies for server-side persistence');
      
      // Success
      return response;
    } 
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('QUICKBOOKS ERROR:', errorMessage);
      return NextResponse.redirect(
        new URL(`/?auth=error&message=${encodeURIComponent(errorMessage)}`, url)
      );
    }
  } 
  catch (error) {
    console.error('Unexpected error in callback handler:', error);
    return NextResponse.redirect(
      new URL('/?auth=error&message=Unexpected+error+during+authentication', request.url)
    );
  }
} 