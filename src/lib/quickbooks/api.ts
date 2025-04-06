import { Invoice } from '@/types/invoice'
import OAuthClient from 'intuit-oauth'
import QuickBooks from 'node-quickbooks'

// First, let's verify QuickBooks constructor is available
console.log('QuickBooks constructor check:', {
  constructorType: typeof QuickBooks,
  isFunction: typeof QuickBooks === 'function'
});

// Token storage keys
export const TOKEN_KEY = 'qb_token'
export const REALM_ID_KEY = 'qb_realm_id'
export const REFRESH_TOKEN_KEY = 'qb_refresh_token'
export const TOKEN_EXPIRY_KEY = 'qb_token_expiry'

// Debug flag
const DEBUG = true;

// Helper function to log debug information
const debugLog = (...args: any[]) => {
  if (DEBUG) {
    console.log('[QuickBooks API Debug]', ...args);
  }
};

// Ensure we have a properly formatted base URL with protocol
const getBaseUrl = () => { 
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  
  // Make sure URL has a protocol
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return `http://${baseUrl}`;
  }
  
  // Remove trailing slash if present
  return baseUrl.replace(/\/$/, '');
};

const getRedirectUri = () => {
  const baseUrl = getBaseUrl();
  return `${baseUrl}/api/auth/callback`;
};

// Initialize OAuth client - use createOAuthClient function consistently
let oauthClient: any;

let qbo: QuickBooks | null = null
export { qbo };

// Server-side in-memory token store
// NOTE: This will be reset on server restarts and between serverless function invocations
export let tokenStore: {
  accessToken?: string;
  realmId?: string;
  refreshToken?: string;
  tokenExpiry?: number;
} = {};

// Keep track of initialization status
let isInitialized = false;

// Store token both in memory and in localStorage (if available)
const storeToken = (accessToken: string, realmId: string, refreshToken?: string, expiresIn?: number) => {
  try {
    debugLog('Storing token');
    
    // Store token in memory for server-side use
    tokenStore.accessToken = accessToken;
    tokenStore.realmId = realmId;
    
    if (refreshToken) {
      tokenStore.refreshToken = refreshToken;
    }
    
    if (expiresIn) {
      const expiryTime = Date.now() + (expiresIn * 1000);
      tokenStore.tokenExpiry = expiryTime;
    }
    
    // Try to store in localStorage for persistence if we're in browser
    if (typeof window !== 'undefined') {
      try {
      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem(REALM_ID_KEY, realmId);
      
      if (refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
      
      if (expiresIn) {
          const expiryTime = Date.now() + (expiresIn * 1000);
          localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
        }
      } catch (localStorageError) {
        console.error('Failed to store token in localStorage:', localStorageError);
      }
    }
    
    debugLog('Token stored successfully');
    return true;
  } catch (error) {
    console.error('Failed to store token:', error);
    return false;
  }
};

// Retrieve token from memory or localStorage
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
    
    // If not in memory, try localStorage if we're in browser
    if (typeof window !== 'undefined') {
      const accessToken = localStorage.getItem(TOKEN_KEY);
      const realmId = localStorage.getItem(REALM_ID_KEY);
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      const tokenExpiryStr = localStorage.getItem(TOKEN_EXPIRY_KEY);
      
      if (accessToken && realmId) {
        debugLog('Token found in localStorage');
        
        // Also update memory store for future use
        tokenStore.accessToken = accessToken;
        tokenStore.realmId = realmId;
        
        if (refreshToken) {
          tokenStore.refreshToken = refreshToken;
        }
        
        if (tokenExpiryStr) {
          tokenStore.tokenExpiry = parseInt(tokenExpiryStr, 10);
        }
        
        return { 
          accessToken, 
          realmId,
          refreshToken: refreshToken || undefined,
          tokenExpiry: tokenExpiryStr ? parseInt(tokenExpiryStr, 10) : undefined
        };
      }
    }
    
    debugLog('No token found');
    return null;
  } catch (error) {
    console.error('Failed to get stored token:', error);
    return null;
  }
};

// Clear all stored tokens
const clearTokens = () => {
  debugLog('Clearing all tokens');
  
  // Clear memory store
  tokenStore = {};
  isInitialized = false;
  qbo = null;
  
  // Clear localStorage if in browser
  if (typeof window !== 'undefined') {
    try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REALM_ID_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    } catch (error) {
      console.error('Failed to clear localStorage:', error);
    }
  }
};

