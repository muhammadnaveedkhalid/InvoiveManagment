import { NextResponse } from 'next/server'
import { fetchInvoices, fetchInvoicesDirectly, fetchInvoicesMicroMethod, getInvoiceById, checkClientInitialized, updateTokenStoreFromValues, TOKEN_KEY, REALM_ID_KEY, REFRESH_TOKEN_KEY, TOKEN_EXPIRY_KEY } from '@/lib/quickbooks/api'
import { cookies } from 'next/headers'
import { Invoice } from '@/types'

// Debug flag - should match the one in api.ts
const DEBUG = true;

// Server-side in-memory token store
let tokenStore: {
  accessToken?: string;
  realmId?: string;
  refreshToken?: string;
  tokenExpiry?: number;
} = {};

// Helper function to log debug information
const debugLog = (...args: any[]) => {
  if (DEBUG) {
    console.log('[Invoices API Debug]', ...args);
  }
};

export async function GET(request: Request) {
  console.error('⭐ Invoices API request started');
  try {
    debugLog('Received invoices API request');
    
    // Check if there's an ID in the query params
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    
    if (!id) {
      // List all invoices
      debugLog('Fetching all invoices');
      try {
        console.error('⭐ Checking for auth tokens');
        // Get tokens directly from cookies
        const accessToken = getCookieValue(TOKEN_KEY);
        const realmId = getCookieValue(REALM_ID_KEY);
        const refreshToken = getCookieValue(REFRESH_TOKEN_KEY);
        const tokenExpiryStr = getCookieValue(TOKEN_EXPIRY_KEY);
        
        console.error('⭐ Auth token status:', { 
          hasAccessToken: !!accessToken, 
          hasRealmId: !!realmId,
          hasRefreshToken: !!refreshToken,
          hasTokenExpiry: !!tokenExpiryStr
        });
        
        if (!accessToken || !realmId) {
          console.error('⭐ Missing required tokens in cookies');
          return NextResponse.json(
            { error: 'QuickBooks authentication required. Please connect your QuickBooks account.' },
            { status: 401 }
          );
        }
        
        // IMPORTANT: Directly update the token store before any operations
        const tokenExpiry = tokenExpiryStr ? parseInt(tokenExpiryStr, 10) : undefined;
        console.error('⭐ Updating token store with values from cookies');
        updateTokenStoreFromValues(accessToken, realmId, refreshToken, tokenExpiry);

        // Use a shorter timeout for the overall operation (30 seconds instead of 45)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            console.error('⭐ Request timed out after 30 seconds');
            reject(new Error('Request timed out after 30 seconds'));
          }, 30000);
        });
        
        console.error('⭐ Attempting multiple invoice fetch approaches with shorter timeout');
        let lastError: any = null;
        
        // First approach: Try the ultra minimal micro method
        try {
          console.error('⭐ Trying micro invoice fetch method (fastest, most reliable)');
          const microInvoicesPromise = fetchInvoicesMicroMethod();
          const microInvoices = await Promise.race([microInvoicesPromise, timeoutPromise]);
          
          // We don't need to check if it's an array - the micro method always returns an array (empty if no invoices)
          console.error(`⭐ Successfully fetched ${microInvoices.length} invoices with micro method`);
          
          // If invoices array is empty, return with specific message
          if (microInvoices.length === 0) {
            return NextResponse.json({ invoices: [], message: 'No invoices found in this QuickBooks account' });
          }
          
          return NextResponse.json(microInvoices);
        } catch (error1) {
          console.error('⭐ Micro fetch method failed:', error1);
          lastError = error1;
          
          // Second approach: Try the direct method
          try {
            console.error('⭐ Trying direct invoice fetch method');
            const directInvoicesPromise = fetchInvoicesDirectly();
            const directInvoices = await Promise.race([directInvoicesPromise, timeoutPromise]);
            
            if (!Array.isArray(directInvoices)) {
              console.error('⭐ Invalid response format from direct method:', directInvoices);
              throw new Error('Invalid response format from direct QuickBooks API call');
            }
            
            console.error(`⭐ Successfully fetched ${directInvoices.length} invoices with direct method`);
            
            // If invoices array is empty, return with specific message
            if (directInvoices.length === 0) {
              return NextResponse.json({ invoices: [], message: 'No invoices found in this QuickBooks account' });
            }
            
            return NextResponse.json(directInvoices);
          } catch (error2) {
            console.error('⭐ Direct fetch method also failed:', error2);
            
            // Third approach: Try the standard method
            try {
              console.error('⭐ Trying standard invoice fetch method');
              const invoicesPromise = fetchInvoices() as Promise<Invoice[]>;
              const invoices = await Promise.race([invoicesPromise, timeoutPromise]);
              
              // Verify invoices are in expected format
              if (!Array.isArray(invoices)) {
                console.error('⭐ Invalid response format from standard method:', invoices);
                throw new Error('Invalid response format from QuickBooks API');
              }
              
              console.error(`⭐ Successfully fetched ${invoices.length} invoices with standard method`);
              
              // If invoices array is empty, return with specific message
              if (invoices.length === 0) {
                return NextResponse.json({ invoices: [], message: 'No invoices found in this QuickBooks account' });
              }
              
        return NextResponse.json(invoices);
            } catch (error3) {
              console.error('⭐ Standard fetch method also failed:', error3);
              
              // All methods failed, return a fallback with an empty array to prevent UI from breaking
              console.error('⭐ All three fetch methods failed, returning fallback empty invoices array');
              return NextResponse.json(
                { 
                  invoices: [],
                  message: 'No invoices could be retrieved from QuickBooks',
                  error: 'All fetch methods failed',
                  errorDetails: {
                    microMethod: error1 instanceof Error ? error1.message : 'Unknown error',
                    directMethod: error2 instanceof Error ? error2.message : 'Unknown error',
                    standardMethod: error3 instanceof Error ? error3.message : 'Unknown error'
                  }
                }
              );
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('⭐ All invoice fetch methods failed:', errorMessage);
        console.error('⭐ Full error details:', error);
        
        // Return a more detailed error response
        return NextResponse.json(
          { 
            error: 'Failed to fetch invoices from QuickBooks',
            details: errorMessage,
            suggestion: 'Please check server logs for more details and ensure your QuickBooks connection is valid.',
            fallback: {
              invoices: [],
              message: 'Could not retrieve invoices due to an error'
            }
          },
          { status: 500 }
        );
      }
    } else {
      // Get a specific invoice by ID
      debugLog(`Fetching invoice with ID: ${id}`);
      try {
        const invoice = await getInvoiceById(id);
        debugLog('Successfully fetched invoice');
        return NextResponse.json(invoice);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Error fetching invoice:', errorMessage);
        
        // Differentiate between not found (404) and other errors
        if (errorMessage.includes('not found')) {
          return NextResponse.json(
            { error: errorMessage },
            { status: 404 }
          );
        }
        
        return NextResponse.json(
          { 
            error: 'Failed to fetch invoice details',
            details: errorMessage
          },
          { status: 500 }
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('⭐ Error in invoices API:', error);
    debugLog('Top-level error:', errorMessage);
    
    return NextResponse.json(
      { 
        error: 'Something went wrong when processing your request',
        details: errorMessage,
        fallback: {
          invoices: [],
          message: 'Could not retrieve invoices due to an error'
        }
      },
      { status: 500 }
    );
  }
}

// Note: The GET function above already handles getting by ID when the id parameter is provided
// This function is kept for backward compatibility if needed
export async function GET_BY_ID(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  
  if (!id) {
    return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 })
  }

  try {
    const invoice = await getInvoiceById(id)
    return NextResponse.json(invoice)
  } catch (error) {
    console.error('Error fetching invoice:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch invoice data from QuickBooks' }, 
      { status: 500 }
    )
  }
}

