import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { TOKEN_KEY, REALM_ID_KEY } from '@/lib/quickbooks/api'

export async function GET() {
  console.error('⭐ Auth status check initiated');
  try {
    console.log('Checking QuickBooks authentication status');
    
    // First check cookies directly to avoid unnecessary imports if tokens don't exist
    const cookieStore = cookies();
    const accessTokenCookie = cookieStore.get(TOKEN_KEY);
    const realmIdCookie = cookieStore.get(REALM_ID_KEY);
    
    console.error('⭐ Auth cookies check:', {
      hasAccessToken: !!accessTokenCookie,
      hasRealmId: !!realmIdCookie
    });
    
    // If no cookies, we can return early
    if (!accessTokenCookie || !realmIdCookie) {
      console.error('⭐ Missing required auth cookies');
      return NextResponse.json({ 
        authenticated: false,
        message: 'QuickBooks authentication required - no auth tokens found',
        cookieCheck: {
          hasAccessToken: !!accessTokenCookie,
          hasRealmId: !!realmIdCookie
        }
      });
    }
    
    // Import checkClientInitialized from the API module
    // We need to do this dynamically to avoid importing the function directly
    // which would cause the error to be thrown immediately if not authenticated
    console.error('⭐ Importing QuickBooks API modules');
    const { checkClientInitialized, qbo } = await import('@/lib/quickbooks/api');
    
    try {
      // Try to check if the client is initialized
      console.error('⭐ Checking if QuickBooks client is initialized');
      checkClientInitialized();
      
      // Get basic client info for debugging
      const qboInfo = qbo ? {
        hasAccessToken: !!(qbo as any).accessToken,
        hasRealmId: !!(qbo as any).realmId,
        oauthVersion: (qbo as any).oauthversion || 'unknown'
      } : null;
      
      // If no error is thrown, the client is initialized
      console.error('⭐ QuickBooks client is initialized:', qboInfo);
      return NextResponse.json({ 
        authenticated: true,
        message: 'QuickBooks client is initialized and ready',
        clientInfo: qboInfo
      });
    } catch (error) {
      // If an error is thrown, the client is not initialized
      console.error('⭐ QuickBooks client initialization failed:', error instanceof Error ? error.message : 'Unknown error');
      return NextResponse.json({ 
        authenticated: false,
        message: 'QuickBooks client is not initialized',
        error: error instanceof Error ? error.message : 'Unknown error',
        cookieCheck: {
          hasAccessToken: !!accessTokenCookie,
          hasRealmId: !!realmIdCookie
        }
      });
    }
  } catch (error) {
    console.error('⭐ Error checking QuickBooks auth status:', error);
    
    return NextResponse.json(
      { 
        authenticated: false,
        error: 'Error checking QuickBooks authentication status',
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  console.error('⭐ Manual QuickBooks initialization requested');
  try {
    // Import the initialization function
    const { manuallyInitializeQuickBooks } = await import('@/lib/quickbooks/api');
    
    // Call the function
    console.error('⭐ Calling manuallyInitializeQuickBooks function');
    const result = manuallyInitializeQuickBooks();
    
    console.error('⭐ Manual initialization result:', result);
    
    // Return the result
    return NextResponse.json({ 
      success: result,
      message: result ? 'Manual initialization successful' : 'Manual initialization failed'
    });
  } catch (error) {
    console.error('⭐ Error during manual initialization:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Error during manual initialization',
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
} 