export function initializeQBO(accessToken: string, realmId: string, refreshToken?: string, expiresIn?: number): boolean {
  try {
    console.log('BASIC QuickBooks client initialization', {
      accessTokenPresent: !!accessToken,
      realmIdPresent: !!realmId,
      clientIdPresent: !!process.env.QUICKBOOKS_CLIENT_ID,
      clientSecretPresent: !!process.env.QUICKBOOKS_CLIENT_SECRET
    });
    
    // Validate requirements
    if (!accessToken || !realmId) {
      console.error('ERROR: Missing token or realmId for QuickBooks initialization');
      return false;
    }
    
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('ERROR: Missing QuickBooks credentials');
      return false;
    }
    
    // Store the token first
    storeToken(accessToken, realmId, refreshToken, expiresIn);
    
    // ULTRA SIMPLE CLIENT CREATION - FIRST ATTEMPT
    try {
      console.log('Creating minimal QuickBooks client - attempt 1');
      
      // Create the client with absolute minimal parameters
    qbo = new QuickBooks(
        clientId,
        clientSecret,
      accessToken,
        false, // Use OAuth1.0a instead of OAuth2 
      realmId
    );
    
      if (!qbo) {
        console.error('QuickBooks constructor returned null - attempt 1');
        // We'll try fallback approach below
      } else {
        // Set these explicitly to ensure they're available
        qbo.accessToken = accessToken;
        qbo.realmId = realmId;
        
        console.log('QuickBooks client created with basic properties:', {
          hasQbo: !!qbo,
          hasToken: !!(qbo && qbo.accessToken),
          hasRealmId: !!(qbo && qbo.realmId),
        });
        
        // Set initialization flag
        isInitialized = true;
        console.log('QuickBooks client initialized successfully - attempt 1');
        return true;
      }
    }
    catch (clientError) {
      console.error('ERROR creating QuickBooks client instance - attempt 1:', clientError);
      // We'll try fallback approach below
    }
    
    // FALLBACK APPROACH - ATTEMPT 2
    try {
      console.log('Creating fallback QuickBooks client - attempt 2');
      
      // Try with different parameters - some versions need useSandbox parameter
      qbo = new QuickBooks(
        clientId,
        clientSecret,
        accessToken,
        true, // Try with OAuth2 mode 
        realmId,
        {
          useSandbox: true
        }
      );
      
      if (!qbo) {
        console.error('QuickBooks constructor returned null - attempt 2');
        return false;
      }
      
      // Set these explicitly to ensure they're available
      qbo.accessToken = accessToken;
      qbo.realmId = realmId;
      
      console.log('QuickBooks client created with fallback approach');
      
      // Set initialization flag
    isInitialized = true;
      console.log('QuickBooks client initialized successfully - attempt 2');
    return true;
    }
    catch (fallbackError) {
      console.error('ERROR creating QuickBooks client with fallback approach:', fallbackError);
      return false;
    }
  }
  catch (error) {
    console.error('FATAL ERROR in QuickBooks initialization:', error);
    return false;
  }
}

// Check if client is initialized or try to initialize from stored token
export const checkClientInitialized = () => {
  console.log('Checking if QuickBooks client is initialized');
  
  try {
    // If already initialized in this session, verify the client is still valid
    if (qbo && isInitialized) {
      console.log('QuickBooks client appears to be initialized, validating...');
      
      // Verify the client has all required properties
      if (!qbo.accessToken || !qbo.realmId) {
        console.log('Client is missing required properties, will attempt to reinitialize');
        isInitialized = false;
        qbo = null;
      } else {
        console.log('Client appears valid with required properties');
      return true;
      }
    } else {
      console.log('QuickBooks client is not initialized, will attempt to initialize from stored token');
    }
    
    // Try to retrieve token - IMPORTANT: Check both server-side tokenStore and cookies
    console.log('Attempting to retrieve stored token');
    const storedToken = getServerSideToken();
    
    if (!storedToken || !storedToken.accessToken || !storedToken.realmId) {
      console.log('No valid stored token found');
      throw new Error('QuickBooks client not initialized. Please connect your QuickBooks account first.');
    }
    
    console.log('Found stored token, initializing QuickBooks client with:', {
      hasAccessToken: !!storedToken.accessToken,
      hasRealmId: !!storedToken.realmId,
      hasRefreshToken: !!storedToken.refreshToken,
    });
    
    // Initialize with current token
    const initResult = initializeQBO(
      storedToken.accessToken, 
      storedToken.realmId,
      storedToken.refreshToken,
      storedToken.tokenExpiry ? Math.floor((storedToken.tokenExpiry - Date.now()) / 1000) : undefined
    );
    
    if (!initResult) {
      console.error('Failed to initialize QuickBooks client with stored token');
      throw new Error('Failed to initialize QuickBooks client. Please reconnect your QuickBooks account.');
    }
    
    console.log('Successfully initialized QuickBooks client from stored token');
    return true;
  } catch (error) {
    console.error('Error in checkClientInitialized:', error);
    throw error;
  }
};