const getStoredToken = () => {
  try {
    debugLog('Retrieving stored token');
    
    // First try memory store for server-side
    if (tokenStore.accessToken && tokenStore.realmId) {
      debugLog('Token found in memory');
      return { 
        accessToken: tokenStore.accessToken, 
        realmId: tokenStore.realmId,
        refreshToken: tokenStore.refreshToken,
        tokenExpiry: tokenStore.tokenExpiry
      };
    }
    
    // Try to get from cookies (works on both client and server)
    const cookieAccessToken = getCookieValue(TOKEN_KEY);
    const cookieRealmId = getCookieValue(REALM_ID_KEY);
    
    if (cookieAccessToken && cookieRealmId) {
      debugLog('Token found in cookies');
      
      // Update memory store
      tokenStore.accessToken = cookieAccessToken;
      tokenStore.realmId = cookieRealmId;
      
      const cookieRefreshToken = getCookieValue(REFRESH_TOKEN_KEY);
      const cookieTokenExpiry = getCookieValue(TOKEN_EXPIRY_KEY);
      
      if (cookieRefreshToken) {
        tokenStore.refreshToken = cookieRefreshToken;
      }
      
      if (cookieTokenExpiry) {
        tokenStore.tokenExpiry = parseInt(cookieTokenExpiry, 10);
      }
      
      return {
        accessToken: cookieAccessToken,
        realmId: cookieRealmId,
        refreshToken: cookieRefreshToken,
        tokenExpiry: cookieTokenExpiry ? parseInt(cookieTokenExpiry, 10) : undefined
      };
    }
    
    // If not in cookies, try localStorage if we're in browser
    if (typeof window !== 'undefined') {
      // Rest of the existing localStorage code...
    }
    
    debugLog('No token found');
    return null;
  } catch (error) {
    console.error('Failed to get stored token:', error);
    return null;
  }
};

// Helper function to get cookie value that works in both browser and server
function getCookieValue(name: string): string | undefined {
  try {
    // Server environment in Next.js API routes
    return cookies().get(name)?.value;
  } catch (error) {
    console.error('Error getting cookie:', error);
    return undefined;
  }
} 