// Enhanced function to get token from server-side sources (tokenStore and cookies)
function getServerSideToken() {
  console.log('Getting server-side token');
  
  try {
    // First check memory store
    if (tokenStore.accessToken && tokenStore.realmId) {
      console.log('Token found in server memory store');
      return {
        accessToken: tokenStore.accessToken,
        realmId: tokenStore.realmId,
        refreshToken: tokenStore.refreshToken,
        tokenExpiry: tokenStore.tokenExpiry
      };
    }
    
    // No dynamic imports - this causes issues in Next.js
    // The cookies will be passed by the invoices API route directly
    console.log('No server-side token found in memory, check cookies in the API route');
    return null;
  } catch (error) {
    console.error('Error getting server-side token:', error);
    return null;
  }
}

// Function to check if QuickBooks is ready for client-side components
export const isQuickBooksReady = (): boolean => {
  if (typeof window !== 'undefined') {
    const accessToken = localStorage.getItem(TOKEN_KEY);
    const realmId = localStorage.getItem(REALM_ID_KEY);
    const tokenExpiryStr = localStorage.getItem(TOKEN_EXPIRY_KEY);
    
    // If token is expired, consider not ready
    if (tokenExpiryStr) {
      const tokenExpiry = parseInt(tokenExpiryStr, 10);
      if (Date.now() > tokenExpiry) {
        debugLog('Client-side token is expired');
        return false;
      }
    }
    
    const isReady = !!accessToken && !!realmId;
    debugLog('Client-side QuickBooks ready state:', isReady);
    return isReady;
  }
  return false;
};

// Helper function to map QuickBooks invoice format to our app format
function mapQuickBooksInvoice(qbInvoice: any): Invoice {
  try {
    // Extract customer info if available
    const customerName = qbInvoice.CustomerRef?.name || 'Unknown Customer';
    
    // Extract line items
    const lineItems = (qbInvoice.Line || []).map((line: any) => {
      return {
        id: line.Id || '',
        description: line.Description || '',
        amount: line.Amount || 0,
        quantity: line.Quantity || 1,
        unitPrice: line.SalesItemLineDetail?.UnitPrice || 0,
      };
    });
    
    // Map to our invoice format
  return {
      id: qbInvoice.Id || '',
      invoiceNumber: qbInvoice.DocNumber || '',
      customerName: customerName,
      date: qbInvoice.TxnDate || '',
      dueDate: qbInvoice.DueDate || '',
      amount: qbInvoice.TotalAmt || 0,
      balance: qbInvoice.Balance || 0,
      status: qbInvoice.status || 'Unknown',
      lineItems: lineItems,
      currency: qbInvoice.CurrencyRef?.name || 'USD'
    };
  } catch (error) {
    console.error('Error mapping QuickBooks invoice:', error);
    // Return a minimal valid invoice to avoid errors
    return {
      id: qbInvoice.Id || '',
      invoiceNumber: qbInvoice.DocNumber || '',
      customerName: 'Error parsing invoice',
      date: qbInvoice.TxnDate || '',
      dueDate: '',
      amount: 0,
      balance: 0,
      status: 'Error',
      lineItems: [],
      currency: 'USD'
    };
  }
}

// Function to refresh QuickBooks token
export async function refreshQuickBooksToken(refreshToken: string): Promise<boolean> {
  try {
    debugLog('Attempting to refresh token');
    
    // Create a fresh OAuth client for token refresh
    const freshOAuthClient = createOAuthClient();
    
    if (!freshOAuthClient) {
      debugLog('Failed to create fresh OAuth client');
      return false;
    }
    
    debugLog('Created fresh OAuth client for token refresh');
    
    // Try to refresh token
    const refreshResponse = await freshOAuthClient.refreshUsingToken(refreshToken);
    
    if (!refreshResponse) {
      debugLog('No response from token refresh');
      return false;
    }
    
    const refreshData = refreshResponse.getJson();
    debugLog('Refresh response received', { 
      hasAccessToken: !!refreshData.access_token,
      hasRefreshToken: !!refreshData.refresh_token,
      expiresIn: refreshData.expires_in
    });
    
    if (!refreshData.access_token) {
      debugLog('No access token in refresh response');
      return false;
    }
    
    // Store the refreshed token
    storeToken(
      refreshData.access_token,
      tokenStore.realmId || '', // Use existing realmId
      refreshData.refresh_token,
      refreshData.expires_in
    );
    
    // Re-initialize QuickBooks client with new token
    if (tokenStore.realmId) {
      const initialized = initializeQBO(
        refreshData.access_token,
        tokenStore.realmId,
        refreshData.refresh_token,
        refreshData.expires_in ? Date.now() + (refreshData.expires_in * 1000) : undefined
      );
      
      debugLog('QuickBooks client re-initialized after token refresh:', { success: initialized });
      return initialized;
    }
    
    debugLog('No realmId available to re-initialize client');
    return false;
  } catch (error) {
    console.error('Error refreshing token:', error);
    debugLog('Token refresh failed with error');
    return false;
  }
}

export async function fetchInvoices(): Promise<Invoice[] | null> {
  console.error('⭐ fetchInvoices: Starting invoice fetch process');
  try {
    debugLog('Starting fetchInvoices...');
    
    // First, verify we can get stored tokens - any source is fine (memory, localStorage, cookies)
    const tokens = getStoredToken();
    
    console.error('⭐ fetchInvoices: Token check result:', { 
      hasToken: !!tokens?.accessToken,
      hasRealmId: !!tokens?.realmId,
      hasRefreshToken: !!tokens?.refreshToken,
      tokenExpiry: tokens?.tokenExpiry ? new Date(tokens.tokenExpiry).toISOString() : 'none'
    });
    
    if (!tokens || !tokens.accessToken || !tokens.realmId) {
      console.error('⭐ fetchInvoices: No valid tokens found for QuickBooks API call');
      throw new Error('QuickBooks authentication required. Please connect your account.');
    }
    
    // Check if token is expired and we need to refresh
    const now = Date.now();
    const tokenExpired = tokens.tokenExpiry && now >= tokens.tokenExpiry;
    
    console.error('⭐ fetchInvoices: Token expiry check:', {
      now: new Date(now).toISOString(),
      tokenExpiry: tokens.tokenExpiry ? new Date(tokens.tokenExpiry).toISOString() : 'unknown',
      isExpired: tokenExpired
    });
    
    // If token is expired and we have refresh token, try to refresh it
    if (tokenExpired && tokens.refreshToken) {
      console.error('⭐ fetchInvoices: Token expired, attempting to refresh');
      
      try {
        const refreshed = await refreshQuickBooksToken(tokens.refreshToken);
        console.error('⭐ fetchInvoices: Token refresh result:', { success: !!refreshed });
        
        if (!refreshed) {
          console.error('⭐ fetchInvoices: Token refresh failed');
          throw new Error('Failed to refresh QuickBooks authentication. Please reconnect your account.');
        }
      } catch (refreshError) {
        console.error('⭐ fetchInvoices: Error refreshing token:', refreshError);
        throw new Error('QuickBooks authentication expired. Please reconnect your account.');
      }
    }
    
    // Initialize the client if not already initialized
    if (!qbo) {
      console.error('⭐ fetchInvoices: QuickBooks client not initialized, attempting initialization');
      const initialized = initializeQBO(tokens.accessToken, tokens.realmId, tokens.refreshToken, tokens.tokenExpiry);
      
      console.error('⭐ fetchInvoices: Initialization result:', { success: initialized });
      
      if (!initialized || !qbo) {
        console.error('⭐ fetchInvoices: Client initialization failed');
        throw new Error('Failed to initialize QuickBooks client. Please reconnect your account.');
      }
    } else {
      console.error('⭐ fetchInvoices: Using existing QuickBooks client');
    }
    
    // Double-check that qbo is properly initialized with essential properties
    if (!qbo.accessToken) {
      console.error('⭐ fetchInvoices: QB client missing accessToken, updating');
      qbo.accessToken = tokens.accessToken;
    }
    
    if (!qbo.realmId) {
      console.error('⭐ fetchInvoices: QB client missing realmId, updating');
      qbo.realmId = tokens.realmId;
    }
    
    // Print out everything we can about the client state for debugging
    console.error('⭐ fetchInvoices: QuickBooks client state:', {
      clientExists: !!qbo,
      hasAccessToken: !!(qbo && qbo.accessToken),
      hasRealmId: !!(qbo && qbo.realmId),
      hasTokenSecret: !!(qbo && (qbo as any).tokenSecret),
      oauthversion: qbo ? (qbo as any).oauthversion : 'none',
      hasRefreshToken: !!(qbo && (qbo as any).refreshToken),
    });
    
    // At this point, qbo should be initialized
    console.error('⭐ fetchInvoices: Performing QuickBooks API call for invoices');
    
    return new Promise((resolve, reject) => {
      if (!qbo) {
        console.error('⭐ fetchInvoices: QB client not available at request time');
        return reject(new Error('QuickBooks client not initialized'));
      }
      
      console.error('⭐ fetchInvoices: Making findInvoices API call');
      
      // Try-catch block around the API call
      try {
        // First try: Use a simpler approach with no filters
        // Many QuickBooks API failures happen due to complex queries
        console.error('⭐ fetchInvoices: Trying simple query with no filters');
        
        qbo.findInvoices('', (err: any, data: any) => {
        if (err) {
            console.error('⭐ fetchInvoices: Error in simple findInvoices call:', err);
            console.error('⭐ Error details:', JSON.stringify(err, null, 2));
            
            // If the simple approach fails, try a backup approach
            console.error('⭐ fetchInvoices: Trying alternative query approach');
            try {
              // Try with the older query approach
              qbo.findInvoices([
                { field: 'MetaData.LastUpdatedTime', value: '2010-01-01T00:00:00', operator: '>' }
              ], (err2: any, data2: any) => {
                if (err2) {
                  console.error('⭐ fetchInvoices: Both query approaches failed:', err2);
                  console.error('⭐ Error details:', JSON.stringify(err2, null, 2));
                  return reject(err2);
                }
                
                processInvoiceResult(data2, resolve, reject);
              });
            } catch (backupError) {
              console.error('⭐ fetchInvoices: Exception in backup approach:', backupError);
              return reject(backupError);
            }
          } else {
            processInvoiceResult(data, resolve, reject);
          }
        });
      } catch (apiCallError) {
        console.error('⭐ fetchInvoices: Exception during API call execution:', apiCallError);
        return reject(new Error(`QuickBooks API call failed: ${apiCallError instanceof Error ? apiCallError.message : 'Unknown error'}`));
      }
    });
  } catch (error) {
    console.error('⭐ fetchInvoices: Error in fetchInvoices:', error);
    throw error;
  }
}

// Helper function to process invoice results
function processInvoiceResult(data: any, resolve: Function, reject: Function) {
  // Check if data has QueryResponse property with Invoice array
  if (data && data.QueryResponse && Array.isArray(data.QueryResponse.Invoice)) {
    const invoices = data.QueryResponse.Invoice;
    console.error(`⭐ fetchInvoices: Successfully found ${invoices.length} invoices`);
    
    // If no invoices were found, return empty array rather than error
    if (invoices.length === 0) {
      console.error('⭐ fetchInvoices: No invoices found in QuickBooks account');
      return resolve([]);
    }
    
    return resolve(invoices);
  } else {
    console.error('⭐ fetchInvoices: Invalid data structure received from QB API:', typeof data, data ? Object.keys(data) : 'null');
    console.error('⭐ fetchInvoices: Data dump:', JSON.stringify(data, null, 2));
    return reject(new Error('Invalid response from QuickBooks API'));
  }
}

export const getInvoiceById = async (id: string): Promise<Invoice> => {
  try {
    debugLog(`Fetching invoice by ID: ${id}`);
    checkClientInitialized();
    
    if (!qbo) {
      debugLog('QBO client is null after initialization check');
      throw new Error('QuickBooks client is not available. Please reconnect your QuickBooks account.');
    }
    
    const cleanId = id.replace(/^(?:inv-)?#?\s*/i, '').trim();
    
    return new Promise((resolve, reject) => {
      debugLog(`Calling QuickBooks getInvoice API for ID: ${cleanId}`);
      qbo!.getInvoice(cleanId, (err: any, invoice: any) => {
        if (err) {
          console.error('Error fetching invoice from QuickBooks API:', err);
          
          if (err.code === '80040408') {
            debugLog('QuickBooks initialization error (80040408). Clearing tokens.');
            clearTokens();
            reject(new Error('QuickBooks connection error. Please reconnect your QuickBooks account.'));
          } else if (err.code === '270' || err.message?.includes('Token invalid')) {
            debugLog('Invalid token error. Clearing tokens.');
            clearTokens();
            reject(new Error('QuickBooks authentication has expired. Please reconnect your QuickBooks account.'));
          } else if (err.statusCode === 404) {
            reject(new Error(`Invoice #${id} not found. Please check the invoice number and try again.`));
          } else {
            reject(new Error('Failed to fetch invoice from QuickBooks. Please check your connection.'));
          }
        } else {
          debugLog('Successfully fetched invoice from QuickBooks');
          resolve(mapQuickBooksInvoice(invoice));
        }
      });
    });
  } catch (error) {
    console.error('Error in getInvoiceById:', error);
    throw error;
  }
};

// Initialize the OAuth client
initializeOAuthClient();

// Update the getAuthUrl function to use the new createOAuthClient function
export const getAuthUrl = () => {
  try {
    // Log environment variables for debugging (redacting sensitive info)
    console.log('Environment check:', {
      hasClientId: !!process.env.QUICKBOOKS_CLIENT_ID,
      hasClientSecret: !!process.env.QUICKBOOKS_CLIENT_SECRET,
      redirectUri: getRedirectUri(),
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL
    });

    // Create a fresh OAuth client for this request
    const freshOAuthClient = createOAuthClient();

    // Generate and log the auth URL
    const authUrl = freshOAuthClient.authorizeUri({
      scope: [
        OAuthClient.scopes.Accounting,
        OAuthClient.scopes.OpenId,
        OAuthClient.scopes.Profile,
        OAuthClient.scopes.Email,
      ],
      state: 'teststate',
    });

    console.log('Generated auth URL:', authUrl);
    return authUrl;
  } catch (error) {
    console.error('Error in getAuthUrl:', error);
    throw error;
  }
};

export const getRedirectUriForDisplay = () => {
  return getRedirectUri();
};

// Create a function to get a fresh OAuth client
function getOAuthClient() {
  // Ensure the OAuth client is initialized
  if (!oauthClient) {
    console.log('OAuth client not initialized, initializing now');
    if (!initializeOAuthClient()) {
      throw new Error('Failed to initialize OAuth client');
    }
  }
  
  // Return the initialized client
  return oauthClient;
}

export async function handleCallback(url: string) {
  try {
    // Clear any existing tokens and client
    clearTokens();
    qbo = null;
    isInitialized = false;
    
    // Always create a fresh OAuth client for token exchange
    // This ensures the tokenSecret is properly set for this specific request
    const freshOAuthClient = createOAuthClient();
    
    // Parse the URL to get the realmId from query parameters
    const urlParams = new URL(url).searchParams;
    const realmIdFromUrl = urlParams.get('realmId');
    const code = urlParams.get('code');
    
    if (!code) {
      throw new Error('No authorization code received from QuickBooks');
    }
    
    console.log('Creating token with fresh OAuth client', {
      code: code,
      hasRealmId: !!realmIdFromUrl,
      redirectUri: getRedirectUri(),
      hasClientId: !!process.env.QUICKBOOKS_CLIENT_ID,
      hasClientSecret: !!process.env.QUICKBOOKS_CLIENT_SECRET
    });
    
    // Create token with the fresh client
    if (!process.env.QUICKBOOKS_CLIENT_SECRET) {
      throw new Error('QuickBooks client secret is not configured');
    }
    
    // Configure token creation options with the tokenSecret explicitly
    const tokenConfig = {
      code: code,
      realmId: realmIdFromUrl,
      redirectUri: getRedirectUri(),
      tokenSecret: process.env.QUICKBOOKS_CLIENT_SECRET // Pass tokenSecret explicitly here
    };
    
    console.log('Creating token with config:', {
      hasCode: !!tokenConfig.code,
      hasRealmId: !!tokenConfig.realmId,
      hasRedirectUri: !!tokenConfig.redirectUri,
      hasTokenSecret: !!tokenConfig.tokenSecret
    });
    
    // Create token with explicit params
    const authResponse = await freshOAuthClient.createToken(url, tokenConfig);
    const tokenData = authResponse.getJson();
    
    if (!tokenData.access_token) {
      throw new Error('No access token received from QuickBooks');
    }
    
    // Use realmId from token data if available, otherwise use from URL
    const realmId = tokenData.realmId || realmIdFromUrl;
    
    if (!realmId) {
      throw new Error('No realmId found in response or URL parameters');
    }
    
    // Store token first
    const storeResult = storeToken(
      tokenData.access_token,
      realmId,
      tokenData.refresh_token,
      tokenData.expires_in
    );
    
    if (!storeResult) {
      throw new Error('Failed to store QuickBooks token');
    }
    
    // Get client ID and secret
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('QuickBooks client credentials are not configured');
    }
    
    // Create the client directly with needed parameters
    qbo = new QuickBooks(
      clientId,
      clientSecret,
      tokenData.access_token,
      false, // Set to false for regular OAuth
      realmId,
      {
        minorversion: '65',
        debug: true,
        useSandbox: true,
        oauthversion: '2.0', // Explicitly set OAuth version to 2.0
        requestTimeout: 30000
      }
    );
    
    // Explicitly set required properties if they're not set by constructor
    if (qbo) {
      // Make sure accessToken is set
      if (!qbo.accessToken && tokenData.access_token) {
        qbo.accessToken = tokenData.access_token;
      }
      
      // Make sure realmId is set
      if (!qbo.realmId && realmId) {
        qbo.realmId = realmId;
      }
    }
    
    // Verify client was created and has required properties
    if (!qbo || !qbo.accessToken || !qbo.realmId) {
      qbo = null;
      isInitialized = false;
      throw new Error('QuickBooks client initialization failed - missing required properties');
    }
    
    // Set initialization status
    isInitialized = true;
    console.log('QuickBooks client initialized successfully');
    
    return {
      access_token: tokenData.access_token,
      realmId: realmId,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in
    };
  } catch (error) {
    console.error('Error in handleCallback:', error);
    // Clear any partial state
    clearTokens();
    qbo = null;
    isInitialized = false;
    throw error;
  }
}

// Add this function to the api.ts file to directly set tokens
export const manuallyInitializeQuickBooks = () => {
  try {
    console.log('Manually initializing QuickBooks client');
    
    // Create and store a long-lasting token (30 days)
    const accessToken = 'MANUAL_TOKEN_' + Date.now();
    const realmId = 'MANUAL_REALM_' + Date.now();
    const expiresIn = 30 * 24 * 60 * 60; // 30 days in seconds
    
    // Call the existing initializeQBO function
    const result = initializeQBO(accessToken, realmId, accessToken, expiresIn);
    
    console.log('Manual QuickBooks initialization result:', result);
    return result;
  } catch (error) {
    console.error('Failed to manually initialize QuickBooks:', error);
    return false;
  }
};

// Add this function to create a properly configured OAuth client
function createOAuthClient() {
  try {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('QuickBooks client credentials are not configured');
    }
    
    // SIMPLIFIED: Create OAuth client with minimal configuration
    return new OAuthClient({
      clientId,
      clientSecret,
      environment: 'sandbox',
      redirectUri: getRedirectUri(),
      tokenSecret: clientSecret // Essential for OAuth flow
    });
  } catch (error) {
    console.error('Error creating OAuth client:', error);
    throw error;
  }
}

// Initialize the client after the function is defined
function initializeOAuthClient() {
  try {
    if (!oauthClient) {
      console.log('Initializing OAuth client');
      oauthClient = createOAuthClient();
      console.log('OAuth client initialized successfully');
    }
    return true;
  } catch (error) {
    console.error('Error initializing OAuth client:', error);
    return false;
  }
}

// Add this function to update token store directly from values
export function updateTokenStoreFromValues(
  accessToken: string,
  realmId: string,
  refreshToken?: string,
  tokenExpiry?: number
): boolean {
  try {
    debugLog('Directly updating token store with provided values');
    
    // Update the token store directly
    tokenStore.accessToken = accessToken;
    tokenStore.realmId = realmId;
    
    if (refreshToken) {
      tokenStore.refreshToken = refreshToken;
    }
    
    if (tokenExpiry) {
      tokenStore.tokenExpiry = tokenExpiry;
    }
    
    debugLog('Token store updated with values:', {
      hasToken: !!tokenStore.accessToken,
      hasRealmId: !!tokenStore.realmId,
      hasRefreshToken: !!tokenStore.refreshToken,
      tokenExpiry: tokenStore.tokenExpiry ? new Date(tokenStore.tokenExpiry).toISOString() : 'none'
    });
    
    return true;
  } catch (error) {
    console.error('Error updating token store from values:', error);
    return false;
  }
}

// Alternative method to fetch invoices with a more direct approach
export async function fetchInvoicesDirectly(): Promise<any[]> {
  console.error('⭐ Starting direct invoice fetch with alternative method');
  
  try {
    // First, verify we can get stored tokens
    const tokens = getStoredToken();
    
    if (!tokens || !tokens.accessToken || !tokens.realmId) {
      console.error('⭐ No valid tokens for direct invoice fetch');
      throw new Error('QuickBooks authentication required. Please connect your account.');
    }
    
    // We'll set up a fresh OAuthClient instance specifically for this request
    const oauthClientForRequest = new OAuthClient({
      clientId: process.env.QUICKBOOKS_CLIENT_ID!,
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
      environment: 'sandbox',
      redirectUri: getRedirectUri(),
      logging: true
    });
    
    // Set the tokens on the client
    oauthClientForRequest.setToken({
      realmId: tokens.realmId,
      token_type: 'bearer',
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken || '',
      expires_in: tokens.tokenExpiry ? Math.floor((tokens.tokenExpiry - Date.now()) / 1000) : 3600
    });
    
    console.error('⭐ Attempting direct invoice API call');
    
    // Make a direct API call (not using node-quickbooks)
    return new Promise((resolve, reject) => {
      try {
        const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${tokens.realmId}/query`;
        const headers = {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/text'
        };
        
        // Use a simpler query to minimize possible format issues
        const query = "SELECT * FROM Invoice";
        
        // Make the API call
        oauthClientForRequest.makeApiCall({
          url: url,
          method: 'POST',
          headers: headers,
          body: query
        }, (err: any, response: any) => {
          if (err) {
            console.error('⭐ Direct API call error:', err);
            return reject(err);
          }
          
          try {
            // Log the entire response for debugging
            console.error('⭐ Direct API call response:', response);
            
            if (typeof response === 'string') {
              response = JSON.parse(response);
            }
            
            // Extract invoices data
            if (response && response.QueryResponse && Array.isArray(response.QueryResponse.Invoice)) {
              console.error(`⭐ Successfully found ${response.QueryResponse.Invoice.length} invoices directly`);
              return resolve(response.QueryResponse.Invoice);
    } else {
              // If the response doesn't match expected format, try to extract useful data
              console.error('⭐ Unexpected response format:', response);
              
              // If there's any data that can be used, return it
              if (response && typeof response === 'object') {
                if (Array.isArray(response)) {
                  return resolve(response);
                } else if (response.QueryResponse) {
                  return resolve([response.QueryResponse]);
                }
              }
              
              return reject(new Error('Invalid response format from QuickBooks API'));
            }
          } catch (parseError) {
            console.error('⭐ Error parsing direct API response:', parseError);
            return reject(parseError);
          }
        });
      } catch (apiError) {
        console.error('⭐ Error making direct API call:', apiError);
        return reject(apiError);
      }
    });
  } catch (error) {
    console.error('⭐ Top-level error in direct invoice fetch:', error);
    throw error;
  }
}

// Ultra minimal API call for QuickBooks invoices (third approach)
export async function fetchInvoicesMicroMethod(): Promise<any[]> {
  console.error('⭐ Starting MICRO invoice fetch with bare minimum approach');
  
  try {
    // Get tokens directly from memory store first for speed
    const tokens = tokenStore.accessToken && tokenStore.realmId ? {
      accessToken: tokenStore.accessToken,
      realmId: tokenStore.realmId
    } : getStoredToken();
    
    if (!tokens || !tokens.accessToken || !tokens.realmId) {
      console.error('⭐ No valid tokens for micro invoice fetch');
      throw new Error('Authentication required');
    }
    
    console.error('⭐ Micro method: Using minimal axios-like fetch with bare API call');
    
    // Create a promise with a short timeout
    return new Promise((resolve, reject) => {
      // Create a timeout that's much shorter (15 seconds)
      const timeoutId = setTimeout(() => {
        console.error('⭐ Micro method: Request timed out after 15 seconds');
        reject(new Error('Micro method request timed out after 15 seconds'));
      }, 15000);
      
      try {
        // Using the fetch API directly instead of the OAuthClient or node-quickbooks
        const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${tokens.realmId}/query?query=select%20%2A%20from%20Invoice%20MAXRESULTS%205`;
        
        console.error('⭐ Micro method: Calling API directly at URL:', url);
        
        fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tokens.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        })
        .then(response => {
          console.error('⭐ Micro method: Received response with status:', response.status);
          
          if (!response.ok) {
            throw new Error(`API responded with status: ${response.status}`);
          }
          
          return response.json();
        })
        .then(data => {
          console.error('⭐ Micro method: Successfully parsed response JSON');
          clearTimeout(timeoutId);
          
          // Extract invoice data from response
          if (data && data.QueryResponse && Array.isArray(data.QueryResponse.Invoice)) {
            console.error(`⭐ Micro method: Found ${data.QueryResponse.Invoice.length} invoices`);
            resolve(data.QueryResponse.Invoice);
          } else {
            console.error('⭐ Micro method: Response does not contain invoice array:', data);
            // If we at least got data but not in the expected format, return an empty array
            // rather than failing - this helps the UI handle the case better
            resolve([]);
          }
        })
        .catch(error => {
          console.error('⭐ Micro method: Fetch error:', error);
          clearTimeout(timeoutId);
          reject(error);
        });
      } catch (error) {
        console.error('⭐ Micro method: Exception during fetch setup:', error);
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  } catch (error) {
    console.error('⭐ Micro method: Top-level error:', error);
    throw error;
  }
} 